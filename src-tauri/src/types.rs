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

// ─── Pixel Data Result (dummy for now) ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PixelDataResult {
    pub header: FitsHeader,
    pub pixels: Vec<f64>,
    pub width: i32,
    pub height: i32,
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
    pub total_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterScanNode {
    pub name: String,
    pub path: String,
    pub sessions: Vec<SessionScanNode>,
    pub total_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScanNode {
    pub name: String,
    pub path: String,
    pub filters: Vec<FilterScanNode>,
    pub total_size_bytes: u64,
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
pub struct MastersLibrary {
    pub darks: Vec<MasterFileEntry>,
    pub biases: Vec<MasterFileEntry>,
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

// ─── Thumbnail Types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResult {
    pub thumbnail_path: String,
    pub fwhm: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailProgress {
    pub current: usize,
    pub total: usize,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSizeInfo {
    pub total_size: u64,
    pub file_count: usize,
    pub path: String,
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

// ─── Settings ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub root_folder: Option<String>,
    pub theme: String,
    pub cache_path: String,
    pub thumbnail_size: u32,
    pub dark_temp_tolerance: f64,
    pub auto_scan_on_startup: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            root_folder: None,
            theme: "dark".to_string(),
            cache_path: String::new(),
            thumbnail_size: 400,
            dark_temp_tolerance: 2.0,
            auto_scan_on_startup: true,
        }
    }
}
