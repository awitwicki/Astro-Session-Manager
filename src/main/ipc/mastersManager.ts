import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { store } from './settingsHandler'
import { parseFitsHeader, mapToFitsHeader } from './fitsParser'
import { parseXisfHeader } from './xisfParser'

const SUPPORTED_EXTENSIONS = new Set(['.fits', '.fit', '.fts', '.xisf'])

interface ScannedFile {
  filename: string
  path: string
  sizeBytes: number
  format: string
}

interface MasterFileEntry {
  filename: string
  path: string
  sizeBytes: number
  format: string
  exposureTime: number
  ccdTemp: number | null
  binning: number | null
  resolution: string | null
  camera: string
  tempSource: 'header' | 'filename' | 'unknown'
}

interface MastersLibrary {
  darks: MasterFileEntry[]
  biases: MasterFileEntry[]
  rootPath: string
}

// Parse metadata from filename template: masterDark_-20C_BIN-1_6248x4176_EXPOSURE-180.00s.xisf
function parseFilenameMetadata(filename: string): {
  ccdTemp: number | null
  binning: number | null
  resolution: string | null
  exposureTime: number | null
} {
  let ccdTemp: number | null = null
  let binning: number | null = null
  let resolution: string | null = null
  let exposureTime: number | null = null

  // Temperature: _-20C_ or _+5C_ or _0C.
  const tempMatch = filename.match(/_([+-]?\d+)C[_.]/)
  if (tempMatch) ccdTemp = parseInt(tempMatch[1])

  // Binning: BIN-1, BIN-2
  const binMatch = filename.match(/BIN-(\d+)/i)
  if (binMatch) binning = parseInt(binMatch[1])

  // Resolution: 6248x4176
  const resMatch = filename.match(/(\d{3,5}x\d{3,5})/)
  if (resMatch) resolution = resMatch[1]

  // Exposure: EXPOSURE-180.00s
  const expMatch = filename.match(/EXPOSURE-(\d+\.?\d*)s/i)
  if (expMatch) exposureTime = parseFloat(expMatch[1])

  return { ccdTemp, binning, resolution, exposureTime }
}

async function scanFilesRecursive(dirPath: string): Promise<ScannedFile[]> {
  const files: ScannedFile[] = []
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        const sub = await scanFilesRecursive(fullPath)
        files.push(...sub)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue
        const stat = await fs.promises.stat(fullPath)
        files.push({
          filename: entry.name,
          path: fullPath,
          sizeBytes: stat.size,
          format: ext.replace('.', '')
        })
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  return files
}

async function parseFileHeader(file: ScannedFile): Promise<Record<string, unknown> | null> {
  try {
    if (file.format === 'xisf') {
      return await parseXisfHeader(file.path)
    } else {
      const { keywords, headerByteLength } = await parseFitsHeader(file.path)
      return mapToFitsHeader(keywords, headerByteLength).header
    }
  } catch {
    return null
  }
}

function extractMeta(
  header: Record<string, unknown> | null,
  filename: string
): {
  exposureTime: number
  ccdTemp: number | null
  binning: number | null
  resolution: string | null
  camera: string
  tempSource: 'header' | 'filename' | 'unknown'
} {
  let exposureTime = 0
  let ccdTemp: number | null = null
  let binning: number | null = null
  let resolution: string | null = null
  let camera = 'Unknown'
  let tempSource: 'header' | 'filename' | 'unknown' = 'unknown'

  if (header) {
    // Exposure (FITS mapped lowercase / XISF raw FITS keywords)
    const exp = (header['exptime'] ?? header['EXPTIME'] ?? header['EXPOSURE']) as
      | number
      | undefined
    if (exp !== undefined) exposureTime = Math.round(exp * 100) / 100

    // Temperature
    const temp = (header['ccdTemp'] ?? header['CCD-TEMP'] ?? header['SET-TEMP']) as
      | number
      | undefined
    if (temp !== undefined) {
      ccdTemp = Math.round(temp)
      tempSource = 'header'
    }

    // Camera
    const instr = (header['instrume'] ?? header['INSTRUME'] ?? header['CAMERA']) as
      | string
      | undefined
    if (instr && typeof instr === 'string' && instr.trim()) {
      camera = instr.trim()
    }

    // Binning
    const bin = (header['xbinning'] ?? header['XBINNING']) as number | undefined
    if (bin !== undefined) binning = bin

    // Resolution
    const naxis1 = (header['naxis1'] ?? header['NAXIS1']) as number | undefined
    const naxis2 = (header['naxis2'] ?? header['NAXIS2']) as number | undefined
    if (naxis1 && naxis2) resolution = `${naxis1}x${naxis2}`
  }

  // Fallback to filename parsing for missing values
  const fnameMeta = parseFilenameMetadata(filename)

  if (ccdTemp === null && fnameMeta.ccdTemp !== null) {
    ccdTemp = fnameMeta.ccdTemp
    tempSource = 'filename'
  }
  if (exposureTime === 0 && fnameMeta.exposureTime !== null) {
    exposureTime = fnameMeta.exposureTime
  }
  if (binning === null && fnameMeta.binning !== null) {
    binning = fnameMeta.binning
  }
  if (resolution === null && fnameMeta.resolution !== null) {
    resolution = fnameMeta.resolution
  }

  return { exposureTime, ccdTemp, binning, resolution, camera, tempSource }
}

function generateFilename(
  type: 'darks' | 'biases',
  meta: {
    ccdTemp: number
    binning: number | null
    resolution: string | null
    exposureTime: number
  },
  ext: string
): string {
  const prefix = type === 'darks' ? 'masterDark' : 'masterBias'
  const tempStr = `${meta.ccdTemp >= 0 ? '+' : ''}${meta.ccdTemp}C`
  const binStr = `BIN-${meta.binning ?? 1}`
  const resStr = meta.resolution ?? 'unknown'

  let name = `${prefix}_${tempStr}_${binStr}_${resStr}`
  if (type === 'darks' && meta.exposureTime > 0) {
    name += `_EXPOSURE-${meta.exposureTime.toFixed(2)}s`
  }
  return `${name}.${ext}`
}

async function scanMasters(rootPath: string): Promise<MastersLibrary> {
  const mastersPath = path.join(rootPath, 'masters')

  // Scan darks
  const darksPath = path.join(mastersPath, 'darks')
  const darkFiles = await scanFilesRecursive(darksPath)

  const darks: MasterFileEntry[] = []
  for (const file of darkFiles) {
    const header = await parseFileHeader(file)
    const meta = extractMeta(header, file.filename)
    darks.push({ ...file, ...meta })
  }
  darks.sort(
    (a, b) =>
      a.exposureTime - b.exposureTime || (a.ccdTemp ?? 0) - (b.ccdTemp ?? 0)
  )

  // Scan biases
  const biasesPath = path.join(mastersPath, 'biases')
  const biasFiles = await scanFilesRecursive(biasesPath)

  const biases: MasterFileEntry[] = []
  for (const file of biasFiles) {
    const header = await parseFileHeader(file)
    const meta = extractMeta(header, file.filename)
    biases.push({ ...file, ...meta })
  }
  biases.sort((a, b) => (a.ccdTemp ?? 0) - (b.ccdTemp ?? 0))

  return { darks, biases, rootPath: mastersPath }
}

export function registerMastersManager(): void {
  ipcMain.handle('masters:scan', async () => {
    const rootFolder = store.get('rootFolder') as string | null
    if (!rootFolder) throw new Error('No root folder configured')
    return await scanMasters(rootFolder)
  })

  ipcMain.handle(
    'masters:findMatch',
    async (
      _event,
      query: { exposureTime: number; ccdTemp: number; tempTolerance?: number }
    ) => {
      const rootFolder = store.get('rootFolder') as string | null
      if (!rootFolder) return null

      const library = await scanMasters(rootFolder)
      const tolerance =
        query.tempTolerance ?? (store.get('darkTempTolerance') as number) ?? 2

      // Find matching darks: exact exposure + closest temperature within tolerance
      const matchingDarks = library.darks
        .filter(
          (f) =>
            Math.abs(f.exposureTime - query.exposureTime) < 0.5 &&
            f.ccdTemp !== null &&
            Math.abs(f.ccdTemp - query.ccdTemp) <= tolerance
        )
        .sort(
          (a, b) =>
            Math.abs((a.ccdTemp ?? 0) - query.ccdTemp) -
            Math.abs((b.ccdTemp ?? 0) - query.ccdTemp)
        )

      return {
        dark: matchingDarks[0] ?? null,
        bias: library.biases[0] ?? null
      }
    }
  )

  ipcMain.handle(
    'masters:import',
    async (
      _event,
      options: {
        files: string[]
        type: 'darks' | 'biases'
        ccdTemp: number
      }
    ) => {
      const rootFolder = store.get('rootFolder') as string | null
      if (!rootFolder) throw new Error('No root folder configured')

      const targetDir = path.join(rootFolder, 'masters', options.type)
      await fs.promises.mkdir(targetDir, { recursive: true })

      const imported: string[] = []
      for (const filePath of options.files) {
        const ext = path.extname(filePath).toLowerCase().replace('.', '')
        const file: ScannedFile = {
          filename: path.basename(filePath),
          path: filePath,
          sizeBytes: 0,
          format: ext
        }

        // Read header to get metadata
        const header = await parseFileHeader(file)
        const meta = extractMeta(header, file.filename)

        // Generate proper filename with user-provided temperature
        const newFilename = generateFilename(
          options.type,
          {
            ccdTemp: options.ccdTemp,
            binning: meta.binning,
            resolution: meta.resolution,
            exposureTime: meta.exposureTime
          },
          ext
        )

        // Find unique target path (add numeric suffix if needed)
        let target = path.join(targetDir, newFilename)
        const baseName = newFilename.replace(`.${ext}`, '')
        let counter = 1
        while (true) {
          try {
            await fs.promises.access(target)
            target = path.join(
              targetDir,
              `${baseName}_${String(counter).padStart(3, '0')}.${ext}`
            )
            counter++
          } catch {
            break // File doesn't exist, safe to use
          }
        }

        try {
          await fs.promises.copyFile(filePath, target)
          imported.push(target)
        } catch {
          /* skip failed copy */
        }
      }

      return { imported: imported.length, files: imported }
    }
  )
}
