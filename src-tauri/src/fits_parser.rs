use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use byteorder::{BigEndian, ReadBytesExt};

use crate::types::FitsHeader;

const BLOCK_SIZE: usize = 2880;
const RECORD_SIZE: usize = 80;
const RECORDS_PER_BLOCK: usize = 36;

/// Keyword aliases for different capture software (N.I.N.A., ASIAIR, SGPro, SharpCap, etc.)
fn get_keyword_aliases() -> HashMap<&'static str, Vec<&'static str>> {
    let mut aliases = HashMap::new();
    aliases.insert("EXPTIME", vec!["EXPTIME", "EXPOSURE", "EXP"]);
    aliases.insert(
        "CCD-TEMP",
        vec!["CCD-TEMP", "SET-TEMP", "CCDTEMP", "TEMPERAT", "SENSOR-T"],
    );
    aliases.insert("FILTER", vec!["FILTER", "FILTER1", "FILTREAR"]);
    aliases.insert("OBJECT", vec!["OBJECT", "OBJNAME"]);
    aliases.insert("INSTRUME", vec!["INSTRUME", "CAMERA"]);
    aliases.insert("IMAGETYP", vec!["IMAGETYP", "FRAMETYPE", "FRAME"]);
    aliases.insert("TELESCOP", vec!["TELESCOP", "TELESCOPE"]);
    aliases.insert("DATE-OBS", vec!["DATE-OBS", "DATE_OBS", "DATEOBS"]);
    aliases
}

/// Resolve an alias from the raw keyword map, checking each alias in order
fn resolve_alias(
    raw: &HashMap<String, serde_json::Value>,
    primary_key: &str,
    aliases: &HashMap<&str, Vec<&str>>,
) -> Option<serde_json::Value> {
    if let Some(alias_list) = aliases.get(primary_key) {
        for alias in alias_list {
            if let Some(val) = raw.get(*alias) {
                return Some(val.clone());
            }
        }
        None
    } else {
        raw.get(primary_key).cloned()
    }
}

/// Parse a FITS value field from an 80-character record
fn parse_value_field(field: &str) -> serde_json::Value {
    let trimmed = field.trim();

    // String value: enclosed in single quotes
    if trimmed.starts_with('\'') {
        let rest = &trimmed[1..];
        if let Some(end_quote) = rest.find('\'') {
            let s = rest[..end_quote].trim_end().to_string();
            return serde_json::Value::String(s);
        }
        return serde_json::Value::String(rest.trim_end().to_string());
    }

    // Extract value before comment separator '/'
    let before_comment = trimmed.split('/').next().unwrap_or("").trim();

    // Boolean
    if before_comment == "T" {
        return serde_json::Value::Bool(true);
    }
    if before_comment == "F" {
        return serde_json::Value::Bool(false);
    }

    // Number
    if !before_comment.is_empty() {
        if let Ok(n) = before_comment.parse::<i64>() {
            return serde_json::json!(n);
        }
        if let Ok(n) = before_comment.parse::<f64>() {
            return serde_json::json!(n);
        }
    }

    serde_json::Value::String(before_comment.to_string())
}

/// Parsed raw FITS header
pub struct ParsedFitsHeader {
    pub keywords: HashMap<String, serde_json::Value>,
    pub header_byte_length: usize,
}

/// Parse the FITS header from a file, reading 2880-byte blocks until END keyword
pub fn parse_fits_header(file_path: &str) -> Result<ParsedFitsHeader, String> {
    let mut file = File::open(file_path).map_err(|e| format!("Failed to open FITS file: {}", e))?;
    let mut keywords: HashMap<String, serde_json::Value> = HashMap::new();
    let mut end_found = false;
    let mut total_header_bytes: usize = 0;

    while !end_found {
        let mut block = vec![0u8; BLOCK_SIZE];
        file.seek(SeekFrom::Start(total_header_bytes as u64))
            .map_err(|e| format!("Failed to seek in FITS file: {}", e))?;
        let bytes_read = file
            .read(&mut block)
            .map_err(|e| format!("Failed to read FITS block: {}", e))?;
        if bytes_read < BLOCK_SIZE {
            return Err(format!(
                "Unexpected end of FITS file at byte {}",
                total_header_bytes + bytes_read
            ));
        }
        total_header_bytes += BLOCK_SIZE;

        for r in 0..RECORDS_PER_BLOCK {
            let start = r * RECORD_SIZE;
            let end = start + RECORD_SIZE;
            let record = String::from_utf8_lossy(&block[start..end]);
            let keyword = record[..8].trim_end().to_string();

            if keyword == "END" {
                end_found = true;
                break;
            }

            if keyword == "COMMENT" || keyword == "HISTORY" || keyword.is_empty() {
                continue;
            }

            // Check for '= ' at positions 8-9
            if record.len() >= 10
                && record.as_bytes()[8] == b'='
                && record.as_bytes()[9] == b' '
            {
                let value_field = &record[10..];
                keywords.insert(keyword, parse_value_field(value_field));
            }
        }
    }

    Ok(ParsedFitsHeader {
        keywords,
        header_byte_length: total_header_bytes,
    })
}

/// Helper to extract an optional f64 from a serde_json::Value
fn value_as_f64(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64(),
        _ => None,
    }
}

/// Helper to extract an optional i32 from a serde_json::Value
fn value_as_i32(v: &serde_json::Value) -> Option<i32> {
    match v {
        serde_json::Value::Number(n) => n.as_i64().map(|i| i as i32),
        _ => None,
    }
}

/// Helper to extract an optional String from a serde_json::Value
fn value_as_string(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        _ => None,
    }
}

/// Helper to extract a bool from a serde_json::Value
fn value_as_bool(v: &serde_json::Value) -> Option<bool> {
    match v {
        serde_json::Value::Bool(b) => Some(*b),
        _ => None,
    }
}

/// Map raw FITS keywords to the structured FitsHeader, using keyword aliases
pub fn map_to_fits_header(raw: &HashMap<String, serde_json::Value>) -> FitsHeader {
    let aliases = get_keyword_aliases();

    let simple = raw
        .get("SIMPLE")
        .and_then(value_as_bool)
        .unwrap_or(true);

    let bitpix = raw
        .get("BITPIX")
        .and_then(value_as_i32)
        .unwrap_or(16);

    let naxis = raw
        .get("NAXIS")
        .and_then(value_as_i32)
        .unwrap_or(2);

    let naxis1 = raw
        .get("NAXIS1")
        .and_then(value_as_i32)
        .unwrap_or(0);

    let naxis2 = raw
        .get("NAXIS2")
        .and_then(value_as_i32)
        .unwrap_or(0);

    let naxis3 = raw.get("NAXIS3").and_then(value_as_i32);

    let bscale = raw
        .get("BSCALE")
        .and_then(value_as_f64)
        .unwrap_or(1.0);

    let bzero = raw
        .get("BZERO")
        .and_then(value_as_f64)
        .unwrap_or(0.0);

    let object = resolve_alias(raw, "OBJECT", &aliases).and_then(|v| value_as_string(&v));
    let date_obs = resolve_alias(raw, "DATE-OBS", &aliases).and_then(|v| value_as_string(&v));
    let exptime = resolve_alias(raw, "EXPTIME", &aliases).and_then(|v| value_as_f64(&v));
    let ccd_temp = resolve_alias(raw, "CCD-TEMP", &aliases).and_then(|v| value_as_f64(&v));
    let filter = resolve_alias(raw, "FILTER", &aliases).and_then(|v| value_as_string(&v));
    let instrume = resolve_alias(raw, "INSTRUME", &aliases).and_then(|v| value_as_string(&v));
    let telescop = resolve_alias(raw, "TELESCOP", &aliases).and_then(|v| value_as_string(&v));
    let gain = raw.get("GAIN").and_then(value_as_f64);
    let offset = raw.get("OFFSET").and_then(value_as_f64);
    let imagetyp = resolve_alias(raw, "IMAGETYP", &aliases).and_then(|v| value_as_string(&v));
    let xbinning = raw.get("XBINNING").and_then(value_as_i32);
    let ybinning = raw.get("YBINNING").and_then(value_as_i32);
    let bayerpat = raw.get("BAYERPAT").and_then(|v| value_as_string(v));

    // Convert raw to HashMap<String, serde_json::Value> for the `raw` field
    // Already in correct format

    FitsHeader {
        simple,
        bitpix,
        naxis,
        naxis1,
        naxis2,
        naxis3,
        bscale,
        bzero,
        object,
        date_obs,
        exptime,
        ccd_temp,
        filter,
        instrume,
        telescop,
        gain,
        offset,
        imagetyp,
        xbinning,
        ybinning,
        bayerpat,
        raw: raw.clone(),
    }
}

/// Read a FITS header from file and return the mapped FitsHeader struct
pub fn read_fits_header(file_path: &str) -> Result<FitsHeader, String> {
    let parsed = parse_fits_header(file_path)?;
    Ok(map_to_fits_header(&parsed.keywords))
}

/// Read FITS pixel data with real binary extraction.
/// Reads all channels (NAXIS3), applies BSCALE/BZERO, normalizes to [0,1].
/// Returns f32 pixels in row-major order, all channels concatenated.
pub fn read_fits_pixel_data(file_path: &str) -> Result<crate::types::PixelDataResult, String> {
    let parsed = parse_fits_header(file_path)?;
    let header = map_to_fits_header(&parsed.keywords);

    let width = header.naxis1;
    let height = header.naxis2;
    let channels = header.naxis3.unwrap_or(1).max(1);
    let bitpix = header.bitpix;
    let bscale = header.bscale;
    let bzero = header.bzero;

    if width == 0 || height == 0 {
        return Err("Invalid FITS dimensions".to_string());
    }

    let pixel_count = width as usize * height as usize;
    let total_pixels = pixel_count * channels as usize;
    let bytes_per_pixel = (bitpix.unsigned_abs() / 8) as usize;
    let data_size = total_pixels * bytes_per_pixel;

    let mut file =
        File::open(file_path).map_err(|e| format!("Failed to open FITS file: {}", e))?;
    file.seek(SeekFrom::Start(parsed.header_byte_length as u64))
        .map_err(|e| format!("Failed to seek to pixel data: {}", e))?;

    // Read raw bytes
    let mut data_buf = vec![0u8; data_size];
    file.read_exact(&mut data_buf)
        .map_err(|e| format!("Failed to read pixel data: {}", e))?;

    // Convert to f32 with BSCALE/BZERO
    let mut raw_floats = Vec::with_capacity(total_pixels);
    let mut cursor = std::io::Cursor::new(&data_buf);

    for _ in 0..total_pixels {
        let value: f64 = match bitpix {
            8 => cursor.read_u8().map_err(|e| e.to_string())? as f64,
            16 => cursor.read_i16::<BigEndian>().map_err(|e| e.to_string())? as f64,
            32 => cursor.read_i32::<BigEndian>().map_err(|e| e.to_string())? as f64,
            -32 => cursor.read_f32::<BigEndian>().map_err(|e| e.to_string())? as f64,
            -64 => cursor.read_f64::<BigEndian>().map_err(|e| e.to_string())?,
            _ => return Err(format!("Unsupported BITPIX: {}", bitpix)),
        };
        raw_floats.push((value * bscale + bzero) as f32);
    }

    // Normalize to [0, 1]
    let mut min_val = f32::INFINITY;
    let mut max_val = f32::NEG_INFINITY;
    for &v in &raw_floats {
        if v < min_val {
            min_val = v;
        }
        if v > max_val {
            max_val = v;
        }
    }
    let range = if (max_val - min_val).abs() < f32::EPSILON {
        1.0
    } else {
        max_val - min_val
    };

    let pixels: Vec<f32> = raw_floats.iter().map(|&v| (v - min_val) / range).collect();

    Ok(crate::types::PixelDataResult {
        header,
        pixels,
        width,
        height,
    })
}

/// Batch read FITS headers from multiple files sequentially
/// Returns Vec<Option<FitsHeader>> - None for files that fail to parse
pub fn batch_read_fits_headers(file_paths: &[String]) -> Vec<Option<FitsHeader>> {
    file_paths
        .iter()
        .map(|fp| read_fits_header(fp).ok())
        .collect()
}
