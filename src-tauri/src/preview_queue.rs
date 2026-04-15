use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use tauri::Emitter;
use tokio::sync::{Notify, Semaphore};

use crate::fits_preview;
use crate::types::PreviewQueueState;

#[derive(Debug, PartialEq, Eq)]
pub struct EnqueueOutcome {
    pub added: usize,
}

pub struct PreviewQueue {
    pending: VecDeque<String>,
    enqueued: HashSet<String>,
    in_flight: HashSet<String>,
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

    /// Prepend a batch of paths to the front of the queue with dedup:
    /// - If path is in `in_flight`, skip.
    /// - If path is in `pending`, pull it out (will be re-pushed at front).
    /// - Otherwise, increment `total`.
    ///
    /// Order of the returned front reflects the caller's order (paths[0]
    /// ends up at position 0 of `pending`).
    pub fn enqueue(&mut self, paths: Vec<String>) -> EnqueueOutcome {
        let mut added = 0usize;
        // First pass: determine which paths are admissible and in what order,
        // and adjust total for new items.
        let mut to_push: Vec<String> = Vec::with_capacity(paths.len());
        for path in paths {
            if self.in_flight.contains(&path) {
                continue;
            }
            if self.enqueued.contains(&path) {
                // Already pending — remove from its current position.
                if let Some(idx) = self.pending.iter().position(|p| p == &path) {
                    self.pending.remove(idx);
                }
                to_push.push(path);
            } else {
                self.enqueued.insert(path.clone());
                self.total += 1;
                added += 1;
                to_push.push(path);
            }
        }
        // Push to front, preserving caller order: iterate reverse and push_front.
        for path in to_push.into_iter().rev() {
            self.pending.push_front(path);
        }
        EnqueueOutcome { added }
    }

    pub fn pop_next(&mut self) -> Option<String> {
        let path = self.pending.pop_front()?;
        self.in_flight.insert(path.clone());
        Some(path)
    }

    /// Mark a path as completed (success or failure). Must be called exactly
    /// once per `pop_next` return value. Resets counters on full drain.
    pub fn mark_complete(&mut self, path: &str) {
        self.in_flight.remove(path);
        self.enqueued.remove(path);
        self.completed += 1;
        self.check_drain_reset();
    }

    /// Drain `pending` without touching `in_flight`. Counters reset if
    /// `in_flight` is already empty; otherwise they reset when the last
    /// in-flight item completes.
    pub fn clear(&mut self) {
        for path in self.pending.drain(..) {
            self.enqueued.remove(&path);
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
    pub fn is_in_flight(&self, path: &str) -> bool { self.in_flight.contains(path) }

    #[cfg(test)]
    pub fn pending_snapshot(&self) -> Vec<String> {
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

/// Public entry point for `enqueue_previews` command.
pub fn enqueue(window: &tauri::Window, paths: Vec<String>) {
    {
        let mut q = queue().lock().unwrap();
        q.enqueue(paths);
        emit_state(window, snapshot(&q));
    }
    notify().notify_one();
    ensure_worker_started(window.clone());
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

async fn worker_loop(window: tauri::Window) {
    let semaphore = Arc::new(Semaphore::new(fits_preview::concurrent_limit()));
    loop {
        // Pop next path, or wait for a notification if empty.
        let path = {
            let mut q = queue().lock().unwrap();
            q.pop_next()
        };
        let path = match path {
            Some(p) => p,
            None => {
                notify().notified().await;
                continue;
            }
        };

        // Fast path: cache hit — no permit needed.
        if fits_preview::try_cache(&path).is_some() {
            finish(&window, &path);
            continue;
        }

        // Acquire a permit, then spawn a blocking task to generate the preview.
        let permit = match Arc::clone(&semaphore).acquire_owned().await {
            Ok(p) => p,
            Err(_) => {
                // Semaphore closed — shouldn't happen. Mark complete and continue.
                finish(&window, &path);
                continue;
            }
        };
        let window_cloned = window.clone();
        tokio::spawn(async move {
            let _permit = permit; // held for the duration of generate_preview
            let path_for_block = path.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                let _ = fits_preview::generate_preview(&path_for_block);
            })
            .await;
            finish(&window_cloned, &path);
        });
    }
}

fn finish(window: &tauri::Window, path: &str) {
    {
        let mut q = queue().lock().unwrap();
        q.mark_complete(path);
        emit_state(window, snapshot(&q));
    }
    // Wake the worker in case it's idle. (If it's currently popping, the
    // notification is harmless.)
    notify().notify_one();
}

#[cfg(test)]
mod tests {
    use super::{PreviewQueue, EnqueueOutcome};

    fn make() -> PreviewQueue {
        PreviewQueue::new()
    }

    #[test]
    fn enqueue_adds_new_items_to_front() {
        let mut q = make();
        let outcome = q.enqueue(vec!["a".into(), "b".into(), "c".into()]);
        assert_eq!(outcome, EnqueueOutcome { added: 3 });
        assert_eq!(q.total(), 3);
        assert_eq!(q.completed(), 0);
        assert_eq!(q.pending_snapshot(), vec!["a", "b", "c"]);
    }

    #[test]
    fn enqueue_preserves_caller_order_across_calls() {
        let mut q = make();
        q.enqueue(vec!["a".into(), "b".into(), "c".into()]);
        q.enqueue(vec!["d".into(), "e".into()]);
        assert_eq!(q.total(), 5);
        assert_eq!(q.pending_snapshot(), vec!["d", "e", "a", "b", "c"]);
    }

    #[test]
    fn enqueue_dedups_items_already_pending() {
        let mut q = make();
        q.enqueue(vec!["a".into(), "b".into(), "c".into()]);
        // Re-enqueuing "b" should move it to front, not increment total.
        let outcome = q.enqueue(vec!["b".into()]);
        assert_eq!(outcome, EnqueueOutcome { added: 0 });
        assert_eq!(q.total(), 3);
        assert_eq!(q.pending_snapshot(), vec!["b", "a", "c"]);
    }

    #[test]
    fn enqueue_skips_items_in_flight() {
        let mut q = make();
        q.enqueue(vec!["a".into(), "b".into()]);
        // Simulate the worker popping "a".
        let popped = q.pop_next().unwrap();
        assert_eq!(popped, "a");
        assert!(q.is_in_flight("a"));
        // Re-enqueue "a" — should be ignored.
        let outcome = q.enqueue(vec!["a".into()]);
        assert_eq!(outcome, EnqueueOutcome { added: 0 });
        assert_eq!(q.total(), 2);
        assert!(q.is_in_flight("a"));
        assert_eq!(q.pending_snapshot(), vec!["b"]);
    }

    #[test]
    fn mark_complete_then_full_drain_resets_counters() {
        let mut q = make();
        q.enqueue(vec!["a".into(), "b".into(), "c".into()]);
        q.pop_next();
        q.pop_next();
        q.pop_next();
        q.mark_complete("a");
        q.mark_complete("b");
        q.mark_complete("c");
        assert_eq!(q.completed(), 0); // reset after full drain
        // Full drain resets counters.
        assert_eq!(q.total(), 0);
        assert!(!q.is_active());
    }

    #[test]
    fn full_drain_resets_counters_and_deactivates() {
        let mut q = make();
        q.enqueue(vec!["a".into()]);
        assert!(q.is_active());
        q.pop_next();
        q.mark_complete("a");
        assert_eq!(q.total(), 0);
        assert_eq!(q.completed(), 0);
        assert!(!q.is_active());
    }

    #[test]
    fn interleaved_enqueue_during_drain() {
        let mut q = make();
        q.enqueue(vec!["a".into(), "b".into()]); // total=2
        q.pop_next(); // a in_flight
        q.mark_complete("a"); // completed=1
        q.enqueue(vec!["c".into(), "d".into(), "e".into()]); // total=5
        assert_eq!(q.total(), 5);
        assert_eq!(q.completed(), 1);
        // Drain the rest.
        while let Some(p) = q.pop_next() {
            q.mark_complete(&p);
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
        q.enqueue(vec!["a".into(), "b".into()]);
        q.pop_next();
        q.mark_complete("a"); // "a" failed at generate_preview — still complete
        q.pop_next();
        q.mark_complete("b");
        assert!(!q.is_active());
    }

    #[test]
    fn clear_drops_pending_leaves_in_flight() {
        let mut q = make();
        q.enqueue(vec!["a".into(), "b".into(), "c".into()]);
        q.pop_next(); // a in_flight
        q.clear();
        assert!(q.is_in_flight("a"));
        assert_eq!(q.pending_snapshot(), Vec::<String>::new());
        // Counters don't reset yet because in_flight is non-empty.
        assert!(q.is_active());
        q.mark_complete("a");
        // Now drains fully.
        assert!(!q.is_active());
        assert_eq!(q.total(), 0);
    }

    #[test]
    fn clear_with_empty_in_flight_resets_immediately() {
        let mut q = make();
        q.enqueue(vec!["a".into(), "b".into()]);
        q.clear();
        assert!(!q.is_active());
        assert_eq!(q.total(), 0);
        assert_eq!(q.completed(), 0);
    }

} // end mod tests
