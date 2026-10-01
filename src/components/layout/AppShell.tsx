import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { useImportQueue } from '../../hooks/useImportQueue'
import { useOperationProgress } from '../../hooks/useOperationProgress'

export function AppShell() {
  useImportQueue()
  useOperationProgress()

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
