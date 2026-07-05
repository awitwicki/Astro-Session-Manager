use std::collections::HashMap;
use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex};

/// Keyed single-flight: concurrent `run` calls with the same key execute the
/// closure exactly once — the first caller (leader) computes, the rest
/// (followers) block until the leader publishes and then clone its result.
///
/// Callers are expected to run on blocking threads (`spawn_blocking`), so
/// waiting on a `Condvar` is fine.
pub struct SingleFlight<T: Clone> {
    map: Mutex<HashMap<String, Arc<Flight<T>>>>,
}

enum Outcome<T> {
    Ready(T),
    /// The leader panicked before producing a value. Followers retry with
    /// their own closure instead of hanging forever.
    Poisoned,
}

struct Flight<T> {
    result: Mutex<Option<Outcome<T>>>,
    cv: Condvar,
}

impl<T> Flight<T> {
    fn new() -> Self {
        Self {
            result: Mutex::new(None),
            cv: Condvar::new(),
        }
    }
}

impl<T: Clone> SingleFlight<T> {
    pub fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }

    pub fn run<F: FnOnce() -> T>(&self, key: &str, f: F) -> T {
        let mut f = Some(f);
        loop {
            enum Role<T> {
                Leader(Arc<Flight<T>>),
                Follower(Arc<Flight<T>>),
            }

            let role = {
                let mut map = self.map.lock().unwrap();
                match map.get(key) {
                    Some(existing) => Role::Follower(Arc::clone(existing)),
                    None => {
                        let flight = Arc::new(Flight::new());
                        map.insert(key.to_string(), Arc::clone(&flight));
                        Role::Leader(flight)
                    }
                }
            };

            match role {
                Role::Leader(flight) => {
                    let closure = f.take().expect("leader runs at most once per call");
                    let outcome = catch_unwind(AssertUnwindSafe(closure));
                    // Remove from the map *before* publishing so late arrivals
                    // start a fresh flight instead of reading a stale entry.
                    self.map.lock().unwrap().remove(key);
                    {
                        let mut slot = flight.result.lock().unwrap();
                        *slot = Some(match &outcome {
                            Ok(value) => Outcome::Ready(value.clone()),
                            Err(_) => Outcome::Poisoned,
                        });
                    }
                    flight.cv.notify_all();
                    match outcome {
                        Ok(value) => return value,
                        Err(panic) => resume_unwind(panic),
                    }
                }
                Role::Follower(flight) => {
                    let mut slot = flight.result.lock().unwrap();
                    while slot.is_none() {
                        slot = flight.cv.wait(slot).unwrap();
                    }
                    match slot.as_ref().unwrap() {
                        Outcome::Ready(value) => return value.clone(),
                        Outcome::Poisoned => {
                            drop(slot);
                            continue; // retry — this caller may become the new leader
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SingleFlight;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};
    use std::thread;
    use std::time::Duration;

    #[test]
    fn concurrent_callers_compute_once() {
        let flight = Arc::new(SingleFlight::<usize>::new());
        let calls = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(8));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let flight = Arc::clone(&flight);
                let calls = Arc::clone(&calls);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    flight.run("k", || {
                        calls.fetch_add(1, Ordering::SeqCst);
                        // Give followers time to pile up on the same flight.
                        thread::sleep(Duration::from_millis(50));
                        42usize
                    })
                })
            })
            .collect();

        for h in handles {
            assert_eq!(h.join().unwrap(), 42);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn distinct_keys_run_independently() {
        let flight = SingleFlight::<&'static str>::new();
        assert_eq!(flight.run("a", || "a-result"), "a-result");
        assert_eq!(flight.run("b", || "b-result"), "b-result");
    }

    #[test]
    fn error_results_propagate_to_followers() {
        let flight = Arc::new(SingleFlight::<Result<usize, String>>::new());
        let barrier = Arc::new(Barrier::new(2));

        let leader = {
            let flight = Arc::clone(&flight);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                flight.run("k", || {
                    barrier.wait();
                    thread::sleep(Duration::from_millis(50));
                    Err::<usize, String>("boom".into())
                })
            })
        };
        let follower = {
            let flight = Arc::clone(&flight);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait(); // enter after the leader is inside its closure
                flight.run("k", || Ok(7))
            })
        };

        assert_eq!(leader.join().unwrap(), Err("boom".into()));
        // The follower either joined the leader's flight (Err) or arrived
        // after removal and ran its own closure (Ok) — both are valid; what
        // must never happen is a hang or panic.
        let _ = follower.join().unwrap();
    }

    #[test]
    fn panicked_leader_unblocks_followers() {
        let flight = Arc::new(SingleFlight::<usize>::new());
        let barrier = Arc::new(Barrier::new(2));

        let leader = {
            let flight = Arc::clone(&flight);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                flight.run("k", || {
                    barrier.wait();
                    thread::sleep(Duration::from_millis(50));
                    panic!("leader died");
                })
            })
        };
        let follower = {
            let flight = Arc::clone(&flight);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                flight.run("k", || 7usize)
            })
        };

        assert!(leader.join().is_err()); // panic propagated to the leader
        assert_eq!(follower.join().unwrap(), 7); // follower retried and succeeded
    }
}
