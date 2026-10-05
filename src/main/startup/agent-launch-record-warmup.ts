import type { BrowserWindow } from 'electron'
import { mainProcessState as state } from './main-process-state'

// Why a delay after load: the open is ~100-280 ms of synchronous disk work on the main thread
// (measured, loaded machine), and the renderer's own start runs right after its first load.
export const AGENT_LAUNCH_RECORD_WARMUP_DELAY_MS = 1_500

/** The launch record is the first thing an agent launch reads; opening it ahead of the first click
 *  keeps that cost off the click. Admission still opens it on demand if this fails or comes late. */
function warmAgentLaunchRecordStore(): void {
  state.runtime?.openAgentSessionRecordStore().catch((error: unknown) => {
    console.warn('[agent-launch] could not open the launch record at startup', error)
  })
}

function warmLater(): void {
  setTimeout(warmAgentLaunchRecordStore, AGENT_LAUNCH_RECORD_WARMUP_DELAY_MS).unref?.()
}

/** After the window's first load, so startup and the first paint never wait on it. */
export function scheduleAgentLaunchRecordWarmup(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed() || !window.webContents.isLoading()) {
    warmLater()
    return
  }
  window.webContents.once('did-finish-load', warmLater)
}
