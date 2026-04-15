import { listen } from '@tauri-apps/api/event'
import { useAppStore, type PreviewQueueState } from '../store/appStore'

let initialized = false

/**
 * Attach the app-lifetime listener for the `preview:queue_state` event.
 * Idempotent — safe to call under React StrictMode double-mount.
 * The returned Promise resolves when the listener is attached. The
 * unlisten handle is intentionally discarded: this listener lives for
 * the lifetime of the app.
 */
export async function initPreviewQueueListener(): Promise<void> {
  if (initialized) return
  initialized = true
  await listen<PreviewQueueState>('preview:queue_state', (event) => {
    useAppStore.getState().setPreviewQueueState(event.payload)
  })
}
