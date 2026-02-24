import { ipcMain, app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import sharp from 'sharp'
import { parseFitsHeader } from './fitsParser'
import { store } from './settingsHandler'

function getCacheDir(): string {
  const custom = store.get('cachePath') as string
  if (custom) return custom
  return path.join(app.getPath('userData'), 'cache', 'thumbnails')
}

function computeCacheKey(filePath: string, sizeBytes: number, mtimeMs: number): string {
  const hash = crypto.createHash('sha256')
  hash.update(`${filePath}|${sizeBytes}|${mtimeMs}`)
  return hash.digest('hex').substring(0, 16)
}

async function ensureCacheDir(): Promise<string> {
  const dir = getCacheDir()
  await fs.promises.mkdir(dir, { recursive: true })
  return dir
}

// Auto-stretch using STF (Screen Transfer Function) based on median + MAD
function autoStretch(pixels: Float32Array): { shadows: number; midtones: number; highlights: number } {
  const sampleSize = Math.min(pixels.length, 100000)
  const step = Math.max(1, Math.floor(pixels.length / sampleSize))
  const samples: number[] = []

  for (let i = 0; i < pixels.length; i += step) {
    samples.push(pixels[i])
  }
  samples.sort((a, b) => a - b)

  const median = samples[Math.floor(samples.length / 2)]

  const deviations = samples.map((v) => Math.abs(v - median))
  deviations.sort((a, b) => a - b)
  const mad = deviations[Math.floor(deviations.length / 2)] * 1.4826

  const shadows = Math.max(0, median - 2.8 * mad)
  const highlights = 1.0
  const midtones = 0.25

  return { shadows, midtones, highlights }
}

// Midtone Transfer Function
function mtf(m: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return ((m - 1) * x) / ((2 * m - 1) * x - m)
}

// Debayer a single-channel Bayer-pattern image to RGB using bilinear interpolation
function debayer(
  mono: Float32Array,
  width: number,
  height: number,
  pattern: string
): { r: Float32Array; g: Float32Array; b: Float32Array } {
  const r = new Float32Array(width * height)
  const g = new Float32Array(width * height)
  const b = new Float32Array(width * height)

  // Map pattern string to color layout: pattern[row%2 * 2 + col%2]
  // RGGB: (0,0)=R (0,1)=G (1,0)=G (1,1)=B
  const colorAt = (row: number, col: number): string => {
    return pattern[(row % 2) * 2 + (col % 2)]
  }

  const px = (row: number, col: number): number => {
    const cr = Math.max(0, Math.min(height - 1, row))
    const cc = Math.max(0, Math.min(width - 1, col))
    return mono[cr * width + cc]
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const color = colorAt(row, col)
      const val = mono[i]

      if (color === 'R') {
        r[i] = val
        g[i] = (px(row - 1, col) + px(row + 1, col) + px(row, col - 1) + px(row, col + 1)) / 4
        b[i] = (px(row - 1, col - 1) + px(row - 1, col + 1) + px(row + 1, col - 1) + px(row + 1, col + 1)) / 4
      } else if (color === 'B') {
        b[i] = val
        g[i] = (px(row - 1, col) + px(row + 1, col) + px(row, col - 1) + px(row, col + 1)) / 4
        r[i] = (px(row - 1, col - 1) + px(row - 1, col + 1) + px(row + 1, col - 1) + px(row + 1, col + 1)) / 4
      } else {
        // Green pixel
        g[i] = val
        // Determine if R neighbors are horizontal or vertical
        const rowColor0 = pattern[(row % 2) * 2] // color at col=0 on this row
        if (rowColor0 === 'R' || rowColor0 === 'r') {
          // R is on this row: horizontal neighbors are R, vertical neighbors are B
          r[i] = (px(row, col - 1) + px(row, col + 1)) / 2
          b[i] = (px(row - 1, col) + px(row + 1, col)) / 2
        } else {
          // B is on this row: horizontal neighbors are B, vertical neighbors are R
          b[i] = (px(row, col - 1) + px(row, col + 1)) / 2
          r[i] = (px(row - 1, col) + px(row + 1, col)) / 2
        }
      }
    }
  }

  return { r, g, b }
}

// Calculate FWHM (Full Width at Half Maximum) for star quality measurement
function calculateFWHM(
  pixels: Float32Array,
  width: number,
  height: number
): number | null {
  // Background statistics
  const sampleSize = Math.min(pixels.length, 100000)
  const step = Math.max(1, Math.floor(pixels.length / sampleSize))
  const samples: number[] = []
  for (let i = 0; i < pixels.length; i += step) {
    samples.push(pixels[i])
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]
  const deviations = samples.map((v) => Math.abs(v - median))
  deviations.sort((a, b) => a - b)
  const mad = deviations[Math.floor(deviations.length / 2)] * 1.4826
  const threshold = median + 5 * mad

  if (mad < 0.0001) return null // no signal

  // Find local maxima in 5x5 neighborhoods
  const stars: { x: number; y: number; peak: number }[] = []
  const margin = 10
  for (let y = margin; y < height - margin; y++) {
    for (let x = margin; x < width - margin; x++) {
      const val = pixels[y * width + x]
      if (val < threshold) continue

      let isMax = true
      for (let dy = -2; dy <= 2 && isMax; dy++) {
        for (let dx = -2; dx <= 2 && isMax; dx++) {
          if (dx === 0 && dy === 0) continue
          if (pixels[(y + dy) * width + (x + dx)] > val) {
            isMax = false
          }
        }
      }

      if (isMax) {
        stars.push({ x, y, peak: val })
      }
    }
  }

  if (stars.length < 3) return null

  // Measure FWHM for brightest stars (limit 200)
  stars.sort((a, b) => b.peak - a.peak)
  const maxStars = Math.min(stars.length, 200)
  const fwhms: number[] = []

  for (let s = 0; s < maxStars; s++) {
    const { x, y, peak } = stars[s]
    const halfMax = (peak + median) / 2

    // Horizontal FWHM
    let leftX = x
    while (leftX > 0 && pixels[y * width + leftX] > halfMax) leftX--
    let rightX = x
    while (rightX < width - 1 && pixels[y * width + rightX] > halfMax) rightX++
    const hFWHM = rightX - leftX

    // Vertical FWHM
    let topY = y
    while (topY > 0 && pixels[topY * width + x] > halfMax) topY--
    let bottomY = y
    while (bottomY < height - 1 && pixels[bottomY * width + x] > halfMax) bottomY++
    const vFWHM = bottomY - topY

    const fwhm = (hFWHM + vFWHM) / 2

    // Reject unreasonable values
    if (fwhm > 1.5 && fwhm < 30) {
      fwhms.push(fwhm)
    }
  }

  if (fwhms.length < 3) return null

  fwhms.sort((a, b) => a - b)
  return Math.round(fwhms[Math.floor(fwhms.length / 2)] * 100) / 100
}

interface ThumbnailResult {
  outputPath: string
  fwhm: number | null
}

async function generateThumbnail(filePath: string): Promise<ThumbnailResult> {
  const cacheDir = await ensureCacheDir()
  const stat = await fs.promises.stat(filePath)
  const cacheKey = computeCacheKey(filePath, stat.size, stat.mtimeMs)
  const outputPath = path.join(cacheDir, `${cacheKey}.png`)
  const fwhmPath = path.join(cacheDir, `${cacheKey}.fwhm.json`)

  // Check cache
  try {
    await fs.promises.access(outputPath)
    // Read cached FWHM
    let fwhm: number | null = null
    try {
      const fwhmData = await fs.promises.readFile(fwhmPath, 'utf-8')
      fwhm = JSON.parse(fwhmData).fwhm
    } catch { /* no FWHM cache */ }
    return { outputPath, fwhm }
  } catch {
    // Not cached, generate
  }

  const { keywords, headerByteLength } = await parseFitsHeader(filePath)
  const bitpix = (keywords['BITPIX'] as number) || 16
  const naxis1 = (keywords['NAXIS1'] as number) || 0
  const naxis2 = (keywords['NAXIS2'] as number) || 0
  const naxis3 = (keywords['NAXIS3'] as number) || 1
  const bscale = (keywords['BSCALE'] as number) ?? 1
  const bzero = (keywords['BZERO'] as number) ?? 0
  const bayerpat = keywords['BAYERPAT'] as string | undefined

  if (naxis1 === 0 || naxis2 === 0) {
    throw new Error('Invalid FITS dimensions')
  }

  const pixelCount = naxis1 * naxis2
  const channels = naxis3 > 1 ? naxis3 : 1
  const totalPixels = pixelCount * channels
  const bytesPerPixel = Math.abs(bitpix) / 8
  const dataSize = totalPixels * bytesPerPixel

  const fd = await fs.promises.open(filePath, 'r')
  try {
    const dataBuffer = Buffer.alloc(dataSize)
    await fd.read(dataBuffer, 0, dataSize, headerByteLength)

    // Read raw values into float array, apply bscale/bzero
    const rawFloats = new Float32Array(totalPixels)
    const view = new DataView(dataBuffer.buffer, dataBuffer.byteOffset, dataBuffer.byteLength)

    for (let i = 0; i < totalPixels; i++) {
      const offset = i * bytesPerPixel
      let value: number

      switch (bitpix) {
        case 8:
          value = dataBuffer[offset]
          break
        case 16:
          value = view.getInt16(offset, false)
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

      rawFloats[i] = value * bscale + bzero
    }

    // Normalize to [0, 1]
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < rawFloats.length; i++) {
      if (rawFloats[i] < min) min = rawFloats[i]
      if (rawFloats[i] > max) max = rawFloats[i]
    }

    const range = max - min || 1
    const normalized = new Float32Array(rawFloats.length)
    for (let i = 0; i < rawFloats.length; i++) {
      normalized[i] = (rawFloats[i] - min) / range
    }

    // Apply stretch and generate 8-bit buffer
    let outputBuffer: Buffer

    const validBayerPatterns = ['RGGB', 'BGGR', 'GRBG', 'GBRG']
    const hasBayer = channels === 1 && bayerpat && validBayerPatterns.includes(bayerpat.toUpperCase())

    // Calculate FWHM - for Bayer images, compute on luminance after debayering
    let fwhm: number | null = null
    if (hasBayer) {
      // Debayer to RGB, then per-channel STF stretch
      const { r, g, b } = debayer(normalized, naxis1, naxis2, bayerpat!.toUpperCase())

      // Calculate FWHM on luminance channel for accurate star measurement
      const luminance = new Float32Array(pixelCount)
      for (let i = 0; i < pixelCount; i++) {
        luminance[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i]
      }
      fwhm = calculateFWHM(luminance, naxis1, naxis2)

      const stretchR = autoStretch(r)
      const stretchG = autoStretch(g)
      const stretchB = autoStretch(b)

      outputBuffer = Buffer.alloc(pixelCount * 3)
      for (let i = 0; i < pixelCount; i++) {
        // R
        let valR = (r[i] - stretchR.shadows) / (stretchR.highlights - stretchR.shadows)
        valR = Math.max(0, Math.min(1, valR))
        valR = mtf(stretchR.midtones, valR)
        outputBuffer[i * 3] = Math.round(valR * 255)
        // G
        let valG = (g[i] - stretchG.shadows) / (stretchG.highlights - stretchG.shadows)
        valG = Math.max(0, Math.min(1, valG))
        valG = mtf(stretchG.midtones, valG)
        outputBuffer[i * 3 + 1] = Math.round(valG * 255)
        // B
        let valB = (b[i] - stretchB.shadows) / (stretchB.highlights - stretchB.shadows)
        valB = Math.max(0, Math.min(1, valB))
        valB = mtf(stretchB.midtones, valB)
        outputBuffer[i * 3 + 2] = Math.round(valB * 255)
      }

      await sharp(outputBuffer, {
        raw: { width: naxis1, height: naxis2, channels: 3 }
      })
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 6 })
        .toFile(outputPath)
    } else if (channels === 1) {
      // Mono image - calculate FWHM on mono channel
      fwhm = calculateFWHM(normalized, naxis1, naxis2)
      const stretch = autoStretch(normalized)
      outputBuffer = Buffer.alloc(pixelCount)
      for (let i = 0; i < pixelCount; i++) {
        let val = (normalized[i] - stretch.shadows) / (stretch.highlights - stretch.shadows)
        val = Math.max(0, Math.min(1, val))
        val = mtf(stretch.midtones, val)
        outputBuffer[i] = Math.round(val * 255)
      }

      await sharp(outputBuffer, {
        raw: { width: naxis1, height: naxis2, channels: 1 }
      })
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 6 })
        .toFile(outputPath)
    } else {
      // Color image (NAXIS3 planes: typically R, G, B) - calculate FWHM on first channel
      fwhm = calculateFWHM(normalized.subarray(0, pixelCount), naxis1, naxis2)
      outputBuffer = Buffer.alloc(pixelCount * 3)
      for (let c = 0; c < Math.min(channels, 3); c++) {
        const plane = normalized.subarray(c * pixelCount, (c + 1) * pixelCount)
        const stretch = autoStretch(plane)
        for (let i = 0; i < pixelCount; i++) {
          let val = (plane[i] - stretch.shadows) / (stretch.highlights - stretch.shadows)
          val = Math.max(0, Math.min(1, val))
          val = mtf(stretch.midtones, val)
          outputBuffer[i * 3 + c] = Math.round(val * 255)
        }
      }

      await sharp(outputBuffer, {
        raw: { width: naxis1, height: naxis2, channels: 3 }
      })
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 6 })
        .toFile(outputPath)
    }

    // Save FWHM sidecar
    if (fwhm != null) {
      await fs.promises.writeFile(fwhmPath, JSON.stringify({ fwhm })).catch(() => {})
    }

    return { outputPath, fwhm }
  } finally {
    await fd.close()
  }
}

// Concurrency-limited parallel execution
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await fn(items[index])
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  )
  await Promise.all(workers)
}

export function registerThumbnailGenerator(): void {
  ipcMain.handle('thumbnail:generate', async (_event, filePath: string) => {
    const result = await generateThumbnail(filePath)
    return { thumbnailPath: result.outputPath, fwhm: result.fwhm }
  })

  ipcMain.handle('thumbnail:getCached', async (_event, filePath: string) => {
    try {
      const cacheDir = getCacheDir()
      const stat = await fs.promises.stat(filePath)
      const cacheKey = computeCacheKey(filePath, stat.size, stat.mtimeMs)
      const cachedPath = path.join(cacheDir, `${cacheKey}.png`)

      await fs.promises.access(cachedPath)

      // Read cached FWHM
      let fwhm: number | null = null
      try {
        const fwhmPath = path.join(cacheDir, `${cacheKey}.fwhm.json`)
        const fwhmData = await fs.promises.readFile(fwhmPath, 'utf-8')
        fwhm = JSON.parse(fwhmData).fwhm
      } catch { /* no FWHM cache */ }

      return { thumbnailPath: cachedPath, fwhm }
    } catch {
      return null
    }
  })

  ipcMain.handle('thumbnail:getCacheSize', async () => {
    const dir = getCacheDir()
    try {
      const entries = await fs.promises.readdir(dir)
      let totalSize = 0
      let fileCount = 0
      for (const entry of entries) {
        try {
          const stat = await fs.promises.stat(path.join(dir, entry))
          if (stat.isFile()) {
            totalSize += stat.size
            fileCount++
          }
        } catch { /* skip */ }
      }
      return { totalSize, fileCount, path: dir }
    } catch {
      return { totalSize: 0, fileCount: 0, path: dir }
    }
  })

  ipcMain.handle('thumbnail:clearCache', async () => {
    const dir = getCacheDir()
    try {
      const entries = await fs.promises.readdir(dir)
      for (const entry of entries) {
        try {
          await fs.promises.unlink(path.join(dir, entry))
        } catch { /* skip */ }
      }
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('thumbnail:batchGenerate', async (_event, filePaths: string[]) => {
    const results: Record<string, { thumbnailPath: string | null; fwhm: number | null }> = {}
    const window = BrowserWindow.getFocusedWindow()
    let completed = 0

    await runWithConcurrency(filePaths, 4, async (filePath) => {
      try {
        const result = await generateThumbnail(filePath)
        results[filePath] = { thumbnailPath: result.outputPath, fwhm: result.fwhm }
      } catch {
        results[filePath] = { thumbnailPath: null, fwhm: null }
      }

      completed++
      if (window && !window.isDestroyed()) {
        window.webContents.send('thumbnail:progress', {
          current: completed,
          total: filePaths.length,
          filePath
        })
      }
    })

    return results
  })
}
