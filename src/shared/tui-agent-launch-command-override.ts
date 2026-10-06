import type { GlobalSettings } from './global-settings-types'
import type { TuiAgent } from './tui-agent'
import { tokenizeCustomCommandTemplate } from './commit-message-prompt'

/** A single literal executable; the execution host verifies that the file is runnable. */
export function structuredAgentCommandToken(command: string): string | null {
  const input = command.trim()
  if (!input || /[\0\r\n$`]/.test(input)) {
    return null
  }
  const windowsPath = /^(?:["']?)(?:[A-Za-z]:[\\/]|\\\\)/.test(input)
  const parsed = tokenizeCustomCommandTemplate(input, windowsPath ? 'literal' : 'escape')
  if (
    !parsed.ok ||
    parsed.tokens.length !== 1 ||
    parsed.spans.some((span) => span.divergesFromShell)
  ) {
    return null
  }
  const token = parsed.tokens[0]
  return token && !/[|&;<>(){}[\]*?!]/.test(token) ? token : null
}

/** Shell lines retain terminal chat; executable overrides can use structured chat. */
export function hasExplicitTuiLaunchCommand(
  settings: Partial<Pick<GlobalSettings, 'agentCmdOverrides'>> | null | undefined,
  agent: TuiAgent
): boolean {
  const command = settings?.agentCmdOverrides?.[agent]?.trim()
  return Boolean(
    command && ((agent !== 'claude' && agent !== 'codex') || !structuredAgentCommandToken(command))
  )
}
