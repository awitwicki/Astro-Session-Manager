use std::collections::{HashMap, HashSet, VecDeque};
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

/// Which lane a job was admitted through. Lanes have separate pending lists
/// and progress counters; the worker always serves `Window` before `Bulk`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lane {
    /// The ±3 navigation window around the selected frame. Replaced wholesale
    /// on every navigation so prefetch follows the user.
    Window,
    /// A "Cache all previews" sweep over a whole gallery. Runs behind the
    /// window lane and survives navigation; stopped explicitly by the user.
    Bulk,
}

#[derive(Debug, PartialEq, Eq)]
pub struct EnqueueOutcome {
    pub added: usize,
}

/// Result of `pop_next`: the job to run (if any) plus how many pending jobs
/// were found already in flight through the other lane and counted complete
/// without running — a signal to re-emit queue state.
#[derive(Debug, PartialEq, Eq)]
pub struct Popped {
    pub job: Option<Job>,
    pub skipped: usize,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct Progress {
    completed: usize,
    total: usize,
}

#[derive(Default)]
struct LaneQueue {
    pending: VecDeque<Job>,
    /// Membership of `pending` for O(1) dedup.
    enqueued: HashSet<Job>,
    progress: Progress,
}

pub struct PreviewQueue {
    window: LaneQueue,
    bulk: LaneQueue,
    /// Every running job, tagged with the lane it was popped from. A path is
    /// generated at most once at a time: the other lane's copy is counted
    /// complete when it reaches the front instead of running again.
    in_flight: HashMap<Job, Lane>,
}

impl PreviewQueue {
    pub fn new() -> Self {
        Self {
            window: LaneQueue::default(),
            bulk: LaneQueue::default(),
            in_flight: HashMap::new(),
        }
    }

    fn lane(&self, lane: Lane) -> &LaneQueue {
        match lane {
            Lane::Window => &self.window,
            Lane::Bulk => &self.bulk,
        }
    }

    fn lane_mut(&mut self, lane: Lane) -> &mut LaneQueue {
        match lane {
            Lane::Window => &mut self.window,
            Lane::Bulk => &mut self.bulk,
        }
    }

    /// Prepend a batch of window jobs to the front of the queue with dedup:
    /// - If a job is in flight (either lane), skip.
    /// - If a job is already pending in the window lane, pull it out (it will
    ///   be re-pushed at the front).
    /// - Otherwise, increment the window `total`.
    ///
    /// Order of the resulting front reflects the caller's order (jobs[0]
    /// ends up at position 0 of `pending`).
    pub fn enqueue(&mut self, jobs: Vec<Job>) -> EnqueueOutcome {
        let mut added = 0usize;
        let mut to_push: Vec<Job> = Vec::with_capacity(jobs.len());
        for job in jobs {
            if self.in_flight.contains_key(&job) {
                continue;
            }
            if self.window.enqueued.contains(&job) {
                // Already pending — remove from its current position.
                if let Some(idx) = self.window.pending.iter().position(|j| j == &job) {
                    self.window.pending.remove(idx);
                }
                to_push.push(job);
            } else {
                self.window.enqueued.insert(job.clone());
                self.window.progress.total += 1;
                added += 1;
                to_push.push(job);
            }
        }
        // Push to front, preserving caller order: iterate reverse and push_front.
        for job in to_push.into_iter().rev() {
            self.window.pending.push_front(job);
        }
        EnqueueOutcome { added }
    }

    /// Replace the bulk lane with a new sweep, in caller order. Jobs in
    /// flight (either lane) are skipped — they are being generated anyway —
    /// and duplicates within the batch collapse. Bulk jobs still running from
    /// a previous sweep stay in the new total so the counter never goes
    /// backwards mid-run.
    pub fn enqueue_bulk(&mut self, jobs: Vec<Job>) -> EnqueueOutcome {
        self.bulk.pending.clear();
        self.bulk.enqueued.clear();
        let mut added = 0usize;
        for job in jobs {
            if self.in_flight.contains_key(&job) || self.bulk.enqueued.contains(&job) {
                continue;
            }
            self.bulk.enqueued.insert(job.clone());
            self.bulk.pending.push_back(job);
            added += 1;
        }
        let running = self.in_flight_count(Lane::Bulk);
        self.bulk.progress = Progress { completed: 0, total: added + running };
        EnqueueOutcome { added }
    }

    /// Take the next job to run: window lane first, then bulk. A pending job
    /// whose path is already running through the other lane is not run twice;
    /// it is counted complete for its own lane and skipped.
    pub fn pop_next(&mut self) -> Popped {
        let mut skipped = 0usize;
        loop {
            let (job, lane) = if let Some(job) = self.window.pending.pop_front() {
                self.window.enqueued.remove(&job);
                (job, Lane::Window)
            } else if let Some(job) = self.bulk.pending.pop_front() {
                self.bulk.enqueued.remove(&job);
                (job, Lane::Bulk)
            } else {
                return Popped { job: None, skipped };
            };
            if self.in_flight.contains_key(&job) {
                self.lane_mut(lane).progress.completed += 1;
                self.check_drain_reset(lane);
                skipped += 1;
                continue;
            }
            self.in_flight.insert(job.clone(), lane);
            return Popped { job: Some(job), skipped };
        }
    }

    /// Mark a running job as completed (success or failure). Must be called
    /// exactly once per job returned by `pop_next`. Resets the owning lane's
    /// counters once that lane is fully drained.
    pub fn mark_complete(&mut self, job: &Job) {
        if let Some(lane) = self.in_flight.remove(job) {
            self.lane_mut(lane).progress.completed += 1;
            self.check_drain_reset(lane);
        }
    }

    /// Drop the window lane's pending jobs without touching in-flight ones or
    /// the bulk lane. Counters reset now if nothing from the window lane is
    /// running, otherwise when its last in-flight job completes.
    pub fn clear(&mut self) {
        self.clear_lane(Lane::Window);
    }

    /// Stop a bulk sweep: drop its pending jobs; in-flight ones finish.
    pub fn clear_bulk(&mut self) {
        self.clear_lane(Lane::Bulk);
    }

    fn clear_lane(&mut self, lane: Lane) {
        let q = self.lane_mut(lane);
        q.pending.clear();
        q.enqueued.clear();
        self.check_drain_reset(lane);
    }

    fn in_flight_count(&self, lane: Lane) -> usize {
        self.in_flight.values().filter(|l| **l == lane).count()
    }

    fn check_drain_reset(&mut self, lane: Lane) {
        if self.lane(lane).pending.is_empty() && self.in_flight_count(lane) == 0 {
            self.lane_mut(lane).progress = Progress::default();
        }
    }

    fn lane_active(&self, lane: Lane) -> bool {
        !self.lane(lane).pending.is_empty() || self.in_flight_count(lane) > 0
    }

    pub fn is_active(&self) -> bool { self.lane_active(Lane::Window) }
    pub fn total(&self) -> usize { self.window.progress.total }
    pub fn completed(&self) -> usize { self.window.progress.completed }

    pub fn bulk_active(&self) -> bool { self.lane_active(Lane::Bulk) }
    pub fn bulk_total(&self) -> usize { self.bulk.progress.total }
    pub fn bulk_completed(&self) -> usize { self.bulk.progress.completed }

    #[cfg(test)]
    pub fn is_in_flight(&self, job: &Job) -> bool { self.in_flight.contains_key(job) }

    #[cfg(test)]
    pub fn pending_snapshot(&self) -> Vec<Job> {
        self.window.pending.iter().cloned().collect()
    }

    #[cfg(test)]
    pub fn bulk_snapshot(&self) -> Vec<Job> {
        self.bulk.pending.iter().cloned().collect()
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
        bulk_completed: q.bulk_completed(),
        bulk_total: q.bulk_total(),
        bulk_active: q.bulk_active(),
    }
}

fn emit_state(window: &tauri::Window, state: PreviewQueueState) {
    let _ = window.emit("preview:queue_state", state);
}

/// Public entry point for the `enqueue_prefetch_window` command.
///
/// Replaces pending window work with the navigation window: for each path
/// (nearest frame first) a preview job, immediately followed by a star-detail
/// job when the heatmap/tilt overlays are on. Pending jobs from the previous
/// window are dropped — prefetch follows navigation instead of sweeping a
/// backlog — while in-flight jobs finish normally. A bulk sweep, if any, is
/// untouched and resumes once the window is served.
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

/// Public entry point for the `enqueue_bulk_previews` command ("Cache all
/// previews"): a preview job per path, in caller order, behind the window
/// lane. Replaces any previous sweep. Already-cached paths complete instantly
/// through the worker's cache fast path, so restarting a stopped sweep only
/// pays for what is still missing.
pub fn bulk_previews(window: &tauri::Window, paths: Vec<String>) {
    let jobs = paths
        .into_iter()
        .map(|path| Job { kind: JobKind::Preview, path })
        .collect();
    {
        let mut q = queue().lock().unwrap();
        q.enqueue_bulk(jobs);
        emit_state(window, snapshot(&q));
    }
    notify().notify_one();
    ensure_worker_started(window.clone());
}

/// Public entry point for the `clear_bulk_previews` command.
pub fn clear_bulk(window: &tauri::Window) {
    let mut q = queue().lock().unwrap();
    q.clear_bulk();
    emit_state(window, snapshot(&q));
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
            let popped = q.pop_next();
            if popped.skipped > 0 {
                emit_state(&window, snapshot(&q));
            }
            popped.job
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
    use super::{EnqueueOutcome, Job, JobKind, Popped, PreviewQueue};

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

    /// Pop and unwrap the job, asserting nothing was skipped.
    fn pop(q: &mut PreviewQueue) -> Job {
        let popped = q.pop_next();
        assert_eq!(popped.skipped, 0);
        popped.job.expect("expected a job")
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
        let popped = pop(&mut q);
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
        assert_eq!(pop(&mut q), p("a"));
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
        pop(&mut q);
        pop(&mut q);
        pop(&mut q);
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
        pop(&mut q);
        q.mark_complete(&p("a"));
        assert_eq!(q.total(), 0);
        assert_eq!(q.completed(), 0);
        assert!(!q.is_active());
    }

    #[test]
    fn interleaved_enqueue_during_drain() {
        let mut q = make();
        q.enqueue(previews(&["a", "b"])); // total=2
        pop(&mut q); // a in_flight
        q.mark_complete(&p("a")); // completed=1
        q.enqueue(previews(&["c", "d", "e"])); // total=5
        assert_eq!(q.total(), 5);
        assert_eq!(q.completed(), 1);
        // Drain the rest.
        while let Some(j) = q.pop_next().job {
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
        pop(&mut q);
        q.mark_complete(&p("a")); // "a" failed at generate_preview — still complete
        pop(&mut q);
        q.mark_complete(&p("b"));
        assert!(!q.is_active());
    }

    #[test]
    fn clear_drops_pending_leaves_in_flight() {
        let mut q = make();
        q.enqueue(previews(&["a", "b", "c"]));
        pop(&mut q); // a in_flight
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

    // ─── Bulk lane ──────────────────────────────────────────────────────

    #[test]
    fn bulk_jobs_run_in_caller_order_behind_the_window() {
        let mut q = make();
        q.enqueue_bulk(previews(&["a", "b", "c"]));
        q.enqueue(previews(&["x"]));
        assert_eq!(q.bulk_snapshot(), previews(&["a", "b", "c"]));
        assert_eq!(pop(&mut q), p("x"));
        assert_eq!(pop(&mut q), p("a"));
        assert_eq!(pop(&mut q), p("b"));
        assert_eq!(pop(&mut q), p("c"));
        assert_eq!(q.pop_next(), Popped { job: None, skipped: 0 });
    }

    #[test]
    fn bulk_progress_is_tracked_separately_from_the_window() {
        let mut q = make();
        q.enqueue_bulk(previews(&["a", "b"]));
        q.enqueue(previews(&["x"]));
        assert_eq!((q.total(), q.completed()), (1, 0));
        assert_eq!((q.bulk_total(), q.bulk_completed()), (2, 0));
        assert!(q.is_active());
        assert!(q.bulk_active());

        let x = pop(&mut q);
        q.mark_complete(&x);
        // Window drained → its counters reset; bulk untouched.
        assert!(!q.is_active());
        assert_eq!((q.total(), q.completed()), (0, 0));
        assert_eq!((q.bulk_total(), q.bulk_completed()), (2, 0));

        let a = pop(&mut q);
        q.mark_complete(&a);
        assert_eq!((q.bulk_total(), q.bulk_completed()), (2, 1));
        assert!(q.bulk_active());
        let b = pop(&mut q);
        q.mark_complete(&b);
        assert!(!q.bulk_active());
        assert_eq!((q.bulk_total(), q.bulk_completed()), (0, 0));
    }

    #[test]
    fn navigation_clear_leaves_the_bulk_lane_alone() {
        let mut q = make();
        q.enqueue_bulk(previews(&["a", "b"]));
        q.enqueue(previews(&["x", "y"]));
        q.clear(); // what prefetch_window does on every navigation
        assert_eq!(q.pending_snapshot(), Vec::<Job>::new());
        assert_eq!(q.bulk_snapshot(), previews(&["a", "b"]));
        assert_eq!(q.bulk_total(), 2);
        assert_eq!(pop(&mut q), p("a"));
    }

    #[test]
    fn clear_bulk_drops_pending_and_lets_in_flight_finish() {
        let mut q = make();
        q.enqueue_bulk(previews(&["a", "b", "c"]));
        let a = pop(&mut q);
        q.clear_bulk();
        assert_eq!(q.bulk_snapshot(), Vec::<Job>::new());
        assert!(q.is_in_flight(&a));
        assert!(q.bulk_active());
        assert_eq!(q.pop_next(), Popped { job: None, skipped: 0 });
        q.mark_complete(&a);
        assert!(!q.bulk_active());
        assert_eq!((q.bulk_total(), q.bulk_completed()), (0, 0));
    }

    #[test]
    fn clear_bulk_while_idle_resets_immediately() {
        let mut q = make();
        q.enqueue_bulk(previews(&["a", "b"]));
        q.clear_bulk();
        assert!(!q.bulk_active());
        assert_eq!((q.bulk_total(), q.bulk_completed()), (0, 0));
    }

    #[test]
    fn enqueue_bulk_replaces_the_previous_sweep_and_keeps_running_jobs_in_total() {
        let mut q = make();
        q.enqueue_bulk(previews(&["a", "b", "c"]));
        let a = pop(&mut q);
        let b = pop(&mut q);
        q.mark_complete(&b); // b done: 1/3
        assert_eq!((q.bulk_total(), q.bulk_completed()), (3, 1));

        // Restart with a different list while "a" is still generating.
        let outcome = q.enqueue_bulk(previews(&["c", "d"]));
        assert_eq!(outcome, EnqueueOutcome { added: 2 });
        assert_eq!(q.bulk_snapshot(), previews(&["c", "d"]));
        assert_eq!((q.bulk_total(), q.bulk_completed()), (3, 0)); // 2 new + "a" running

        q.mark_complete(&a);
        assert_eq!((q.bulk_total(), q.bulk_completed()), (3, 1));
        let c = pop(&mut q);
        q.mark_complete(&c);
        let d = pop(&mut q);
        q.mark_complete(&d);
        assert!(!q.bulk_active());
    }

    #[test]
    fn enqueue_bulk_skips_jobs_in_flight_and_batch_duplicates() {
        let mut q = make();
        q.enqueue(previews(&["a"]));
        let a = pop(&mut q); // "a" running through the window lane
        let outcome = q.enqueue_bulk(previews(&["a", "b", "b"]));
        assert_eq!(outcome, EnqueueOutcome { added: 1 });
        assert_eq!(q.bulk_snapshot(), previews(&["b"]));
        assert_eq!(q.bulk_total(), 1);
        q.mark_complete(&a);
        assert!(!q.is_active());
        assert!(q.bulk_active());
    }

    #[test]
    fn a_path_running_in_the_other_lane_is_counted_not_run_twice() {
        let mut q = make();
        q.enqueue_bulk(previews(&["a", "b"]));
        q.enqueue(previews(&["a"]));
        assert_eq!(pop(&mut q), p("a")); // window copy runs
        // Bulk reaches its own "a" while the window copy is in flight: it is
        // counted complete for the bulk lane and "b" is returned instead.
        assert_eq!(q.pop_next(), Popped { job: Some(p("b")), skipped: 1 });
        assert_eq!((q.bulk_total(), q.bulk_completed()), (2, 1));
        q.mark_complete(&p("a")); // completes the WINDOW lane only
        assert!(!q.is_active());
        assert_eq!((q.bulk_total(), q.bulk_completed()), (2, 1));
        q.mark_complete(&p("b"));
        assert!(!q.bulk_active());
    }

    #[test]
    fn bulk_copy_of_a_running_window_job_is_skipped_when_it_surfaces_later() {
        let mut q = make();
        q.enqueue(previews(&["a"]));
        q.enqueue_bulk(previews(&["b", "a"]));
        assert_eq!(pop(&mut q), p("a")); // window copy runs first
        assert_eq!(pop(&mut q), p("b"));
        // Bulk's own "a" surfaces while the window copy is still in flight.
        assert_eq!(q.pop_next(), Popped { job: None, skipped: 1 });
        assert_eq!((q.bulk_total(), q.bulk_completed()), (2, 1));
        q.mark_complete(&p("a"));
        q.mark_complete(&p("b"));
        assert!(!q.is_active());
        assert!(!q.bulk_active());
    }
} // end mod tests
