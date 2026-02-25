import { useState, useEffect } from 'react'
import { FolderOpen } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { useTheme } from '../context/ThemeContext'
import { useAppStore } from '../store/appStore'
import { useProjects } from '../hooks/useProjects'

export function Settings() {
  const { theme, toggleTheme } = useTheme()
  const rootFolder = useAppStore((s) => s.rootFolder)
  const { selectFolder } = useProjects()

  const [darkTempTolerance, setDarkTempTolerance] = useState(2)
  const [autoScan, setAutoScan] = useState(true)

  useEffect(() => {
    invoke<Record<string, unknown>>('get_all_settings').then((settings) => {
      if (typeof settings.darkTempTolerance === 'number') {
        setDarkTempTolerance(settings.darkTempTolerance)
      }
      if (typeof settings.autoScanOnStartup === 'boolean') {
        setAutoScan(settings.autoScanOnStartup)
      }
    })
  }, [])

  const saveSetting = (key: string, value: unknown): void => {
    invoke('set_setting', { key, value })
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      {/* Root Folder */}
      <div className="settings-group">
        <label className="settings-label">Root Folder</label>
        <p className="settings-description">
          The root directory containing your astrophotography projects and masters.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="settings-input"
            value={rootFolder || 'Not selected'}
            readOnly
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={selectFolder}>
            <FolderOpen size={14} />
            Browse
          </button>
        </div>
      </div>

      {/* Theme */}
      <div className="settings-group">
        <label className="settings-label">Theme</label>
        <p className="settings-description">Switch between dark and light appearance.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label className="toggle">
            <input
              type="checkbox"
              checked={theme === 'light'}
              onChange={toggleTheme}
            />
            <span className="toggle-slider" />
          </label>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {theme === 'dark' ? 'Dark' : 'Light'} mode
          </span>
        </div>
      </div>

      {/* Dark Temperature Tolerance */}
      <div className="settings-group">
        <label className="settings-label">Dark Frame Temperature Tolerance</label>
        <p className="settings-description">
          Maximum temperature difference (in C) when matching darks to lights. Default: 2C.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            value={darkTempTolerance}
            onChange={(e) => {
              const val = Number(e.target.value)
              setDarkTempTolerance(val)
              saveSetting('darkTempTolerance', val)
            }}
            style={{ width: 200 }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 40 }}>
            +/-{darkTempTolerance}C
          </span>
        </div>
      </div>

      {/* Auto Scan */}
      <div className="settings-group">
        <label className="settings-label">Auto Scan on Startup</label>
        <p className="settings-description">
          Automatically scan the root folder when the app starts.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoScan}
              onChange={(e) => {
                setAutoScan(e.target.checked)
                saveSetting('autoScanOnStartup', e.target.checked)
              }}
            />
            <span className="toggle-slider" />
          </label>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {autoScan ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </div>
    </div>
  )
}
