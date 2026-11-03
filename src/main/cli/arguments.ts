import { COMMANDS, FORMATS, GLOBAL_OPTIONS, findCommand, type CommandName, type CommandSpec, type OptionSpec, type OutputFormat } from './spec'

/** A mistake in how the command was called. Exits with the usage code and points at the command's help. */
export class UsageError extends Error {
  readonly command?: CommandName

  constructor(message: string, command?: CommandName) {
    super(message)
    this.name = 'UsageError'
    this.command = command
  }
}

export type ParsedInvocation =
  | { kind: 'help'; topic?: CommandSpec }
  | { kind: 'version' }
  | { kind: 'command'; command: CommandSpec; positionals: string[]; options: ParsedOptions; format?: OutputFormat }

export type ParsedOptions = Map<string, string[] | true>

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]
    previous[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column]
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1)
      )
      diagonal = above
    }
  }
  return previous[right.length]
}

function suggestion(input: string, candidates: string[]): string {
  const normalized = input.toLowerCase()
  const best = candidates
    .map((candidate) => ({ candidate, distance: editDistance(normalized, candidate) }))
    .sort((left, right) => left.distance - right.distance)[0]
  return best && best.distance <= Math.max(2, Math.floor(normalized.length / 3)) ? ` Did you mean "${best.candidate}"?` : ''
}

function findOption(options: OptionSpec[], token: string): OptionSpec | undefined {
  if (token.startsWith('--')) return options.find((option) => option.name === token.slice(2))
  return options.find((option) => option.short === token.slice(1))
}

/** Splits argv into the command, its positionals, and its options. Global options may appear anywhere. */
export function parseArguments(argv: string[]): ParsedInvocation {
  const optionsByCommand = (command?: CommandSpec): OptionSpec[] => [...(command?.options ?? []), ...GLOBAL_OPTIONS]
  let command: CommandSpec | undefined
  const positionals: string[] = []
  const options: ParsedOptions = new Map()
  let wantsHelp = false
  let wantsVersion = false
  let pendingUnknown: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === '--') {
      const rest = argv.slice(index + 1)
      if (!command && rest.length > 0) {
        command = findCommand(rest[0])
        if (!command) throw new UsageError(`Unknown command "${rest[0]}".${suggestion(rest[0], COMMANDS.flatMap((item) => [item.name, ...item.aliases]))}`)
        rest.shift()
      }
      positionals.push(...rest)
      break
    }

    if (token === '--version' || (!command && token === '-v')) {
      wantsVersion = true
      continue
    }

    if (token.startsWith('-') && token !== '-') {
      const equals = token.startsWith('--') ? token.indexOf('=') : -1
      const flag = equals === -1 ? token : token.slice(0, equals)
      const option = findOption(optionsByCommand(command), flag)
      if (!option) {
        // An option the command defines may come before the command name; check again once it is known.
        if (!command) {
          pendingUnknown ??= flag
          continue
        }
        const known = optionsByCommand(command).map((item) => `--${item.name}`)
        throw new UsageError(`Unknown option "${flag}" for "latch ${command.name}".${suggestion(flag, known)}`, command.name)
      }
      if (option.name === 'help') {
        wantsHelp = true
        continue
      }
      if (!option.value) {
        if (equals !== -1) throw new UsageError(`Option --${option.name} does not take a value.`, command?.name)
        options.set(option.name, true)
        continue
      }
      let value: string | undefined
      if (equals !== -1) {
        value = token.slice(equals + 1)
      } else {
        value = argv[index + 1]
        index += 1
      }
      if (value === undefined) throw new UsageError(`Option --${option.name} needs a value (${option.value}).`, command?.name)
      const current = options.get(option.name)
      options.set(option.name, Array.isArray(current) ? [...current, value] : [value])
      continue
    }

    if (!command) {
      command = findCommand(token)
      if (!command) throw new UsageError(`Unknown command "${token}".${suggestion(token, COMMANDS.flatMap((item) => [item.name, ...item.aliases]))}`)
      continue
    }
    positionals.push(token)
  }

  if (pendingUnknown && !wantsHelp) {
    const option = findOption(optionsByCommand(command), pendingUnknown)
    if (!option) throw new UsageError(`Unknown option "${pendingUnknown}".`, command?.name)
    throw new UsageError(`Put --${option.name} after the command name: latch ${command?.name} … --${option.name}${option.value ? ` <${option.value}>` : ''}.`, command?.name)
  }

  if (wantsHelp) return { kind: 'help', topic: command?.name === 'help' ? undefined : command }
  if (!command) return wantsVersion ? { kind: 'version' } : { kind: 'help' }
  if (command.name === 'version') return { kind: 'version' }
  if (command.name === 'help') {
    if (positionals.length === 0) return { kind: 'help' }
    const topic = findCommand(positionals[0])
    if (!topic) throw new UsageError(`Unknown command "${positionals[0]}".${suggestion(positionals[0], COMMANDS.map((item) => item.name))}`)
    return { kind: 'help', topic: topic.name === 'help' ? undefined : topic }
  }

  const required = command.arguments.filter((argument) => !argument.optional)
  if (positionals.length < required.length) {
    const missing = required[positionals.length]
    throw new UsageError(`Missing <${missing.name}>. ${missing.description}`, command.name)
  }
  if (positionals.length > command.arguments.length) {
    const extra = positionals[command.arguments.length]
    const hint = command.name === 'query' ? ' Quote the SQL as one argument, or pass it with -e or -f.' : ' Quote names that contain spaces.'
    throw new UsageError(`Unexpected argument "${extra}".${hint}`, command.name)
  }

  const formatValues = options.get('format')
  let format: OutputFormat | undefined
  if (Array.isArray(formatValues)) {
    const value = formatValues.at(-1)!.toLowerCase()
    if (!(FORMATS as readonly string[]).includes(value)) throw new UsageError(`Unknown format "${value}". Use ${FORMATS.join(', ')}.`, command.name)
    format = value as OutputFormat
  }

  return { kind: 'command', command, positionals, options, format }
}

export function stringOption(options: ParsedOptions, name: string): string | undefined {
  const value = options.get(name)
  return Array.isArray(value) ? value.at(-1) : undefined
}

export function listOption(options: ParsedOptions, name: string): string[] {
  const value = options.get(name)
  return Array.isArray(value) ? value.flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean) : []
}

export function flagOption(options: ParsedOptions, name: string): boolean {
  return options.get(name) === true
}

export function integerOption(
  options: ParsedOptions,
  name: string,
  limits: { default: number; min: number; max: number },
  command: CommandName
): number {
  const raw = stringOption(options, name)
  if (raw === undefined) return limits.default
  if (!/^\d+$/.test(raw.trim())) throw new UsageError(`--${name} must be a whole number.`, command)
  const value = Number(raw)
  if (value < limits.min || value > limits.max) throw new UsageError(`--${name} must be between ${limits.min} and ${limits.max}.`, command)
  return value
}
