import { startApplication } from './app'
import { cliArguments } from './cli/launcher'
import { runCli } from './cli/main'

const cliArgv = cliArguments(process.argv)

if (cliArgv) {
  // Command output is read by scripts and agents; Node's experimental-feature notices are noise there.
  const emitWarning = process.emitWarning.bind(process)
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const type = typeof rest[0] === 'string' ? rest[0] : (rest[0] as { type?: string } | undefined)?.type
    if (type === 'ExperimentalWarning' || (warning instanceof Error && warning.name === 'ExperimentalWarning')) return
    ;(emitWarning as (...args: unknown[]) => void)(warning, ...rest)
  }) as typeof process.emitWarning
  runCli(cliArgv)
} else {
  startApplication()
}
