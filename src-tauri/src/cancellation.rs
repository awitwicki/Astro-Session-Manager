use std::sync::atomic::{AtomicBool, Ordering};

static CANCEL_SCAN: AtomicBool = AtomicBool::new(false);
static CANCEL_ANALYZE: AtomicBool = AtomicBool::new(false);
static CANCEL_IMPORT: AtomicBool = AtomicBool::new(false);

pub fn is_cancelled(operation: &str) -> bool {
    match operation {
        "scan" => CANCEL_SCAN.load(Ordering::Relaxed),
        "analyze" => CANCEL_ANALYZE.load(Ordering::Relaxed),
        "import" => CANCEL_IMPORT.load(Ordering::Relaxed),
        _ => false,
    }
}

pub fn request_cancel(operation: &str) {
    match operation {
        "scan" => CANCEL_SCAN.store(true, Ordering::Relaxed),
        "analyze" => CANCEL_ANALYZE.store(true, Ordering::Relaxed),
        "import" => CANCEL_IMPORT.store(true, Ordering::Relaxed),
        _ => {}
    }
}

pub fn reset_cancel(operation: &str) {
    match operation {
        "scan" => CANCEL_SCAN.store(false, Ordering::Relaxed),
        "analyze" => CANCEL_ANALYZE.store(false, Ordering::Relaxed),
        "import" => CANCEL_IMPORT.store(false, Ordering::Relaxed),
        _ => {}
    }
}
