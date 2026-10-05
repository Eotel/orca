import { mainProcessState as state } from './main-process-state'

/** The launch record is the first thing an agent launch reads; opening it at startup keeps its cold
 *  open off the first click. Admission still opens it on demand if this fails. */
export function warmAgentLaunchRecordStore(): void {
  state.runtime?.openAgentSessionRecordStore().catch((error: unknown) => {
    console.warn('[agent-launch] could not open the launch record at startup', error)
  })
}
