import { publishAgentLaunchTab } from '@/lib/agent-launch-tab-publication'

export function registerAgentLaunchTabIpcBridge(unsubs: (() => void)[]): void {
  unsubs.push(
    window.api.ui.onPublishAgentLaunchTab((request) => {
      try {
        window.api.ui.replyAgentLaunchTabPublish({
          requestId: request.requestId,
          ...publishAgentLaunchTab(request)
        })
      } catch (error) {
        window.api.ui.replyAgentLaunchTabPublish({
          requestId: request.requestId,
          error: error instanceof Error ? error.message : 'agent_launch_tab_publish_failed'
        })
      }
    })
  )
}
