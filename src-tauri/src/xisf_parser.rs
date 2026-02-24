use std::collections::HashMap;
use std::fs::File;
use std::io::Read;

use regex::Regex;

use crate::fits_parser::map_to_fits_header;
use crate::types::FitsHeader;

const XISF_SIGNATURE: &[u8] = b"XISF0100";

/// Parse the XML header from an XISF file and extract FITS keywords
fn parse_xisf_xml(xml: &str) -> HashMap<String, serde_json::Value> {
    let mut result: HashMap<String, serde_json::Value> = HashMap::new();

    // Extract FITSKeyword elements: <FITSKeyword name="..." value="..." comment="..." />
    let fits_keyword_re =
        Regex::new(r#"<FITSKeyword\s+name="([^"]+)"\s+value="([^"]*)"\s*(?:comment="[^"]*")?\s*/>"#)
            .expect("Invalid regex");

    for cap in fits_keyword_re.captures_iter(xml) {
        let name = cap[1].trim().to_string();
        let raw_value = cap[2].trim().to_string();

        if raw_value == "T" {
            result.insert(name, serde_json::Value::Bool(true));
        } else if raw_value == "F" {
            result.insert(name, serde_json::Value::Bool(false));
        } else if raw_value.starts_with('\'') {
            // String value in single quotes
            let s = raw_value
                .trim_start_matches('\'')
                .trim_end_matches('\'')
                .trim_end()
                .to_string();
            result.insert(name, serde_json::Value::String(s));
        } else if !raw_value.is_empty() {
            // Try to parse as number
            if let Ok(n) = raw_value.parse::<i64>() {
                result.insert(name, serde_json::json!(n));
            } else if let Ok(n) = raw_value.parse::<f64>() {
                result.insert(name, serde_json::json!(n));
            } else {
                result.insert(name, serde_json::Value::String(raw_value));
            }
        } else {
            result.insert(name, serde_json::Value::String(raw_value));
        }
    }

    // Extract geometry from Image element: <Image geometry="width:height:channels" ...>
    let image_geom_re = Regex::new(r#"geometry="(\d+):(\d+):?(\d+)?""#).expect("Invalid regex");
    if let Some(cap) = image_geom_re.captures(xml) {
        if let Ok(w) = cap[1].parse::<i64>() {
            result.insert("NAXIS1".to_string(), serde_json::json!(w));
        }
        if let Ok(h) = cap[2].parse::<i64>() {
            result.insert("NAXIS2".to_string(), serde_json::json!(h));
        }
        if let Some(c) = cap.get(3) {
            if let Ok(ch) = c.as_str().parse::<i64>() {
                result.insert("NAXIS3".to_string(), serde_json::json!(ch));
            }
        }
    }

    // Extract sampleFormat: <Image ... sampleFormat="Float32" ...>
    let sample_format_re = Regex::new(r#"sampleFormat="([^"]+)""#).expect("Invalid regex");
    if let Some(cap) = sample_format_re.captures(xml) {
        let bitpix = match &cap[1] {
            "UInt8" => 8,
            "UInt16" => 16,
            "UInt32" => 32,
            "Float32" => -32,
            "Float64" => -64,
            _ => -32,
        };
        result.insert("BITPIX".to_string(), serde_json::json!(bitpix));
    }

    result
}

/// Parse an XISF file header and return a FitsHeader struct
pub fn read_xisf_header(file_path: &str) -> Result<FitsHeader, String> {
    let mut file =
        File::open(file_path).map_err(|e| format!("Failed to open XISF file: {}", e))?;

    // Read 16-byte header: 8-byte signature + 4-byte headerLength (LE) + 4 reserved
    let mut sig_buf = [0u8; 16];
    file.read_exact(&mut sig_buf)
        .map_err(|e| format!("Failed to read XISF signature: {}", e))?;

    // Verify signature
    if &sig_buf[0..8] != XISF_SIGNATURE {
        return Err(format!(
            "Not a valid XISF file: expected XISF0100, got {}",
            String::from_utf8_lossy(&sig_buf[0..8])
        ));
    }

    // Read header length (4 bytes, little-endian)
    let header_length = u32::from_le_bytes([sig_buf[8], sig_buf[9], sig_buf[10], sig_buf[11]]) as usize;

    // Read the XML header
    let mut xml_buf = vec![0u8; header_length];
    file.read_exact(&mut xml_buf)
        .map_err(|e| format!("Failed to read XISF XML header: {}", e))?;

    let xml_str = String::from_utf8_lossy(&xml_buf).to_string();
    let raw = parse_xisf_xml(&xml_str);

    Ok(map_to_fits_header(&raw))
}
