import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../../agent-session/lifecycle/agent-session-resume'
import type { TuiAgent } from '../catalog/tui-agent'
import { YOLO_TUI_AGENT_ARGS } from '../permissions/tui-agent-permissions'
import { resolveStartupShell, type AgentStartupShell } from '../startup/tui-agent-startup-shell'
import {
  resolveTuiAgentLaunchEnv,
  resolveTuiAgentLaunchRawArgs,
  type AgentLaunchProfileSettings
} from './tui-agent-launch-defaults'

const CLAUDE_BYPASS_ARGS = YOLO_TUI_AGENT_ARGS.claude ?? ''

/** Where an unrecorded launch resumes with the Settings Arguments, permission and env. */
export type UnrecordedResumeDefaults = {
  settings: AgentLaunchProfileSettings | null | undefined
  platform: NodeJS.Platform | null | undefined
  shell?: AgentStartupShell
}

/**
 * Replay the recorded recipe. Without one: the Settings defaults when given, else no settings
 * Arguments/env (#29898); either way a Claude that reported bypass keeps it.
 */
export function resolveResumeLaunchRecipe(
  launchConfig: SleepingAgentLaunchConfig | undefined,
  agent: TuiAgent,
  providerSession: AgentProviderSessionMetadata | null | undefined,
  unrecordedDefaults?: UnrecordedResumeDefaults
): SleepingAgentLaunchConfig {
  if (!launchConfig) {
    // Why Claude only: its hooks are the ones that report a root agent's permission mode.
    const bypass = agent === 'claude' && providerSession?.permissionMode === 'bypassPermissions'
    if (unrecordedDefaults) {
      const { settings, platform, shell } = unrecordedDefaults
      return {
        agentArgs: resolveTuiAgentLaunchRawArgs(
          agent,
          settings,
          bypass ? 'full-access' : undefined,
          resolveStartupShell(platform, shell)
        ),
        agentEnv: resolveTuiAgentLaunchEnv(agent, settings, platform)
      }
    }
    return { agentArgs: bypass ? CLAUDE_BYPASS_ARGS : '', agentEnv: {} }
  }
  return {
    agentArgs: launchConfig.agentArgs,
    agentEnv: launchConfig.agentEnv,
    ...(launchConfig.agentCommand ? { agentCommand: launchConfig.agentCommand } : {}),
    ...(launchConfig.ompResumeFilePath ? { ompResumeFilePath: launchConfig.ompResumeFilePath } : {})
  }
}
