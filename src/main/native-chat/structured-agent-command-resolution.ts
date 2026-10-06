import type { GlobalSettings } from '../../shared/global-settings-types'
import type { TuiAgent } from '../../shared/tui-agent'
import {
  resolveCliCommand,
  resolveExecutableCommand
} from '../../shared/node-cli-command-resolution'
import {
  hasExplicitTuiLaunchCommand,
  structuredAgentCommandToken
} from '../../shared/tui-agent-launch-command-override'

type CommandSettings = Partial<Pick<GlobalSettings, 'agentCmdOverrides' | 'agentDefaultEnv'>>
type CommandOptions = NonNullable<Parameters<typeof resolveExecutableCommand>[1]>

function resolveOverride(
  agent: TuiAgent,
  settings: CommandSettings | null | undefined,
  options: CommandOptions
) {
  const token = structuredAgentCommandToken(settings?.agentCmdOverrides?.[agent] ?? '')
  const overlay = settings?.agentDefaultEnv?.[agent]
  return token
    ? resolveExecutableCommand(token, {
        ...options,
        pathEnv: options.pathEnv ?? overlay?.PATH ?? overlay?.Path
      })
    : null
}

/** The host verifies executable overrides before offering either structured launch surface. */
export function requiresTuiAgentLaunchCommand(
  settings: CommandSettings | null | undefined,
  agent: TuiAgent
): boolean {
  return (
    hasExplicitTuiLaunchCommand(settings, agent) ||
    Boolean(settings?.agentCmdOverrides?.[agent]?.trim() && !resolveOverride(agent, settings, {}))
  )
}

/** Re-read the existing setting for every session acquisition and catalog probe. */
export function resolveStructuredAgentCommand(
  agent: 'claude' | 'codex',
  settings: CommandSettings,
  options: CommandOptions = {}
): string {
  if (!settings.agentCmdOverrides?.[agent]?.trim()) {
    return resolveCliCommand(agent, options)
  }
  const command = resolveOverride(agent, settings, options)
  if (!command) {
    throw new Error(`${agent} Command must name one executable file for structured chat`)
  }
  return command
}
