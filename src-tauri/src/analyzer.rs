use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

use rayon::prelude::*;
use tauri::Emitter;

use crate::cancellation;
use crate::types::{AnalyzeProgress, StarDetail, StarsDetailResult, SubAnalysis};

/// Dedicated thread pool for analysis — avoids contention with the global rayon
/// pool that astroimage / other crates may also use.
static ANALYSIS_POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();

fn get_pool() -> &'static rayon::ThreadPool {
    ANALYSIS_POOL.get_or_init(|| {
        let cpus = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        rayon::ThreadPoolBuilder::new()
            .num_threads(cpus)
            .build()
            .unwrap()
    })
}

fn new_analyzer() -> astroimage::ImageAnalyzer {
    astroimage::ImageAnalyzer::new()
        .without_gaussian_fit()
        .with_max_stars(200)
}

pub fn analyze_single(file_path: &str) -> Result<SubAnalysis, String> {
    let analyzer = new_analyzer();

    let result = analyzer
        .analyze(file_path)
        .map_err(|e| format!("Analysis failed for {}: {}", file_path, e))?;

    Ok(SubAnalysis {
        median_fwhm: result.median_fwhm,
        median_eccentricity: result.median_eccentricity,
        stars_detected: result.stars_detected,
    })
}

pub fn analyze_stars_detail(file_path: &str) -> Result<StarsDetailResult, String> {
    let analyzer = new_analyzer();

    let result = analyzer
        .analyze(file_path)
        .map_err(|e| format!("Analysis failed for {}: {}", file_path, e))?;

    let stars: Vec<StarDetail> = result
        .stars
        .iter()
        .map(|s| StarDetail {
            x: s.x,
            y: s.y,
            fwhm: s.fwhm,
            eccentricity: s.eccentricity,
        })
        .collect();

    Ok(StarsDetailResult {
        stars,
        image_width: result.width as u32,
        image_height: result.height as u32,
        median_fwhm: result.median_fwhm,
    })
}

pub fn analyze_batch(
    file_paths: &[String],
    window: Option<&tauri::Window>,
) -> HashMap<String, SubAnalysis> {
    let total = file_paths.len();
    if total == 0 {
        return HashMap::new();
    }

    let counter = AtomicUsize::new(0);
    let results = Mutex::new(HashMap::with_capacity(total));
    let window = window.cloned();

    log::info!("[analyze] starting batch of {} files", total);

    get_pool().install(|| {
        // for_each_init: creates ONE ImageAnalyzer per rayon thread and reuses
        // it across all files that thread processes — avoids re-initializing
        // internal buffers / lookup tables on every single file.
        file_paths.par_iter().for_each_init(
            new_analyzer,
            |analyzer, file_path| {
                if cancellation::is_cancelled("analyze") {
                    return;
                }

                match analyzer
                    .analyze(file_path)
                    .map_err(|e| format!("Analysis failed for {}: {}", file_path, e))
                {
                    Ok(result) => {
                        results.lock().unwrap().insert(
                            file_path.clone(),
                            SubAnalysis {
                                median_fwhm: result.median_fwhm,
                                median_eccentricity: result.median_eccentricity,
                                stars_detected: result.stars_detected,
                            },
                        );
                    }
                    Err(e) => {
                        log::warn!("{}", e);
                    }
                }

                // Emit progress AFTER analysis completes — so the progress bar
                // reflects actually finished files, not just started ones.
                let current = counter.fetch_add(1, Ordering::Relaxed) + 1;
                if let Some(ref w) = window {
                    let _ = w.emit(
                        "analyze:progress",
                        AnalyzeProgress {
                            current,
                            total,
                            file_path: file_path.clone(),
                        },
                    );
                }
            },
        );
    });

    log::info!("[analyze] batch complete");
    results.into_inner().unwrap()
}
