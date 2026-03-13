import { create } from 'zustand'
import type { Project, MastersLibrary, SubAnalysisResult } from '../types'

interface ScanResultRaw {
  rootPath: string
  projects: ProjectScanNode[]
  projectHeaders: Record<string, Record<string, unknown>>
  scanDurationMs: number
}

interface ProjectScanNode {
  name: string
  path: string
  filters: FilterScanNode[]
  totalSizeBytes: number
  hasNotes: boolean
}

interface FilterScanNode {
  name: string
  path: string
  sessions: SessionScanNode[]
  totalSizeBytes: number
  hasNotes: boolean
}

interface SessionScanNode {
  date: string
  path: string
  lights: FitsFileRef[]
  flats: FitsFileRef[]
  totalSizeBytes: number
  hasNotes: boolean
}

interface FitsFileRef {
  filename: string
  path: string
  sizeBytes: number
  modifiedAt: string
}

function simpleGlobMatch(text: string, pattern: string): boolean {
  let ti = 0, pi = 0, starPi = -1, starTi = 0
  while (ti < text.length) {
    if (pi < pattern.length && (pattern[pi] === '?' || pattern[pi] === text[ti])) {
      ti++; pi++
    } else if (pi < pattern.length && pattern[pi] === '*') {
      starPi = pi; starTi = ti; pi++
    } else if (starPi !== -1) {
      pi = starPi + 1; starTi++; ti = starTi
    } else {
      return false
    }
  }
  while (pi < pattern.length && pattern[pi] === '*') pi++
  return pi === pattern.length
}

function matchesExcludePattern(name: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false
  const lower = name.toLowerCase()
  return patterns.some((p) => simpleGlobMatch(lower, p.toLowerCase()))
}

function parseExcludePatterns(text: string): string[] {
  return text.split('\n')
    .map((l) => l.trim().replace(/[/\\]+$/, ''))
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

function filterByPatterns(projects: Project[], patterns: string[]): Project[] {
  if (patterns.length === 0) return projects
  return projects
    .filter((p) => !matchesExcludePattern(p.name, patterns))
    .map((p) => ({
      ...p,
      filters: p.filters
        .filter((f) => !matchesExcludePattern(f.name, patterns))
        .map((f) => ({
          ...f,
          sessions: f.sessions.filter((s) => !matchesExcludePattern(s.date, patterns))
        }))
    }))
}

function applyCalibration(projects: Project[], mastersLibrary: MastersLibrary | null, tempTolerance: number): Project[] {
  if (!mastersLibrary) return projects

  return projects.map((p) => ({
    ...p,
    filters: p.filters.map((f) => ({
      ...f,
      sessions: f.sessions.map((s) => {
        if (s.lights.length === 0) return s

        const header = s.lights[0].header
        if (!header) return s

        const exptime = header.exptime ?? 0
        const ccdTemp = header.ccdTemp ?? null
        const resolution =
          header.naxis1 && header.naxis2 ? `${header.naxis1}x${header.naxis2}` : null

        if (exptime === 0 || ccdTemp === null) return s

        const matchingDarks = mastersLibrary.darks.filter(
          (d) =>
            Math.abs(d.exposureTime - exptime) < 0.5 &&
            d.ccdTemp !== null &&
            Math.abs(d.ccdTemp - ccdTemp) <= tempTolerance &&
            (resolution === null || d.resolution === null || d.resolution === resolution)
        )

        const matchingBiases = mastersLibrary.biases.filter(
          (b) =>
            b.ccdTemp !== null &&
            Math.abs(b.ccdTemp - ccdTemp) <= tempTolerance
        )

        return {
          ...s,
          calibration: {
            darksMatched: matchingDarks.length > 0,
            darkGroupName: matchingDarks[0]?.filename,
            darkCount: matchingDarks.length,
            biasCount: matchingBiases.length,
            flatsAvailable: s.flats.length > 0,
            flatCount: s.flats.length
          }
        }
      })
    }))
  }))
}

function buildProjects(scan: ScanResultRaw, mastersLibrary: MastersLibrary | null, tempTolerance: number): Project[] {
  const projects = scan.projects.map((p) => {
    let totalIntegration = 0
    let totalLights = 0
    let totalFlats = 0
    let lastDate: string | null = null

    const filters = p.filters.map((f) => {
      let filterIntegration = 0
      let filterLights = 0

      const sessions = f.sessions.map((s) => {
        const sessionLights = s.lights.length
        filterLights += sessionLights

        // Try to get exposure time from header
        let exptime = 0
        if (s.lights.length > 0) {
          const firstLightPath = s.lights[0].path
          const header = scan.projectHeaders[firstLightPath]
          if (header && typeof header.exptime === 'number') {
            exptime = header.exptime
          }
        }

        const integrationSeconds = exptime * sessionLights
        filterIntegration += integrationSeconds

        // Compute date range from light file modification dates
        let minDate: string | null = null
        let maxDate: string | null = null
        for (const light of s.lights) {
          if (light.modifiedAt) {
            const dateStr = light.modifiedAt.slice(0, 10)
            if (!minDate || dateStr < minDate) minDate = dateStr
            if (!maxDate || dateStr > maxDate) maxDate = dateStr
            if (!lastDate || dateStr > lastDate) {
              lastDate = dateStr
            }
          }
        }

        let subsDateRange: string | null = null
        if (minDate && maxDate) {
          subsDateRange = minDate === maxDate ? minDate : `${minDate} — ${maxDate}`
        }

        return {
          date: s.date,
          path: s.path,
          lights: s.lights.map((l) => ({
            filename: l.filename,
            path: l.path,
            sizeBytes: l.sizeBytes,
            header: scan.projectHeaders[l.path] as unknown as Project['filters'][0]['sessions'][0]['lights'][0]['header']
          })),
          flats: s.flats.map((fl) => ({
            filename: fl.filename,
            path: fl.path,
            sizeBytes: fl.sizeBytes
          })),
          integrationSeconds,
          totalSizeBytes: s.totalSizeBytes,
          calibration: {
            darksMatched: false,
            flatsAvailable: s.flats.length > 0,
            flatCount: s.flats.length
          },
          hasNotes: s.hasNotes,
          subsDateRange
        }
      })

      totalIntegration += filterIntegration
      totalLights += filterLights
      totalFlats += sessions.reduce((sum, s) => sum + s.flats.length, 0)

      return {
        name: f.name,
        path: f.path,
        sessions,
        otherFiles: (f.otherFiles ?? []).map((o: { name: string; path: string; sizeBytes: number; isDir: boolean }) => ({
          name: o.name,
          path: o.path,
          sizeBytes: o.sizeBytes,
          isDir: o.isDir,
        })),
        totalIntegrationSeconds: filterIntegration,
        totalLightFrames: filterLights,
        totalSizeBytes: f.totalSizeBytes,
        hasNotes: f.hasNotes
      }
    })

    return {
      name: p.name,
      path: p.path,
      filters,
      totalIntegrationSeconds: totalIntegration,
      totalLightFrames: totalLights,
      totalFlatFrames: totalFlats,
      totalSizeBytes: p.totalSizeBytes,
      lastCaptureDate: lastDate,
      hasNotes: p.hasNotes
    }
  })

  return applyCalibration(projects, mastersLibrary, tempTolerance)
}

export interface ImportProgress {
  current: number
  total: number
  filename: string
}

interface AppState {
  rootFolder: string | null
  projects: Project[]
  mastersLibrary: MastersLibrary | null
  isScanning: boolean
  scanError: string | null
  excludePatternsText: string
  theme: 'dark' | 'light'
  darkTempTolerance: number
  dashboardViewMode: 'grid' | 'table'
  importProgress: ImportProgress | null
  subAnalysis: Record<string, SubAnalysisResult>
  isAnalyzing: boolean

  setRootFolder: (path: string | null) => void
  setDashboardViewMode: (mode: 'grid' | 'table') => void
  setDarkTempTolerance: (val: number) => void
  setScanResult: (raw: ScanResultRaw) => void
  setScanning: (v: boolean) => void
  setScanError: (err: string | null) => void
  setMastersLibrary: (lib: MastersLibrary) => void
  setTheme: (theme: 'dark' | 'light') => void
  updateCalibration: (projectName: string, filterName: string, date: string, calibration: Project['filters'][0]['sessions'][0]['calibration']) => void
  removeLight: (filePath: string) => void
  removeProject: (projectPath: string) => void
  setImportProgress: (progress: ImportProgress | null) => void
  mergeProjectScan: (raw: ScanResultRaw) => void
  applyExcludePatterns: (patternsText: string) => void
  setSubAnalysis: (data: Record<string, SubAnalysisResult>) => void
  removeSubAnalysis: (paths: string[]) => void
  setAnalyzing: (v: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  rootFolder: null,
  projects: [],
  mastersLibrary: null,
  isScanning: false,
  scanError: null,
  excludePatternsText: '',
  theme: 'dark',

  dashboardViewMode: 'grid',
  darkTempTolerance: 2,
  importProgress: null,
  subAnalysis: {},
  isAnalyzing: false,

  setRootFolder: (path) => set({ rootFolder: path }),

  setDashboardViewMode: (mode) => set({ dashboardViewMode: mode }),

  setDarkTempTolerance: (val) => set((state) => ({
    darkTempTolerance: val,
    projects: applyCalibration(state.projects, state.mastersLibrary, val)
  })),

  setScanResult: (raw) => set((state) => ({
    projects: filterByPatterns(
      buildProjects(raw, state.mastersLibrary, state.darkTempTolerance),
      parseExcludePatterns(state.excludePatternsText)
    ),
    scanError: null
  })),

  setScanning: (v) => set({ isScanning: v }),

  setScanError: (err) => set({ scanError: err }),

  setMastersLibrary: (lib) => set((state) => ({
    mastersLibrary: lib,
    projects: applyCalibration(state.projects, lib, state.darkTempTolerance)
  })),

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },

  updateCalibration: (projectName, filterName, date, calibration) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.name === projectName
          ? {
              ...p,
              filters: p.filters.map((f) =>
                f.name === filterName
                  ? {
                      ...f,
                      sessions: f.sessions.map((s) =>
                        s.date === date ? { ...s, calibration } : s
                      )
                    }
                  : f
              )
            }
          : p
      )
    })),

  setImportProgress: (progress) => set({ importProgress: progress }),

  removeProject: (projectPath) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.path !== projectPath)
    })),

  removeLight: (filePath) =>
    set((state) => ({
      projects: state.projects.map((p) => ({
        ...p,
        filters: p.filters.map((f) => ({
          ...f,
          sessions: f.sessions.map((s) => ({
            ...s,
            lights: s.lights.filter((l) => l.path !== filePath)
          }))
        }))
      }))
    })),

  applyExcludePatterns: (patternsText) => set((state) => ({
    excludePatternsText: patternsText,
    projects: filterByPatterns(state.projects, parseExcludePatterns(patternsText))
  })),

  setSubAnalysis: (data) => set((state) => ({
    subAnalysis: { ...state.subAnalysis, ...data }
  })),

  removeSubAnalysis: (paths) => set((state) => {
    const updated = { ...state.subAnalysis }
    for (const p of paths) delete updated[p]
    return { subAnalysis: updated }
  }),

  setAnalyzing: (v) => set({ isAnalyzing: v }),

  mergeProjectScan: (raw) =>
    set((state) => {
      const patterns = parseExcludePatterns(state.excludePatternsText)
      const updated = filterByPatterns(buildProjects(raw, state.mastersLibrary, state.darkTempTolerance), patterns)
      if (updated.length === 0) return state

      const updatedProject = updated[0]
      const existingIdx = state.projects.findIndex((p) => p.path === updatedProject.path)

      let projects: Project[]
      if (existingIdx >= 0) {
        projects = [...state.projects]
        projects[existingIdx] = updatedProject
      } else {
        projects = [...state.projects, updatedProject].sort((a, b) => a.name.localeCompare(b.name))
      }

      return { projects }
    }),
}))
