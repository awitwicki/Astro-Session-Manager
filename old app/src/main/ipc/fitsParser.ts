import { ipcMain } from 'electron'
import * as fs from 'fs'

const BLOCK_SIZE = 2880
const RECORD_SIZE = 80
const RECORDS_PER_BLOCK = 36

// Keyword aliases for different capture software (N.I.N.A., ASIAIR, SGPro, SharpCap, etc.)
const KEYWORD_ALIASES: Record<string, string[]> = {
  EXPTIME: ['EXPTIME', 'EXPOSURE', 'EXP'],
  'CCD-TEMP': ['CCD-TEMP', 'SET-TEMP', 'CCDTEMP', 'TEMPERAT', 'SENSOR-T'],
  FILTER: ['FILTER', 'FILTER1', 'FILTREAR'],
  OBJECT: ['OBJECT', 'OBJNAME'],
  INSTRUME: ['INSTRUME', 'CAMERA'],
  IMAGETYP: ['IMAGETYP', 'FRAMETYPE', 'FRAME'],
  TELESCOP: ['TELESCOP', 'TELESCOPE'],
  'DATE-OBS': ['DATE-OBS', 'DATE_OBS', 'DATEOBS']
}

function resolveAlias(raw: Record<string, unknown>, primaryKey: string): unknown {
  const aliases = KEYWORD_ALIASES[primaryKey]
  if (!aliases) return raw[primaryKey]
  for (const alias of aliases) {
    if (raw[alias] !== undefined) return raw[alias]
  }
  return undefined
}

function parseValueField(field: string): string | number | boolean {
  const trimmed = field.trim()

  // String value: enclosed in single quotes
  if (trimmed.startsWith("'")) {
    const endQuote = trimmed.indexOf("'", 1)
    if (endQuote !== -1) {
      return trimmed.substring(1, endQuote).trimEnd()
    }
    return trimmed.substring(1).trimEnd()
  }

  // Extract value before comment separator
  const beforeComment = trimmed.split('/')[0].trim()
  if (beforeComment === 'T') return true
  if (beforeComment === 'F') return false

  const num = Number(beforeComment)
  if (!isNaN(num) && beforeComment !== '') return num

  return beforeComment
}

export interface ParsedFitsHeader {
  keywords: Record<string, string | number | boolean>
  headerByteLength: number
}

export async function parseFitsHeader(filePath: string): Promise<ParsedFitsHeader> {
  const fd = await fs.promises.open(filePath, 'r')
  const keywords: Record<string, string | number | boolean> = {}
  let endFound = false
  let totalHeaderBytes = 0

  try {
    while (!endFound) {
      const block = Buffer.alloc(BLOCK_SIZE)
      const { bytesRead } = await fd.read(block, 0, BLOCK_SIZE, totalHeaderBytes)
      if (bytesRead < BLOCK_SIZE) {
        throw new Error(`Unexpected end of FITS file at byte ${totalHeaderBytes + bytesRead}`)
      }
      totalHeaderBytes += BLOCK_SIZE

      for (let r = 0; r < RECORDS_PER_BLOCK; r++) {
        const record = block.subarray(r * RECORD_SIZE, (r + 1) * RECORD_SIZE).toString('ascii')
        const keyword = record.substring(0, 8).trimEnd()

        if (keyword === 'END') {
          endFound = true
          break
        }

        if (keyword === 'COMMENT' || keyword === 'HISTORY' || keyword === '') continue

        if (record[8] === '=' && record[9] === ' ') {
          const valueField = record.substring(10)
          keywords[keyword] = parseValueField(valueField)
        }
      }
    }
  } finally {
    await fd.close()
  }

  return { keywords, headerByteLength: totalHeaderBytes }
}

export function mapToFitsHeader(
  raw: Record<string, string | number | boolean>,
  headerByteLength: number
): {
  header: Record<string, unknown>
  headerByteLength: number
} {
  return {
    header: {
      simple: raw['SIMPLE'] ?? true,
      bitpix: raw['BITPIX'] ?? 16,
      naxis: raw['NAXIS'] ?? 2,
      naxis1: raw['NAXIS1'] ?? 0,
      naxis2: raw['NAXIS2'] ?? 0,
      naxis3: raw['NAXIS3'],
      bscale: (raw['BSCALE'] as number) ?? 1,
      bzero: (raw['BZERO'] as number) ?? 0,
      object: resolveAlias(raw, 'OBJECT') as string | undefined,
      dateObs: resolveAlias(raw, 'DATE-OBS') as string | undefined,
      exptime: resolveAlias(raw, 'EXPTIME') as number | undefined,
      ccdTemp: resolveAlias(raw, 'CCD-TEMP') as number | undefined,
      filter: resolveAlias(raw, 'FILTER') as string | undefined,
      instrume: resolveAlias(raw, 'INSTRUME') as string | undefined,
      telescop: resolveAlias(raw, 'TELESCOP') as string | undefined,
      gain: raw['GAIN'] as number | undefined,
      offset: raw['OFFSET'] as number | undefined,
      imagetyp: resolveAlias(raw, 'IMAGETYP') as string | undefined,
      xbinning: raw['XBINNING'] as number | undefined,
      ybinning: raw['YBINNING'] as number | undefined,
      bayerpat: raw['BAYERPAT'] as string | undefined,
      raw
    },
    headerByteLength
  }
}

export async function readFitsPixelData(
  filePath: string
): Promise<{ header: Record<string, unknown>; pixels: number[]; width: number; height: number }> {
  const { keywords, headerByteLength } = await parseFitsHeader(filePath)
  const mapped = mapToFitsHeader(keywords, headerByteLength)
  const header = mapped.header

  const bitpix = header.bitpix as number
  const naxis1 = header.naxis1 as number
  const naxis2 = header.naxis2 as number
  const naxis3 = (header.naxis3 as number) || 1
  const bscale = header.bscale as number
  const bzero = header.bzero as number

  const pixelCount = naxis1 * naxis2 * naxis3
  const bytesPerPixel = Math.abs(bitpix) / 8
  const dataSize = pixelCount * bytesPerPixel

  const fd = await fs.promises.open(filePath, 'r')
  try {
    const dataBuffer = Buffer.alloc(dataSize)
    await fd.read(dataBuffer, 0, dataSize, headerByteLength)

    const pixels = new Array<number>(pixelCount)
    const view = new DataView(dataBuffer.buffer, dataBuffer.byteOffset, dataBuffer.byteLength)

    for (let i = 0; i < pixelCount; i++) {
      const offset = i * bytesPerPixel
      let value: number

      switch (bitpix) {
        case 8:
          value = dataBuffer[offset]
          break
        case 16:
          value = view.getInt16(offset, false) // big-endian
          break
        case 32:
          value = view.getInt32(offset, false)
          break
        case -32:
          value = view.getFloat32(offset, false)
          break
        case -64:
          value = view.getFloat64(offset, false)
          break
        default:
          value = 0
      }

      pixels[i] = value * bscale + bzero
    }

    return { header, pixels, width: naxis1, height: naxis2 }
  } finally {
    await fd.close()
  }
}

export function registerFitsParser(): void {
  ipcMain.handle('fits:readHeader', async (_event, filePath: string) => {
    try {
      const { keywords, headerByteLength } = await parseFitsHeader(filePath)
      return mapToFitsHeader(keywords, headerByteLength).header
    } catch (error) {
      throw new Error(`Failed to read FITS header: ${error}`)
    }
  })

  ipcMain.handle('fits:readPixelData', async (_event, filePath: string) => {
    try {
      const result = await readFitsPixelData(filePath)
      return {
        header: result.header,
        pixels: result.pixels,
        width: result.width,
        height: result.height
      }
    } catch (error) {
      throw new Error(`Failed to read FITS pixel data: ${error}`)
    }
  })

  ipcMain.handle('fits:batchReadHeaders', async (_event, filePaths: string[]) => {
    const results: Record<string, unknown>[] = []
    // Process in batches of 20 to avoid overwhelming the file system
    const batchSize = 20
    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(async (fp) => {
          try {
            const { keywords, headerByteLength } = await parseFitsHeader(fp)
            return mapToFitsHeader(keywords, headerByteLength).header
          } catch {
            return null
          }
        })
      )
      results.push(...batchResults.filter(Boolean).map((r) => r!))
    }
    return results
  })
}
