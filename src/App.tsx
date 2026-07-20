import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { AppShell } from './components/layout/AppShell'
import { Dashboard } from './routes/Dashboard'
import { ProjectView } from './routes/ProjectView'
import { FitsDetailView } from './routes/FitsDetailView'
import { MastersLibrary } from './routes/MastersLibrary'
import { Settings } from './routes/Settings'
import { SkyMap } from './routes/SkyMap'
import { Planner } from './routes/Planner'
import { PlannerDetail } from './routes/PlannerDetail'
import { AstroWeather } from './routes/AstroWeather'
import { Calculators } from './routes/Calculators'
import { Converter } from './routes/Converter'
import { initPreviewQueueListener } from './lib/previewQueue'

export default function App() {
  useEffect(() => {
    initPreviewQueueListener().catch(() => {
      // listener failure is non-fatal — progress bar simply won't update
    })
  }, [])

  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/project/:projectName" element={<ProjectView />} />
            <Route path="/fits" element={<FitsDetailView />} />
            <Route path="/masters" element={<MastersLibrary />} />
            <Route path="/skymap" element={<SkyMap />} />
            <Route path="/planner" element={<Planner />} />
            <Route path="/planner/:targetId" element={<PlannerDetail />} />
            <Route path="/astroweather" element={<AstroWeather />} />
            <Route path="/calculators" element={<Calculators />} />
            <Route path="/converter" element={<Converter />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </HashRouter>
    </ThemeProvider>
  )
}
