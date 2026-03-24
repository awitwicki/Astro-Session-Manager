use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── FITS Header ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FitsHeader {
    pub simple: bool,
    pub bitpix: i32,
    pub naxis: i32,
    pub naxis1: i32,
    pub naxis2: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub naxis3: Option<i32>,
    pub bscale: f64,
    pub bzero: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub object: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_obs: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exptime: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ccd_temp: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instrume: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub telescop: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imagetyp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xbinning: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ybinning: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bayerpat: Option<String>,
    pub raw: HashMap<String, serde_json::Value>,
}

// ─── Scanner Types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FitsFileRef {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionScanNode {
    pub date: String,
    pub path: String,
    pub lights: Vec<FitsFileRef>,
    pub flats: Vec<FitsFileRef>,
    pub darks: Vec<FitsFileRef>,
    pub biases: Vec<FitsFileRef>,
    pub total_size_bytes: u64,
    pub has_notes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterScanNode {
    pub name: String,
    pub path: String,
    pub sessions: Vec<SessionScanNode>,
    pub other_files: Vec<OtherEntry>,
    pub total_size_bytes: u64,
    pub has_notes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScanNode {
    pub name: String,
    pub path: String,
    pub filters: Vec<FilterScanNode>,
    pub total_size_bytes: u64,
    pub has_notes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub root_path: String,
    pub projects: Vec<ProjectScanNode>,
    pub scan_duration_ms: u64,
    pub project_headers: HashMap<String, FitsHeader>,
}

// ─── Masters Types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterFileEntry {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    pub format: String,
    pub exposure_time: f64,
    pub ccd_temp: Option<f64>,
    pub binning: Option<i32>,
    pub resolution: Option<String>,
    pub camera: String,
    pub temp_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherEntry {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MastersLibrary {
    pub darks: Vec<MasterFileEntry>,
    pub biases: Vec<MasterFileEntry>,
    pub other_files: Vec<OtherEntry>,
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterMatch {
    pub dark: Option<MasterFileEntry>,
    pub bias: Option<MasterFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub files: Vec<String>,
}

// ─── Scan Progress ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: String,
    pub current: usize,
    pub total: usize,
    pub file_path: String,
}

// ─── Preview Types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewProgress {
    pub current: usize,
    pub total: usize,
    pub file_path: String,
}

// ─── FITS Preview Types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FitsPreviewResult {
    pub image_data: String,
    pub width: u32,
    pub height: u32,
    pub original_width: u32,
    pub original_height: u32,
    pub header: FitsHeader,
}

// ─── File Operation Types ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    pub copied: usize,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ─── Sub Analysis Types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAnalysis {
    pub median_fwhm: f32,
    pub median_eccentricity: f32,
    pub stars_detected: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeProgress {
    pub current: usize,
    pub total: usize,
    pub file_path: String,
}

// ─── Star Detail Types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarDetail {
    pub x: f32,
    pub y: f32,
    pub fwhm: f32,
    pub eccentricity: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarsDetailResult {
    pub stars: Vec<StarDetail>,
    pub image_width: u32,
    pub image_height: u32,
    pub median_fwhm: f32,
}

// ─── Settings ───────────────────────────────────────────────────────────────

fn default_preview_cache_limit_mb() -> u32 {
    500
}

fn default_preview_concurrency() -> u32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4)
        .min(8)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub root_folder: Option<String>,
    pub theme: String,
    pub cache_path: String,
    pub dark_temp_tolerance: f64,
    pub auto_scan_on_startup: bool,
    pub weather_lat: Option<f64>,
    pub weather_lon: Option<f64>,
    #[serde(default)]
    pub exclude_patterns: String,
    #[serde(default)]
    pub converter_output_path: Option<String>,
    #[serde(default)]
    pub new_project_filter_presets: Vec<String>,
    #[serde(default = "default_preview_cache_limit_mb")]
    pub preview_cache_limit_mb: u32,
    #[serde(default = "default_preview_concurrency")]
    pub preview_concurrency: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            root_folder: None,
            theme: "dark".to_string(),
            cache_path: String::new(),
            dark_temp_tolerance: 2.0,
            auto_scan_on_startup: true,
            weather_lat: None,
            weather_lon: None,
            exclude_patterns: String::new(),
            converter_output_path: None,
            new_project_filter_presets: Vec::new(),
            preview_cache_limit_mb: default_preview_cache_limit_mb(),
            preview_concurrency: default_preview_concurrency(),
        }
    }
}

// ─── Converter Types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawFileInfo {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionResult {
    pub total: usize,
    pub succeeded: usize,
    pub skipped: usize,
    pub failed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionProgress {
    pub current: usize,
    pub total: usize,
    pub filename: String,
    pub source_path: String,
    pub success: bool,
    pub skipped: bool,
    pub error: Option<String>,
}
