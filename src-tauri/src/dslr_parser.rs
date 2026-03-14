use std::fs::File;
use std::io::BufReader;

use nom_exif::{Exif, ExifIter, ExifTag, EntryValue, MediaParser, MediaSource};

use crate::types::FitsHeader;

/// Read EXIF metadata from a DSLR raw file and return a minimal FitsHeader.
/// Only extracts: ExposureTime, DateTimeOriginal, ISO (gain), Camera model (instrume).
pub fn read_dslr_header(path: &str) -> Result<FitsHeader, String> {
    let mut parser = MediaParser::new();
    let file = File::open(path).map_err(|e| format!("Failed to open DSLR file: {}", e))?;
    let reader = BufReader::new(file);
    let ms = MediaSource::unseekable(reader)
        .map_err(|e| format!("Failed to create media source: {}", e))?;
    let iter: ExifIter = parser.parse(ms)
        .map_err(|e| format!("Failed to parse EXIF data: {}", e))?;
    let exif: Exif = iter.into();

    let mut header = FitsHeader::default();

    // ExposureTime
    if let Some(val) = exif.get(ExifTag::ExposureTime) {
        match val {
            EntryValue::URational(r) => {
                header.exptime = Some(r.0 as f64 / r.1 as f64);
            }
            EntryValue::F64(v) => {
                header.exptime = Some(*v);
            }
            _ => {}
        }
    }

    // DateTimeOriginal
    if let Some(val) = exif.get(ExifTag::DateTimeOriginal) {
        if let Some(s) = val.as_str() {
            header.date_obs = Some(s.to_string());
        }
    }

    // ISO (ISOSpeedRatings)
    if let Some(val) = exif.get(ExifTag::ISOSpeedRatings) {
        match val {
            EntryValue::U16(v) => header.gain = Some(*v as f64),
            EntryValue::U32(v) => header.gain = Some(*v as f64),
            _ => {}
        }
    }

    // Camera model
    if let Some(val) = exif.get(ExifTag::Model) {
        if let Some(s) = val.as_str() {
            header.instrume = Some(s.trim_matches('"').to_string());
        }
    }

    Ok(header)
}
