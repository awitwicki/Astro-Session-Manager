use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

const BLOCK_SIZE: usize = 2880;
const RECORD_SIZE: usize = 80;

/// Metadata to embed in the FITS header (all optional except dimensions).
pub struct FitsMetadata {
    pub width: usize,
    pub height: usize,
    pub exptime: Option<f64>,
    pub gain: Option<f64>,
    pub date_obs: Option<String>,
    pub instrume: Option<String>,
    pub bayerpat: Option<String>,
}

/// Write a 2D u16 image as a FITS file.
pub fn write_fits_u16(
    path: &Path,
    pixels: &[u16],
    meta: &FitsMetadata,
) -> Result<(), String> {
    let file = File::create(path)
        .map_err(|e| format!("Failed to create FITS file: {}", e))?;
    let mut w = BufWriter::new(file);

    // Build header records
    let mut records: Vec<String> = Vec::new();

    records.push(format_keyword_logical("SIMPLE", true));
    records.push(format_keyword_integer("BITPIX", 16));
    records.push(format_keyword_integer("NAXIS", 2));
    records.push(format_keyword_integer("NAXIS1", meta.width as i64));
    records.push(format_keyword_integer("NAXIS2", meta.height as i64));
    records.push(format_keyword_integer("BZERO", 32768));
    records.push(format_keyword_integer("BSCALE", 1));

    if let Some(v) = meta.exptime {
        records.push(format_keyword_float("EXPTIME", v));
    }
    if let Some(v) = meta.gain {
        records.push(format_keyword_float("GAIN", v));
    }
    if let Some(ref s) = meta.date_obs {
        records.push(format_keyword_string("DATE-OBS", s));
    }
    if let Some(ref s) = meta.instrume {
        records.push(format_keyword_string("INSTRUME", s));
    }
    if let Some(ref s) = meta.bayerpat {
        records.push(format_keyword_string("BAYERPAT", s));
    }

    records.push(format_keyword_string("IMAGETYP", "Light Frame"));
    records.push(format_keyword_integer("XBINNING", 1));
    records.push(format_keyword_integer("YBINNING", 1));

    // END keyword
    let mut end_record = String::from("END");
    while end_record.len() < RECORD_SIZE {
        end_record.push(' ');
    }
    records.push(end_record);

    // Write header padded to 2880-byte blocks
    let mut header_bytes: Vec<u8> = Vec::new();
    for rec in &records {
        header_bytes.extend_from_slice(rec.as_bytes());
    }
    // Pad to next block boundary
    let remainder = header_bytes.len() % BLOCK_SIZE;
    if remainder != 0 {
        header_bytes.extend(std::iter::repeat_n(b' ', BLOCK_SIZE - remainder));
    }

    w.write_all(&header_bytes)
        .map_err(|e| format!("Failed to write FITS header: {}", e))?;

    // BITPIX=16 stores signed big-endian samples; with BZERO=32768 the
    // physical value is `stored + 32768`, so an unsigned sample is stored as
    // `px - 32768` — a plain flip of the sign bit. Writing the raw u16 bytes
    // instead would make every reader see the data offset by 32768 (and wrap
    // anything above 32767).
    let mut data_bytes: Vec<u8> = Vec::with_capacity(pixels.len() * 2);
    for &px in pixels {
        data_bytes.extend_from_slice(&(px ^ 0x8000).to_be_bytes());
    }
    // Pad to next block boundary
    let remainder = data_bytes.len() % BLOCK_SIZE;
    if remainder != 0 {
        data_bytes.extend(std::iter::repeat_n(0u8, BLOCK_SIZE - remainder));
    }

    w.write_all(&data_bytes)
        .map_err(|e| format!("Failed to write FITS data: {}", e))?;

    w.flush()
        .map_err(|e| format!("Failed to flush FITS file: {}", e))?;

    Ok(())
}

fn format_keyword_logical(key: &str, val: bool) -> String {
    let v = if val { "T" } else { "F" };
    let mut rec = format!("{:<8}= {:>20}", key, v);
    while rec.len() < RECORD_SIZE {
        rec.push(' ');
    }
    rec
}

fn format_keyword_integer(key: &str, val: i64) -> String {
    let mut rec = format!("{:<8}= {:>20}", key, val);
    while rec.len() < RECORD_SIZE {
        rec.push(' ');
    }
    rec
}

fn format_keyword_float(key: &str, val: f64) -> String {
    let mut rec = format!("{:<8}= {:>20.10E}", key, val);
    while rec.len() < RECORD_SIZE {
        rec.push(' ');
    }
    rec
}

fn format_keyword_string(key: &str, val: &str) -> String {
    // FITS string values are enclosed in single quotes, left-justified, min 8 chars between quotes
    let padded = format!("{:<8}", val);
    let mut rec = format!("{:<8}= '{}'", key, padded);
    while rec.len() < RECORD_SIZE {
        rec.push(' ');
    }
    rec
}

#[cfg(test)]
mod tests {
    use super::*;
    use astroimage::{ImageConverter, PixelData};

    /// BITPIX=16 + BZERO=32768: samples must survive a round trip through a
    /// standards-following reader, including values above 32767 (which a
    /// writer that stores raw u16 bytes silently wraps).
    #[test]
    fn u16_samples_round_trip_through_fits_reader() {
        let (width, height) = (5usize, 3usize);
        let pixels: Vec<u16> = vec![
            0, 1, 1000, 32767, 32768, //
            40000, 60000, 65535, 7, 8, //
            9, 10, 11, 12, 13,
        ];
        assert_eq!(pixels.len(), width * height);

        let path = std::env::temp_dir().join(format!(
            "asm-fits-writer-roundtrip-{}.fits",
            std::process::id()
        ));
        write_fits_u16(
            &path,
            &pixels,
            &FitsMetadata {
                width,
                height,
                exptime: Some(1.5),
                gain: None,
                date_obs: None,
                instrume: None,
                bayerpat: Some("RGGB".to_string()),
            },
        )
        .unwrap();

        let read = ImageConverter::read_raw(&path);
        let _ = std::fs::remove_file(&path);
        let (meta, data) = read.unwrap();

        assert_eq!((meta.width, meta.height), (width, height));
        match data {
            PixelData::Uint16(v) => assert_eq!(v, pixels),
            PixelData::Float32(_) => panic!("expected 16-bit samples"),
        }
    }
}
