use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use tauri::Emitter;
use tokio::sync::{Notify, Semaphore};

use crate::analyzer;
use crate::fits_preview;
use crate::types::PreviewQueueState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum JobKind {
    /// FITS/XISF → JPEG preview generation.
    Preview,
    /// Per-star detail analysis (heatmap / tilt overlays).
    Stars,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Job {
    pub kind: JobKind,
    pub path: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct EnqueueOutcome {
    pub added: usize,
}

pub struct PreviewQueue {
    pending: VecDeque<Job>,
    enqueued: HashSet<Job>,
    in_flight: HashSet<Job>,
    completed: usize,
    total: usize,
}

impl PreviewQueue {
    pub fn new() -> Self {
        Self {
            pending: VecDeque::new(),
            enqueued: HashSet::new(),
            in_flight: HashSet::new(),
            completed: 0,
            total: 0,
        }
    }

    /// Prepend a batch of jobs to the front of the queue with dedup:
    /// - If a job is in `in_flight`, skip.
    /// - If a job is in `pending`, pull it out (will be re-pushed at front).
    /// - Otherwise, increment `total`.
    ///
    /// Order of the returned front reflects the caller's order (jobs[0]
    /// ends up at position 0 of `pending`).
    pub fn enqueue(&mut self, jobs: Vec<Job>) -> EnqueueOutcome {
        let mut added = 0usize;
        // First pass: determine which jobs are admissible and in what order,
        // and adjust total for new items.
        let mut to_push: Vec<Job> = Vec::with_capacity(jobs.len());
        for job in jobs {
            if self.in_flight.contains(&job) {
                continue;
            }
            if self.enqueued.contains(&job) {
                // Already pending — remove from its current position.
                if let Some(idx) = self.pending.iter().position(|j| j == &job) {
                    self.pending.remove(idx);
                }
                to_push.push(job);
            } else {
                self.enqueued.insert(job.clone());
                self.total += 1;
                added += 1;
                to_push.push(job);
            }
        }
        // Push to front, preserving caller order: iterate reverse and push_front.
        for job in to_push.into_iter().rev() {
            self.pending.push_front(job);
        }
        EnqueueOutcome { added }
    }

    pub fn pop_next(&mut self) -> Option<Job> {
        let job = self.pending.pop_front()?;
        self.in_flight.insert(job.clone());
        Some(job)
    }

    /// Mark a job as completed (success or failure). Must be called exactly
    /// once per `pop_next` return value. Resets counters on full drain.
    pub fn mark_complete(&mut self, job: &Job) {
        self.in_flight.remove(job);
        self.enqueued.remove(job);
        self.completed += 1;
        self.check_drain_reset();
    }

    /// Drain `pending` without touching `in_flight`. Counters reset if
    /// `in_flight` is already empty; otherwise they reset when the last
    /// in-flight item completes.
    pub fn clear(&mut self) {
        for job in self.pending.drain(..) {
            self.enqueued.remove(&job);
        }
        self.check_drain_reset();
    }

    fn check_drain_reset(&mut self) {
        if self.pending.is_empty() && self.in_flight.is_empty() {
            self.total = 0;
            self.completed = 0;
            self.enqueued.clear();
        }
    }

    pub fn is_active(&self) -> bool {
        !self.pending.is_empty() || !self.in_flight.is_empty()
    }

    pub fn total(&self) -> usize { self.total }
    pub fn completed(&self) -> usize { self.completed }
    #[cfg(test)]
    pub fn is_in_flight(&self, job: &Job) -> bool { self.in_flight.contains(job) }

    #[cfg(test)]
    pub fn pending_snapshot(&self) -> Vec<Job> {
        self.pending.iter().cloned().collect()
    }
}

// ─── Singleton & worker ─────────────────────────────────────────────────────

static QUEUE: OnceLock<Mutex<PreviewQueue>> = OnceLock::new();
static NOTIFY: OnceLock<Notify> = OnceLock::new();
static WORKER_STARTED: AtomicBool = AtomicBool::new(false);

fn queue() -> &'static Mutex<PreviewQueue> {
    QUEUE.get_or_init(|| Mutex::new(PreviewQueue::new()))
}

fn notify() -> &'static Notify {
    NOTIFY.get_or_init(Notify::new)
}

fn snapshot(q: &PreviewQueue) -> PreviewQueueState {
    PreviewQueueState {
        completed: q.completed(),
        total: q.total(),
        active: q.is_active(),
    }
}

fn emit_state(window: &tauri::Window, state: PreviewQueueState) {
    let _ = window.emit("preview:queue_state", state);
}

/// Public entry point for the `enqueue_prefetch_window` command.
///
/// Replaces pending work with the navigation window: for each path (nearest
/// frame first) a preview job, immediately followed by a star-detail job when
/// the heatmap/tilt overlays are on. Pending jobs from the previous window
/// are dropped — prefetch follows navigation instead of sweeping a backlog —
/// while in-flight jobs finish normally.
pub fn prefetch_window(window: &tauri::Window, paths: Vec<String>, include_stars: bool) {
    let mut jobs = Vec::with_capacity(paths.len() * if include_stars { 2 } else { 1 });
    for path in paths {
        if include_stars {
            jobs.push(Job { kind: JobKind::Preview, path: path.clone() });
            jobs.push(Job { kind: JobKind::Stars, path });
        } else {
            jobs.push(Job { kind: JobKind::Preview, path });
        }
    }
    {
        let mut q = queue().lock().unwrap();
        q.clear();
        q.enqueue(jobs);
        emit_state(window, snapshot(&q));
    }
    notify().notify_one();
    ensure_worker_started(window.clone());
}

// ─── Foreground priority ────────────────────────────────────────────────────

static FOREGROUND: AtomicUsize = AtomicUsize::new(0);

/// RAII guard held by direct commands (`get_fits_preview`,
/// `analyze_stars_detail`) for the frame the user is looking at. While any
/// guard is alive the worker stops admitting new queue jobs, so the visible
/// frame's generation gets the CPU instead of finishing last behind a batch
/// of prefetch work. In-flight jobs finish normally.
pub struct ForegroundGuard(());

pub fn foreground_guard() -> ForegroundGuard {
    FOREGROUND.fetch_add(1, Ordering::SeqCst);
    ForegroundGuard(())
}

impl Drop for ForegroundGuard {
    fn drop(&mut self) {
        FOREGROUND.fetch_sub(1, Ordering::SeqCst);
        // Wake the worker — it may be paused waiting for foreground work to end.
        notify().notify_one();
    }
}

fn foreground_active() -> bool {
    FOREGROUND.load(Ordering::SeqCst) > 0
}

/// Public entry point for `clear_preview_queue` command.
pub fn clear(window: &tauri::Window) {
    let mut q = queue().lock().unwrap();
    q.clear();
    emit_state(window, snapshot(&q));
}

fn ensure_worker_started(window: tauri::Window) {
    // swap returns the previous value — if it was already true, bail.
    if WORKER_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }
    tauri::async_runtime::spawn(worker_loop(window));
}

fn is_cached(job: &Job) -> bool {
    match job.kind {
        JobKind::Preview => fits_preview::try_cache(&job.path).is_some(),
        JobKind::Stars => analyzer::try_stars_cache(&job.path).is_some(),
    }
}

fn run_job(job: &Job) {
    match job.kind {
        JobKind::Preview => {
            let _ = fits_preview::generate_preview(&job.path);
        }
        JobKind::Stars => {
            let _ = analyzer::stars_detail_cached(&job.path);
        }
    }
}

async fn worker_loop(window: tauri::Window) {
    let semaphore = Arc::new(Semaphore::new(fits_preview::concurrent_limit()));
    loop {
        // Foreground-first: while a direct preview/stars command is running,
        // don't start new queue jobs — the visible frame gets the CPU.
        if foreground_active() {
            notify().notified().await;
            continue;
        }
        // Pop next job, or wait for a notification if empty.
        let job = {
            let mut q = queue().lock().unwrap();
            q.pop_next()
        };
        let job = match job {
            Some(j) => j,
            None => {
                notify().notified().await;
                continue;
            }
        };

        // Fast path: cache hit — no permit needed.
        if is_cached(&job) {
            finish(&window, &job);
            continue;
        }

        // Acquire a permit, then spawn a blocking task to run the job.
        let permit = match Arc::clone(&semaphore).acquire_owned().await {
            Ok(p) => p,
            Err(_) => {
                // Semaphore closed — shouldn't happen. Mark complete and continue.
                finish(&window, &job);
                continue;
            }
        };
        let window_cloned = window.clone();
        tokio::spawn(async move {
            let _permit = permit; // held for the duration of the job
            let job_for_block = job.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                run_job(&job_for_block);
            })
            .await;
            finish(&window_cloned, &job);
        });
    }
}

fn finish(window: &tauri::Window, job: &Job) {
    {
        let mut q = queue().lock().unwrap();
        q.mark_complete(job);
        emit_state(window, snapshot(&q));
    }
    // Wake the worker in case it's idle. (If it's currently popping, the
    // notification is harmless.)
    notify().notify_one();
}

#[cfg(test)]
mod tests {
    use super::{EnqueueOutcome, Job, JobKind, PreviewQueue};

    fn make() -> PreviewQueue {
        PreviewQueue::new()
    }

    fn p(path: &str) -> Job {
        Job { kind: JobKind::Preview, path: path.into() }
    }

    fn s(path: &str) -> Job {
        Job { kind: JobKind::Stars, path: path.into() }
    }

    fn previews(paths: &[&str]) -> Vec<Job> {
        paths.iter().map(|x| p(x)).collect()
    }

    #[test]
    fn enqueue_adds_new_items_to_front() {
        let mut q = make();
        let outcome = q.enqueue(previews(&["a", "b", "c"]));
        assert_eq!(outcome, EnqueueOutcome { added: 3 });
        assert_eq!(q.total(), 3);
        assert_eq!(q.completed(), 0);
        assert_eq!(q.pending_snapshot(), previews(&["a", "b", "c"]));
    }

    #[test]
    fn enqueue_preserves_caller_order_across_calls() {
        let mut q = make();
        q.enqueue(previews(&["a", "b", "c"]));
        q.enqueue(previews(&["d", "e"]));
        assert_eq!(q.total(), 5);
        assert_eq!(q.pending_snapshot(), previews(&["d", "e", "a", "b", "c"]));
    }

    #[test]
    fn enqueue_dedups_items_already_pending() {
        let mut q = make();
        q.enqueue(previews(&["a", "b", "c"]));
        // Re-enqueuing "b" should move it to front, not increment total.
        let outcome = q.enqueue(previews(&["b"]));
        assert_eq!(outcome, EnqueueOutcome { added: 0 });
        assert_eq!(q.total(), 3);
        assert_eq!(q.pending_snapshot(), previews(&["b", "a", "c"]));
    }

    #[test]
    fn enqueue_skips_items_in_flight() {
        let mut q = make();
        q.enqueue(previews(&["a", "b"]));
        // Simulate the worker popping "a".
        let popped = q.pop_next().unwrap();
        assert_eq!(popped, p("a"));
        assert!(q.is_in_flight(&p("a")));
        // Re-enqueue "a" — should be ignored.
        let outcome = q.enqueue(previews(&["a"]));
        assert_eq!(outcome, EnqueueOutcome { added: 0 });
        assert_eq!(q.total(), 2);
        assert!(q.is_in_flight(&p("a")));
        assert_eq!(q.pending_snapshot(), previews(&["b"]));
    }

    #[test]
    fn same_path_different_kinds_are_distinct_jobs() {
        let mut q = make();
        let outcome = q.enqueue(vec![p("a"), s("a")]);
        assert_eq!(outcome, EnqueueOutcome { added: 2 });
        assert_eq!(q.total(), 2);
        assert_eq!(q.pending_snapshot(), vec![p("a"), s("a")]);
        // Popping the preview leaves the stars job pending; re-enqueueing the
        // stars job moves it but never touches the in-flight preview.
        assert_eq!(q.pop_next().unwrap(), p("a"));
        let outcome = q.enqueue(vec![s("a")]);
        assert_eq!(outcome, EnqueueOutcome { added: 0 });
        assert!(q.is_in_flight(&p("a")));
        assert_eq!(q.pending_snapshot(), vec![s("a")]);
    }

    #[test]
    fn mixed_kind_enqueue_preserves_caller_order() {
        let mut q = make();
        q.enqueue(previews(&["x", "y"]));
        // A navigation window: previews first, then stars for the same paths.
        q.enqueue(vec![s("a"), s("b")]);
        q.enqueue(vec![p("a"), p("b")]);
        assert_eq!(
            q.pending_snapshot(),
            vec![p("a"), p("b"), s("a"), s("b"), p("x"), p("y")]
        );
    }

    #[test]
    fn mark_complete_then_full_drain_resets_counters() {
        let mut q = make();
        q.enqueue(previews(&["a", "b", "c"]));
        q.pop_next();
        q.pop_next();
        q.pop_next();
        q.mark_complete(&p("a"));
        q.mark_complete(&p("b"));
        q.mark_complete(&p("c"));
        assert_eq!(q.completed(), 0); // reset after full drain
        // Full drain resets counters.
        assert_eq!(q.total(), 0);
        assert!(!q.is_active());
    }

    #[test]
    fn full_drain_resets_counters_and_deactivates() {
        let mut q = make();
        q.enqueue(previews(&["a"]));
        assert!(q.is_active());
        q.pop_next();
        q.mark_complete(&p("a"));
        assert_eq!(q.total(), 0);
        assert_eq!(q.completed(), 0);
        assert!(!q.is_active());
    }

    #[test]
    fn interleaved_enqueue_during_drain() {
        let mut q = make();
        q.enqueue(previews(&["a", "b"])); // total=2
        q.pop_next(); // a in_flight
        q.mark_complete(&p("a")); // completed=1
        q.enqueue(previews(&["c", "d", "e"])); // total=5
        assert_eq!(q.total(), 5);
        assert_eq!(q.completed(), 1);
        // Drain the rest.
        while let Some(j) = q.pop_next() {
            q.mark_complete(&j);
        }
        assert_eq!(q.total(), 0);
        assert_eq!(q.completed(), 0);
        assert!(!q.is_active());
    }

    #[test]
    fn mark_complete_on_failure_counts_the_same() {
        // The queue doesn't distinguish success from failure — mark_complete is the
        // sole counter-incrementing path. This test pins that contract.
        let mut q = make();
        q.enqueue(previews(&["a", "b"]));
        q.pop_next();
        q.mark_complete(&p("a")); // "a" failed at generate_preview — still complete
        q.pop_next();
        q.mark_complete(&p("b"));
        assert!(!q.is_active());
    }

    #[test]
    fn clear_drops_pending_leaves_in_flight() {
        let mut q = make();
        q.enqueue(previews(&["a", "b", "c"]));
        q.pop_next(); // a in_flight
        q.clear();
        assert!(q.is_in_flight(&p("a")));
        assert_eq!(q.pending_snapshot(), Vec::<Job>::new());
        // Counters don't reset yet because in_flight is non-empty.
        assert!(q.is_active());
        q.mark_complete(&p("a"));
        // Now drains fully.
        assert!(!q.is_active());
        assert_eq!(q.total(), 0);
    }

    #[test]
    fn clear_with_empty_in_flight_resets_immediately() {
        let mut q = make();
        q.enqueue(previews(&["a", "b"]));
        q.clear();
        assert!(!q.is_active());
        assert_eq!(q.total(), 0);
        assert_eq!(q.completed(), 0);
    }

} // end mod tests
