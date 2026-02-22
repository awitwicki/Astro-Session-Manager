import { create } from 'zustand'
import type { Project, MastersLibrary } from '../types'

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
}

interface FilterScanNode {
  name: string
  path: string
  sessions: SessionScanNode[]
  totalSizeBytes: number
}

interface SessionScanNode {
  date: string
  path: string
  lights: FitsFileRef[]
  flats: FitsFileRef[]
  totalSizeBytes: number
}

interface FitsFileRef {
  filename: string
  path: string
  sizeBytes: number
  modifiedAt: string
}

function buildProjects(scan: ScanResultRaw): Project[] {
  return scan.projects.map((p) => {
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

        if (s.date && (!lastDate || s.date > lastDate)) {
          lastDate = s.date
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
            biasMatched: false,
            flatsAvailable: s.flats.length > 0,
            flatCount: s.flats.length
          }
        }
      })

      totalIntegration += filterIntegration
      totalLights += filterLights
      totalFlats += sessions.reduce((sum, s) => sum + s.flats.length, 0)

      return {
        name: f.name,
        path: f.path,
        sessions,
        totalIntegrationSeconds: filterIntegration,
        totalLightFrames: filterLights,
        totalSizeBytes: f.totalSizeBytes
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
      lastCaptureDate: lastDate
    }
  })
}

interface AppState {
  rootFolder: string | null
  projects: Project[]
  mastersLibrary: MastersLibrary | null
  isScanning: boolean
  scanError: string | null
  theme: 'dark' | 'light'
  thumbnailPaths: Record<string, string>
  fwhmData: Record<string, number>

  setRootFolder: (path: string | null) => void
  setScanResult: (raw: ScanResultRaw) => void
  setScanning: (v: boolean) => void
  setScanError: (err: string | null) => void
  setMastersLibrary: (lib: MastersLibrary) => void
  setTheme: (theme: 'dark' | 'light') => void
  setThumbnailPath: (filePath: string, thumbnailPath: string) => void
  setThumbnailPathBatch: (data: Record<string, string>) => void
  setFwhm: (filePath: string, fwhm: number) => void
  setFwhmBatch: (data: Record<string, number>) => void
  updateCalibration: (projectName: string, filterName: string, date: string, calibration: Project['filters'][0]['sessions'][0]['calibration']) => void
  removeLight: (filePath: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  rootFolder: null,
  projects: [],
  mastersLibrary: null,
  isScanning: false,
  scanError: null,
  theme: 'dark',
  thumbnailPaths: {},
  fwhmData: {},

  setRootFolder: (path) => set({ rootFolder: path }),

  setScanResult: (raw) => set({ projects: buildProjects(raw), scanError: null }),

  setScanning: (v) => set({ isScanning: v }),

  setScanError: (err) => set({ scanError: err }),

  setMastersLibrary: (lib) => set({ mastersLibrary: lib }),

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },

  setThumbnailPath: (filePath, thumbnailPath) =>
    set((state) => ({
      thumbnailPaths: { ...state.thumbnailPaths, [filePath]: thumbnailPath }
    })),

  setThumbnailPathBatch: (data) =>
    set((state) => ({
      thumbnailPaths: { ...state.thumbnailPaths, ...data }
    })),

  setFwhm: (filePath, fwhm) =>
    set((state) => ({
      fwhmData: { ...state.fwhmData, [filePath]: fwhm }
    })),

  setFwhmBatch: (data) =>
    set((state) => ({
      fwhmData: { ...state.fwhmData, ...data }
    })),

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
    }))
}))
