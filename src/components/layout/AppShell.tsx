import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { TopBarSlotProvider } from './TopBarSlot'
import { useImportQueue } from '../../hooks/useImportQueue'
import { useOperationProgress } from '../../hooks/useOperationProgress'

export function AppShell() {
  useImportQueue()
  useOperationProgress()
  const [topBarSlot, setTopBarSlot] = useState<HTMLDivElement | null>(null)

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <TopBar actionsRef={setTopBarSlot} />
        <TopBarSlotProvider slot={topBarSlot}>
          <div className="app-content">
            <Outlet />
          </div>
        </TopBarSlotProvider>
        <StatusBar />
      </div>
    </div>
  )
}
