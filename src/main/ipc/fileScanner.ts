import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { store } from './settingsHandler'
import { parseFitsHeader, mapToFitsHeader } from './fitsParser'

const FITS_EXTENSIONS = new Set(['.fits', '.fit', '.fts', '.xisf'])

interface FitsFileRef {
  filename: string
  path: string
  sizeBytes: number
  modifiedAt: string
}

interface SessionScanNode {
  date: string
  path: string
  lights: FitsFileRef[]
  flats: FitsFileRef[]
  totalSizeBytes: number
}

interface FilterScanNode {
  name: string
  path: string
  sessions: SessionScanNode[]
  totalSizeBytes: number
}

interface ProjectScanNode {
  name: string
  path: string
  filters: FilterScanNode[]
  totalSizeBytes: number
}

export interface ScanResult {
  rootPath: string
  projects: ProjectScanNode[]
  scanDurationMs: number
}

function isFitsFile(filename: string): boolean {
  return FITS_EXTENSIONS.has(path.extname(filename).toLowerCase())
}

async function listDirSafe(dirPath: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

async function scanFitsFiles(dirPath: string): Promise<FitsFileRef[]> {
  const entries = await listDirSafe(dirPath)
  const refs: FitsFileRef[] = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!isFitsFile(entry.name)) continue

    const fullPath = path.join(dirPath, entry.name)
    try {
      const stat = await fs.promises.stat(fullPath)
      refs.push({
        filename: entry.name,
        path: fullPath,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString()
      })
    } catch {
      // Skip files we can't stat
    }
  }

  return refs.sort((a, b) => a.filename.localeCompare(b.filename))
}

// Find a subdirectory by name, case-insensitive
function findDirCaseInsensitive(
  entries: fs.Dirent[],
  ...names: string[]
): fs.Dirent | undefined {
  const lowerNames = names.map((n) => n.toLowerCase())
  return entries.find((e) => e.isDirectory() && lowerNames.includes(e.name.toLowerCase()))
}

async function scanSession(sessionPath: string, dateName: string): Promise<SessionScanNode> {
  const entries = await listDirSafe(sessionPath)

  // Look for lights/flats subdirectories (case-insensitive: lights, LIGHT, Light, etc.)
  const lightsDir = findDirCaseInsensitive(entries, 'lights', 'light')
  const flatsDir = findDirCaseInsensitive(entries, 'flats', 'flat')

  let lights: FitsFileRef[] = []
  let flats: FitsFileRef[] = []

  if (lightsDir) {
    lights = await scanFitsFiles(path.join(sessionPath, lightsDir.name))
  }

  if (flatsDir) {
    flats = await scanFitsFiles(path.join(sessionPath, flatsDir.name))
  }

  // Also scan FITS files directly in the date folder
  // (some capture software puts files directly here without lights/ subfolder)
  if (lights.length === 0) {
    const directFits = await scanFitsFiles(sessionPath)
    if (directFits.length > 0) {
      lights = directFits
    }
  }

  const totalSizeBytes =
    lights.reduce((s, l) => s + l.sizeBytes, 0) +
    flats.reduce((s, f) => s + f.sizeBytes, 0)

  return {
    date: dateName,
    path: sessionPath,
    lights,
    flats,
    totalSizeBytes
  }
}

async function scanFilter(filterPath: string, filterName: string): Promise<FilterScanNode> {
  const entries = await listDirSafe(filterPath)
  const sessions: SessionScanNode[] = []

  // Each subdirectory is a date/session
  const dirEntries = entries.filter((e) => e.isDirectory())

  await Promise.all(
    dirEntries.map(async (entry) => {
      const session = await scanSession(path.join(filterPath, entry.name), entry.name)
      // Include all sessions, even empty ones
      sessions.push(session)
    })
  )

  // Also check if FITS files are directly in the filter folder
  // (some structures: project/filter/files.fits without date subfolder)
  if (sessions.every((s) => s.lights.length === 0 && s.flats.length === 0)) {
    const directFits = await scanFitsFiles(filterPath)
    if (directFits.length > 0) {
      sessions.push({
        date: 'unsorted',
        path: filterPath,
        lights: directFits,
        flats: [],
        totalSizeBytes: directFits.reduce((s, f) => s + f.sizeBytes, 0)
      })
    }
  }

  sessions.sort((a, b) => a.date.localeCompare(b.date))
  const totalSizeBytes = sessions.reduce((s, sess) => s + sess.totalSizeBytes, 0)
  return { name: filterName, path: filterPath, sessions, totalSizeBytes }
}

async function scanProject(projectPath: string, projectName: string): Promise<ProjectScanNode> {
  const entries = await listDirSafe(projectPath)
  const filters: FilterScanNode[] = []

  const dirEntries = entries.filter((e) => e.isDirectory())

  await Promise.all(
    dirEntries.map(async (entry) => {
      const filter = await scanFilter(path.join(projectPath, entry.name), entry.name)
      // Include all filters, even empty ones
      filters.push(filter)
    })
  )

  filters.sort((a, b) => a.name.localeCompare(b.name))
  const totalSizeBytes = filters.reduce((s, f) => s + f.totalSizeBytes, 0)
  return { name: projectName, path: projectPath, filters, totalSizeBytes }
}

export async function scanRootDirectory(rootPath: string): Promise<ScanResult> {
  const startTime = Date.now()
  const entries = await listDirSafe(rootPath)
  const projects: ProjectScanNode[] = []

  const dirEntries = entries.filter(
    (e) => e.isDirectory() && e.name !== 'masters' && !e.name.startsWith('.')
  )

  // Process up to 10 projects in parallel
  const batchSize = 10
  for (let i = 0; i < dirEntries.length; i += batchSize) {
    const batch = dirEntries.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map((entry) => scanProject(path.join(rootPath, entry.name), entry.name))
    )
    // Include all projects, even empty ones
    projects.push(...batchResults)
  }

  projects.sort((a, b) => a.name.localeCompare(b.name))

  return {
    rootPath,
    projects,
    scanDurationMs: Date.now() - startTime
  }
}

// Enrich scan results with FITS headers (read first light of each session for metadata)
export async function enrichWithHeaders(
  scanResult: ScanResult
): Promise<ScanResult & { projectHeaders: Record<string, Record<string, unknown>> }> {
  const projectHeaders: Record<string, Record<string, unknown>> = {}

  for (const project of scanResult.projects) {
    for (const filter of project.filters) {
      for (const session of filter.sessions) {
        if (session.lights.length > 0) {
          const firstLight = session.lights[0]
          try {
            const { keywords, headerByteLength } = await parseFitsHeader(firstLight.path)
            const mapped = mapToFitsHeader(keywords, headerByteLength)
            projectHeaders[firstLight.path] = mapped.header
          } catch {
            // Skip files that can't be parsed
          }
        }
      }
    }
  }

  return { ...scanResult, projectHeaders }
}

export function registerFileScanner(): void {
  ipcMain.handle('scanner:scanRoot', async () => {
    const rootFolder = store.get('rootFolder') as string | null
    if (!rootFolder) {
      throw new Error('No root folder configured')
    }

    const scanResult = await scanRootDirectory(rootFolder)
    const enriched = await enrichWithHeaders(scanResult)
    return enriched
  })

  ipcMain.handle('scanner:selectRootFolder', async () => {
    const rootFolder = store.get('rootFolder') as string | null
    return rootFolder
  })
}
