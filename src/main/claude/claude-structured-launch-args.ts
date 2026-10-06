/** Flags supplied by the SDK or owned by Orca's structured transport. */
const OWNED_FLAGS = new Set([
  'print',
  'input-format',
  'output-format',
  'json-schema',
  'verbose',
  'resume',
  'continue',
  'session-id',
  'fork-session',
  'resume-session-at',
  'resume-drops-turn',
  'no-session-persistence',
  'session-mirror',
  'await-initialize',
  'permission-mode',
  'dangerously-skip-permissions',
  'allow-dangerously-skip-permissions',
  'permission-prompt-tool',
  'permission-prompts',
  'allowedTools',
  'disallowedTools',
  'replay-user-messages',
  'include-partial-messages',
  'setting-sources',
  'system-prompt',
  'system-prompt-file',
  'append-system-prompt',
  'append-system-prompt-file'
])

const SHORT_FLAGS: Record<string, string> = {
  '-m': 'model',
  '-d': 'debug',
  '-p': 'print',
  '-r': 'resume',
  '-c': 'continue',
  '-h': 'help',
  '-v': 'version'
}

/** Translate a pinned CLI argv into the SDK's `--key [value]` extraArgs shape. */
export function claudeStructuredExtraArgs(args: readonly string[]): Record<string, string | null> {
  const extraArgs: Record<string, string | null> = {}
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--') {
      break
    }

    const separator = arg.indexOf('=')
    const rawFlag = separator === -1 ? arg : arg.slice(0, separator)
    const flag = rawFlag.startsWith('--') ? rawFlag.slice(2) : SHORT_FLAGS[rawFlag]
    if (!flag || flag === 'help' || flag === 'version') {
      continue
    }

    const inlineValue = separator === -1 ? undefined : arg.slice(separator + 1)
    const next = args[index + 1]
    const hasSeparateValue =
      inlineValue === undefined && next !== undefined && next !== '--' && !next.startsWith('-')
    if (hasSeparateValue) {
      index++
    }
    if (OWNED_FLAGS.has(flag)) {
      continue
    }

    extraArgs[flag] = inlineValue ?? (hasSeparateValue ? next! : null)
  }
  return extraArgs
}
