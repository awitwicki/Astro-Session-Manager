import { HashRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { AppShell } from './components/layout/AppShell'
import { Dashboard } from './routes/Dashboard'
import { ProjectView } from './routes/ProjectView'
import { FitsDetailView } from './routes/FitsDetailView'
import { MastersLibrary } from './routes/MastersLibrary'
import { Settings } from './routes/Settings'
import { SkyMap } from './routes/SkyMap'
import { Weather } from './routes/Weather'

export default function App() {
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
            <Route path="/weather" element={<Weather />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </HashRouter>
    </ThemeProvider>
  )
}
