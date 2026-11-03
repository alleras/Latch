import { COMMANDS, EXIT_CODES, GLOBAL_OPTIONS, type CommandSpec, type OptionSpec } from './spec'

function optionLabel(option: OptionSpec): string {
  const long = `--${option.name}${option.value ? ` <${option.value}>` : ''}`
  return option.short ? `-${option.short}, ${long}` : `    ${long}`
}

function columns(rows: Array<[string, string]>, indent = 2): string[] {
  const width = Math.min(34, Math.max(...rows.map(([label]) => label.length)))
  return rows.map(([label, description]) => {
    const padding = label.length > width ? `\n${' '.repeat(indent + width + 2)}` : ' '.repeat(width - label.length + 2)
    return `${' '.repeat(indent)}${label}${padding}${description}`
  })
}

function usageLine(command: CommandSpec): string {
  const argumentsText = command.arguments.map((argument) => argument.optional ? `[${argument.name}]` : `<${argument.name}>`).join(' ')
  return `latch ${command.name}${argumentsText ? ` ${argumentsText}` : ''}${command.options.length > 0 ? ' [options]' : ''}`
}

export function generalHelp(version: string): string {
  const visible = COMMANDS.filter((command) => command.name !== 'version')
  return [
    `latch ${version}: query the database connections saved in the Latch app`,
    '',
    'Usage:',
    '  latch <command> [arguments] [options]',
    '',
    'Commands:',
    ...columns(visible.map((command) => [usageLine(command).replace(/^latch /, '').replace(' [options]', ''), command.summary])),
    '',
    'Global options:',
    ...columns([...GLOBAL_OPTIONS.map((option): [string, string] => [optionLabel(option), option.description]), ['    --version', 'Print the Latch version.']]),
    '',
    'Getting started (for people, scripts, and AI agents):',
    '  1. latch connections                                  find a connection name',
    '  2. latch databases <connection>                       pick a database',
    '  3. latch objects <connection> --db <db> --filter x    find tables and views',
    '  4. latch describe <connection> <table> --db <db>      see columns and keys',
    '  5. latch query <connection> --db <db> "SELECT ..."    run SQL (read-only)',
    '',
    'Access:',
    '  Connections are hidden until enabled in Latch > Settings > Command line, as Read-only',
    '  or Read & write. Queries are read-only unless you pass --write to a Read & write connection.',
    '',
    'Output:',
    '  JSON by default when output is piped (what scripts and agents see); a table in a terminal.',
    '  Errors go to stderr. Exit codes: ' + [
      `${EXIT_CODES.ok} success`,
      `${EXIT_CODES.error} database or runtime error`,
      `${EXIT_CODES.usage} usage error`,
      `${EXIT_CODES.denied} blocked by access settings`
    ].join(', ') + '.',
    '',
    'Run "latch help <command>" or "latch <command> --help" for details and examples.'
  ].join('\n')
}

export function commandHelp(command: CommandSpec): string {
  const sections = [
    `latch ${command.name}: ${command.summary}`,
    '',
    'Usage:',
    `  ${usageLine(command)}`
  ]
  if (command.aliases.length > 0) sections.push('', `Aliases: ${command.aliases.join(', ')}`)
  if (command.arguments.length > 0) {
    sections.push('', 'Arguments:', ...columns(command.arguments.map((argument) => [argument.optional ? `[${argument.name}]` : `<${argument.name}>`, argument.description])))
  }
  if (command.options.length > 0) {
    sections.push('', 'Options:', ...columns(command.options.map((option) => [optionLabel(option), option.description])))
  }
  sections.push('', 'Global options:', ...columns(GLOBAL_OPTIONS.map((option) => [optionLabel(option), option.description])))
  if (command.details.length > 0) sections.push('', 'Notes:', ...command.details.map((line) => `  ${line}`))
  if (command.examples.length > 0) sections.push('', 'Examples:', ...command.examples.map((line) => `  ${line}`))
  return sections.join('\n')
}
