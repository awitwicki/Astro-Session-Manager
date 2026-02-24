import { Outlet } from 'react-router-dom'
import { Loader } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useThumbnailQueueProcessor } from '../../hooks/useThumbnailQueue'
import { useAppStore } from '../../store/appStore'

function GlobalProgressBar() {
  const progress = useAppStore((s) => s.thumbnailProgress)
  const queueLength = useAppStore((s) => s.thumbnailQueue.length)

  if (!progress) return null

  const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0

  return (
    <div className="global-progress-bar">
      <Loader size={12} className="spinning" />
      <span className="global-progress-label">
        Generating thumbnail: {progress.label} ({progress.current}/{progress.total})
      </span>
      {queueLength > 0 && (
        <span className="global-progress-queued">+{queueLength} queued</span>
      )}
      <div className="progress-bar" style={{ flex: 1, height: 3 }}>
        <div
          className="progress-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function AppShell() {
  useThumbnailQueueProcessor()

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <TopBar />
        <div className="app-content">
          <Outlet />
        </div>
        <GlobalProgressBar />
      </div>
    </div>
  )
}
