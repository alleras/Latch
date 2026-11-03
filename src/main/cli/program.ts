import type { DatabaseObject, DatabaseObjectType, ProviderDefinition, QueryResult } from '../../shared/types'
import { checkReadOnlySql, type SqlDialect } from '../databases/read-only-sql'
import type { BoundedQueryOptions, StoredConnection } from '../types'
import { flagOption, integerOption, listOption, parseArguments, stringOption, UsageError, type ParsedOptions } from './arguments'
import { AccessDeniedError, cliAccess, connectionTarget, filterObjects, findObject, NO_CONNECTIONS_HINT, qualifiedName, resolveConnection } from './catalog'
import { commandHelp, generalHelp } from './help'
import { clipValue, renderCsv, renderJson, renderTable, type Table } from './output'
import { EXIT_CODES, OBJECT_LIMITS, OBJECT_TYPES, QUERY_LIMITS, type CommandName, type OutputFormat } from './spec'

/** Everything the command line needs from Latch, injected so the program runs without Electron in tests. */
export interface CliServices {
  version: string
  loadConnections: () => StoredConnection[]
  provider: (connection: StoredConnection) => { definition: ProviderDefinition; dialect: SqlDialect }
  listDatabases: (connection: StoredConnection) => Promise<string[]>
  getSchema: (connection: StoredConnection, database?: string) => Promise<DatabaseObject[]>
  executeBounded: (connection: StoredConnection, database: string | undefined, sql: string, options: BoundedQueryOptions) => Promise<QueryResult>
  readFile: (path: string) => Promise<string>
  readStdin: () => Promise<string>
  fileExists: (path: string) => boolean
}

export interface CliEnvironment {
  /** Tables for people at a terminal, JSON for pipes, scripts, and agents. */
  stdoutIsTTY: boolean
}

export interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface CommandOutput {
  json: unknown
  tables: Array<{ title?: string; table: Table }>
  /** Extra lines after the tables in table format, such as row counts and messages. */
  footer?: string[]
  /** Notes for stderr in every format, such as truncation warnings. */
  notes?: string[]
}

interface CommandContext {
  services: CliServices
  positionals: string[]
  options: ParsedOptions
  command: CommandName
}

function errorMessage(error: unknown): string {
  if (error instanceof AggregateError && !error.message) {
    const inner = error.errors.map(errorMessage).filter(Boolean)
    if (inner.length > 0) return [...new Set(inner)].join('; ')
  }
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code
    return error.message || (typeof code === 'string' ? code : error.name)
  }
  return String(error)
}

function resolveDatabase(context: CommandContext, connection: StoredConnection): string | undefined {
  if (connection.provider === 'sqlite') {
    if (!context.services.fileExists(connection.path)) throw new Error(`The database file ${connection.path} does not exist.`)
    return undefined
  }
  const requested = stringOption(context.options, 'db')?.trim()
  const database = requested || connection.initialDatabase || context.services.provider(connection).definition.defaultDatabase
  if (!database) {
    throw new UsageError(`Connection "${connection.name}" has no default database. Pass --db <name>; run "latch databases ${connection.name}" to list them.`, context.command)
  }
  return database
}

function connectionFor(context: CommandContext): StoredConnection {
  return resolveConnection(context.services.loadConnections(), context.positionals[0], context.command)
}

function listConnections(context: CommandContext): CommandOutput {
  const connections = context.services.loadConnections().filter((connection) => cliAccess(connection) !== 'off')
  const records = connections.map((connection) => ({
    name: connection.name,
    id: connection.id,
    provider: connection.provider,
    access: cliAccess(connection),
    target: connectionTarget(connection),
    defaultDatabase: connection.provider === 'sqlite'
      ? null
      : connection.initialDatabase ?? context.services.provider(connection).definition.defaultDatabase ?? null
  }))
  return {
    json: { connections: records },
    tables: [{
      table: {
        columns: ['name', 'provider', 'access', 'target', 'default database', 'id'],
        rows: records.map((record) => [record.name, record.provider, record.access, record.target, record.defaultDatabase ?? '', record.id])
      }
    }],
    notes: records.length === 0 ? [`No connections are enabled for command line access. ${NO_CONNECTIONS_HINT}`] : []
  }
}

async function listDatabases(context: CommandContext): Promise<CommandOutput> {
  const connection = connectionFor(context)
  if (connection.provider === 'sqlite') resolveDatabase(context, connection)
  const databases = await context.services.listDatabases(connection)
  return {
    json: { connection: connection.name, databases },
    tables: [{ table: { columns: ['database'], rows: databases.map((database) => [database]) } }]
  }
}

function objectTypes(context: CommandContext): DatabaseObjectType[] {
  const types = listOption(context.options, 'type').map((type) => type.toLowerCase())
  const singular = types.map((type) => type.replace(/s$/, ''))
  const unknown = singular.find((type) => !(OBJECT_TYPES as readonly string[]).includes(type))
  if (unknown) throw new UsageError(`Unknown object type "${unknown}". Use ${OBJECT_TYPES.join(', ')}.`, context.command)
  return singular as DatabaseObjectType[]
}

async function listObjects(context: CommandContext): Promise<CommandOutput> {
  const connection = connectionFor(context)
  const types = objectTypes(context)
  const limit = integerOption(context.options, 'limit', OBJECT_LIMITS.limit, context.command)
  const offset = integerOption(context.options, 'offset', { default: 0, min: 0, max: Number.MAX_SAFE_INTEGER }, context.command)
  const database = resolveDatabase(context, connection)
  const matches = filterObjects(await context.services.getSchema(connection, database), {
    schema: stringOption(context.options, 'schema'),
    types,
    filter: stringOption(context.options, 'filter')
  })
  const page = matches.slice(offset, offset + limit)
  const nextOffset = offset + page.length < matches.length ? offset + page.length : null
  const records = page.map((object) => ({
    schema: object.schema ?? null,
    name: object.name,
    type: object.type,
    ...(object.parentName ? { parent: object.parentName } : {}),
    columns: object.columns.length
  }))
  const notes = nextOffset === null
    ? []
    : [`Showing ${offset + 1}-${offset + page.length} of ${matches.length} objects. Use --offset ${nextOffset} for more, or narrow with --filter, --schema, or --type.`]
  return {
    json: { connection: connection.name, database: database ?? null, total: matches.length, offset, limit, nextOffset, objects: records },
    tables: [{
      table: {
        columns: ['schema', 'name', 'type', 'columns'],
        rows: records.map((record) => [record.schema ?? '', record.parent ? `${record.name} (on ${record.parent})` : record.name, record.type, record.columns])
      }
    }],
    footer: [`${matches.length} matching object${matches.length === 1 ? '' : 's'}`],
    notes
  }
}

async function describeObject(context: CommandContext): Promise<CommandOutput> {
  const connection = connectionFor(context)
  const database = resolveDatabase(context, connection)
  const objects = await context.services.getSchema(connection, database)
  const object = findObject(objects, context.positionals[1])
  const triggers = objects
    .filter((candidate) => candidate.type === 'trigger' && candidate.parentName === object.name && (candidate.schema ?? '') === (object.schema ?? ''))
    .map((trigger) => trigger.name)
  const defaults = new Map(object.defaults.map((item) => [item.column, item.expression]))
  const tables: CommandOutput['tables'] = []
  if (object.columns.length > 0) {
    tables.push({
      title: `${object.type} ${qualifiedName(object)}`,
      table: {
        columns: ['column', 'type', 'nullable', 'key', 'default'],
        rows: object.columns.map((column) => [column.name, column.type, column.nullable ? 'yes' : 'no', column.primaryKey ? 'PK' : '', defaults.get(column.name) ?? ''])
      }
    })
  }
  if (object.constraints.length > 0) {
    tables.push({
      title: 'Constraints',
      table: {
        columns: ['name', 'type', 'columns', 'details'],
        rows: object.constraints.map((constraint) => [
          constraint.name,
          constraint.type,
          constraint.columns.join(', '),
          constraint.type === 'foreign-key'
            ? `-> ${constraint.referencedSchema ? `${constraint.referencedSchema}.` : ''}${constraint.referencedTable ?? ''}(${(constraint.referencedColumns ?? []).join(', ')})${constraint.onDelete ? ` ON DELETE ${constraint.onDelete}` : ''}`
            : constraint.expression ?? ''
        ])
      }
    })
  }
  if (object.indexes.length > 0) {
    tables.push({
      title: 'Indexes',
      table: {
        columns: ['name', 'unique', 'columns', 'type', 'where'],
        rows: object.indexes.map((index) => [
          index.name,
          index.primary ? 'primary' : index.unique ? 'yes' : 'no',
          index.columns.map((column) => `${column.name ?? column.expression ?? '?'}${column.descending ? ' DESC' : ''}${column.included ? ' (included)' : ''}`).join(', '),
          index.type ?? '',
          index.predicate ?? ''
        ])
      }
    })
  }
  return {
    json: {
      connection: connection.name,
      database: database ?? null,
      object: { ...object, schema: object.schema ?? null, triggers }
    },
    tables: tables.length > 0 ? tables : [{ title: `${object.type} ${qualifiedName(object)}`, table: { columns: [], rows: [] } }],
    footer: [
      ...(object.parentName ? [`On ${object.parentName}`] : []),
      ...(triggers.length > 0 ? [`Triggers: ${triggers.join(', ')}`] : [])
    ]
  }
}

async function readQueryText(context: CommandContext): Promise<string> {
  const inline = context.positionals[1]
  const execute = stringOption(context.options, 'execute')
  const file = stringOption(context.options, 'file')
  const sources = [inline, execute, file].filter((value) => value !== undefined)
  if (sources.length === 0) throw new UsageError('Give the SQL to run as an argument, with -e "<sql>", or with -f <file> (-f - reads stdin).', context.command)
  if (sources.length > 1) throw new UsageError('Give the SQL only once: as an argument, with -e, or with -f.', context.command)
  const sql = file === undefined
    ? inline ?? execute ?? ''
    : file === '-' ? await context.services.readStdin() : await context.services.readFile(file)
  if (!sql.trim()) throw new UsageError('The SQL is empty.', context.command)
  return sql
}

async function runQuery(context: CommandContext): Promise<CommandOutput> {
  const connection = connectionFor(context)
  const write = flagOption(context.options, 'write')
  const maxRows = integerOption(context.options, 'max-rows', QUERY_LIMITS.maxRows, context.command)
  const timeoutSeconds = integerOption(context.options, 'timeout', QUERY_LIMITS.timeoutSeconds, context.command)
  const maxCellChars = integerOption(context.options, 'max-cell-chars', QUERY_LIMITS.maxCellChars, context.command)
  const sql = await readQueryText(context)
  const access = cliAccess(connection)

  if (write && access !== 'read-write') {
    throw new AccessDeniedError(`Connection "${connection.name}" is read-only for the command line. To allow --write, set it to Read & write in Latch > Settings > Command line.`)
  }
  if (!write) {
    const check = checkReadOnlySql(sql, context.services.provider(connection).dialect)
    if (!check.allowed) {
      throw new AccessDeniedError(`${check.reason} ${access === 'read-write'
        ? 'This connection allows writes: rerun with --write if the change is intended.'
        : 'This connection is read-only for the command line.'}`)
    }
  }

  const database = resolveDatabase(context, connection)
  const result = await context.services.executeBounded(connection, database, sql, { readOnly: !write, timeoutMs: timeoutSeconds * 1000, maxRows })
    .catch((error: unknown) => {
      const message = errorMessage(error)
      if (/timeout|timed out|canceling statement|maximum statement execution time|max_statement_time/i.test(message)) {
        throw new Error(`${message} (limit ${timeoutSeconds}s; raise it with --timeout)`)
      }
      throw error
    })

  const resultSets = result.resultSets.map((set) => ({
    columns: set.columns,
    columnTypes: set.columnTypes ?? set.columns.map(() => null),
    rowCount: set.rowCount,
    truncated: set.truncated ?? false,
    rows: set.rows.map((row) => row.map((value) => clipValue(value, maxCellChars)))
  }))
  const notes = resultSets.flatMap((set, index) => set.truncated
    ? [`Result set ${index + 1} was cut off at ${maxRows} rows. Add a LIMIT/TOP clause or raise --max-rows.`]
    : [])
  const durationMs = Math.round(result.durationMs * 10) / 10
  return {
    json: { connection: connection.name, database: database ?? null, readOnly: !write, durationMs, resultSets, messages: result.messages },
    tables: resultSets.map((set, index) => ({
      title: resultSets.length > 1 ? `Result ${index + 1}` : undefined,
      table: { columns: set.columns, rows: set.rows }
    })),
    footer: [
      ...resultSets.map((set, index) => `${resultSets.length > 1 ? `Result ${index + 1}: ` : ''}${set.rowCount} row${set.rowCount === 1 ? '' : 's'}${set.truncated ? ' (truncated)' : ''}`),
      ...result.messages,
      `${durationMs} ms${write ? '' : ', read-only'}`
    ],
    notes
  }
}

const RUNNERS: Partial<Record<CommandName, (context: CommandContext) => CommandOutput | Promise<CommandOutput>>> = {
  connections: listConnections,
  databases: listDatabases,
  objects: listObjects,
  describe: describeObject,
  query: runQuery
}

function render(output: CommandOutput, format: OutputFormat): string {
  if (format === 'json') return renderJson(output.json)
  if (format === 'csv') return output.tables.filter((item) => item.table.columns.length > 0).map((item) => renderCsv(item.table)).join('\r\n\r\n')
  const blocks = output.tables.map((item) => [item.title, item.table.columns.length > 0 ? renderTable(item.table) : undefined].filter(Boolean).join('\n'))
  return [...blocks, ...(output.footer && output.footer.length > 0 ? [output.footer.join('\n')] : [])].filter(Boolean).join('\n\n')
}

/**
 * Azure SQL reports a database that does not exist as a failed login, and other servers use their
 * own wording; when the caller chose a database, say which one so the next step is obvious.
 */
function databaseHint(message: string, argv: string[]): string {
  if (!/login failed|cannot open database|unknown database|database .* does not exist/i.test(message)) return ''
  try {
    const invocation = parseArguments(argv)
    if (invocation.kind !== 'command') return ''
    const database = stringOption(invocation.options, 'db')
    const connection = invocation.positionals[0]
    if (!database || !connection) return ''
    return `\nlatch: Check that database "${database}" exists and this login can use it: latch databases "${connection}"`
  } catch {
    return ''
  }
}

const withNewline = (text: string): string => text === '' || text.endsWith('\n') ? text : `${text}\n`

export async function runProgram(argv: string[], services: CliServices, environment: CliEnvironment): Promise<CliResult> {
  let command: CommandName | undefined
  try {
    const invocation = parseArguments(argv)
    if (invocation.kind === 'help') {
      return { stdout: withNewline(invocation.topic ? commandHelp(invocation.topic) : generalHelp(services.version)), stderr: '', exitCode: EXIT_CODES.ok }
    }
    if (invocation.kind === 'version') return { stdout: `${services.version}\n`, stderr: '', exitCode: EXIT_CODES.ok }

    command = invocation.command.name
    const runner = RUNNERS[command]
    if (!runner) throw new UsageError(`"${command}" cannot be run directly.`)
    const output = await runner({ services, positionals: invocation.positionals, options: invocation.options, command })
    const format = invocation.format ?? (environment.stdoutIsTTY ? 'table' : 'json')
    return {
      stdout: withNewline(render(output, format)),
      stderr: (output.notes ?? []).map((note) => `latch: ${note}\n`).join(''),
      exitCode: EXIT_CODES.ok
    }
  } catch (error) {
    if (error instanceof UsageError) {
      const topic = error.command ?? command
      return { stdout: '', stderr: `latch: ${error.message}\nRun "latch help${topic ? ` ${topic}` : ''}" for usage.\n`, exitCode: EXIT_CODES.usage }
    }
    if (error instanceof AccessDeniedError) return { stdout: '', stderr: `latch: ${error.message}\n`, exitCode: EXIT_CODES.denied }
    const message = errorMessage(error)
    return { stdout: '', stderr: `latch: ${message}${databaseHint(message, argv)}\n`, exitCode: EXIT_CODES.error }
  }
}
