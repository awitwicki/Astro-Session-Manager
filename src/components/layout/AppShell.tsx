import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { useImportQueue } from '../../hooks/useImportQueue'

export function AppShell() {
  useImportQueue()

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <TopBar />
        <div className="app-content">
          <Outlet />
        </div>
        <StatusBar />
      </div>
    </div>
  )
}
