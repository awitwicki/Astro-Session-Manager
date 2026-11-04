import { useState, useEffect } from 'react'
import { FolderOpen } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { useTheme } from '../context/ThemeContext'
import { useAppStore } from '../store/appStore'
import { useProjects } from '../hooks/useProjects'
import { useMinorBodies } from '../hooks/useMinorBodies'

export function Settings() {
  const { theme, toggleTheme } = useTheme()
  const rootFolder = useAppStore((s) => s.rootFolder)
  const { selectFolder } = useProjects()
  const minor = useMinorBodies()

  const [darkTempTolerance, setDarkTempTolerance] = useState(2)
  const [warnMissingDarkFlat, setWarnMissingDarkFlat] = useState(true)
  const [autoScan, setAutoScan] = useState(true)
  const [previewCacheLimitMb, setPreviewCacheLimitMb] = useState(500)
  const [previewConcurrency, setPreviewConcurrency] = useState(4)

  useEffect(() => {
    invoke<Record<string, unknown>>('get_all_settings').then((settings) => {
      if (typeof settings.darkTempTolerance === 'number') {
        setDarkTempTolerance(settings.darkTempTolerance)
      }
      if (typeof settings.warnMissingDarkFlat === 'boolean') {
        setWarnMissingDarkFlat(settings.warnMissingDarkFlat)
      }
      if (typeof settings.autoScanOnStartup === 'boolean') {
        setAutoScan(settings.autoScanOnStartup)
      }
      if (typeof settings.previewCacheLimitMb === 'number') {
        setPreviewCacheLimitMb(settings.previewCacheLimitMb)
      }
      if (typeof settings.previewConcurrency === 'number') {
        setPreviewConcurrency(settings.previewConcurrency)
      }
    })
  }, [])

  const saveSetting = (key: string, value: unknown): void => {
    invoke('set_setting', { key, value })
  }

  return (
    <div style={{ maxWidth: 600 }}>
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

      {/* Missing darkflat warning */}
      <div className="settings-group">
        <label className="settings-label">Missing Darkflat Warning</label>
        <p className="settings-description">
          Warn in the WBPP export when exported raw flats have no matching master darkflat.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label className="toggle">
            <input
              type="checkbox"
              checked={warnMissingDarkFlat}
              onChange={(e) => {
                setWarnMissingDarkFlat(e.target.checked)
                saveSetting('warnMissingDarkFlat', e.target.checked)
              }}
            />
            <span className="toggle-slider" />
          </label>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {warnMissingDarkFlat ? 'Enabled' : 'Disabled'}
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

      {/* Comets & asteroids */}
      <div className="settings-group">
        <label className="settings-label">Comets &amp; asteroids</label>
        <p className="settings-description">
          Orbital elements from the Minor Planet Center (observable comets and the Minor Planet Center&apos;s yearly bright-asteroid list). Downloads only when you press the button.
        </p>
        {(['comets', 'asteroids'] as const).map((kind) => {
          const count = minor[kind].length
          const updated = minor.updatedAt[kind]
          const neverDownloaded = updated === null
          const label = kind === 'comets' ? 'Comets' : 'Asteroids'
          const errorText = minor.error[kind]
          return (
            <div key={kind} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, minWidth: 80 }}>{label}</span>
                <span style={{ fontSize: 13, minWidth: 110 }}>
                  {!minor.hydrated ? '…' : neverDownloaded ? 'Not downloaded' : `${count} orbits`}
                </span>
                {updated !== null && (
                  <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    Updated {new Date(updated).toLocaleDateString()}
                  </span>
                )}
                <button
                  className="btn btn-sm"
                  disabled={!minor.hydrated || minor.downloading[kind]}
                  title={`${neverDownloaded ? 'Download' : 'Update'} ${kind}`}
                  aria-label={`${neverDownloaded ? 'Download' : 'Update'} ${kind}`}
                  onClick={() => { void minor.download(kind) }}
                >
                  {minor.downloading[kind] ? 'Downloading…' : neverDownloaded ? 'Download' : 'Update'}
                </button>
              </div>
              {errorText && (
                <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 4 }}>{label}: {errorText}</div>
              )}
            </div>
          )
        })}
      </div>

      {/* Preview Cache Limit */}
      <div className="settings-group">
        <label className="settings-label">Preview Cache Limit</label>
        <p className="settings-description">
          Maximum RAM used for caching image previews. Higher values keep more previews in memory for faster navigation.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min="100"
            max="2000"
            step="100"
            value={previewCacheLimitMb}
            onChange={(e) => {
              const val = Number(e.target.value)
              setPreviewCacheLimitMb(val)
              saveSetting('previewCacheLimitMb', val)
              invoke('update_preview_config', {
                cacheLimitMb: val,
                concurrency: previewConcurrency,
              }).catch(() => {})
            }}
            style={{ width: 200 }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 60 }}>
            {previewCacheLimitMb} MB
          </span>
        </div>
      </div>

      {/* Preview Concurrency */}
      <div className="settings-group">
        <label className="settings-label">Preview Concurrency</label>
        <p className="settings-description">
          Number of images processed simultaneously. Lower values reduce CPU/RAM pressure.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min="1"
            max="16"
            step="1"
            value={previewConcurrency}
            onChange={(e) => {
              const val = Number(e.target.value)
              setPreviewConcurrency(val)
              saveSetting('previewConcurrency', val)
              invoke('update_preview_config', {
                cacheLimitMb: previewCacheLimitMb,
                concurrency: val,
              }).catch(() => {})
            }}
            style={{ width: 200 }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 20 }}>
            {previewConcurrency}
          </span>
        </div>
      </div>
    </div>
  )
}
