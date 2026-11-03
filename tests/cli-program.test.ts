import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DatabaseObject, ProviderDefinition, QueryResult } from '../src/shared/types.ts'
import type { BoundedQueryOptions, StoredConnection } from '../src/main/types.ts'
import type { SqlDialect } from '../src/main/databases/read-only-sql.ts'
import { runProgram, type CliServices } from '../src/main/cli/program.ts'
import { COMMANDS } from '../src/main/cli/spec.ts'

const connections: StoredConnection[] = [
  { id: 'pg-1', name: 'Prod', provider: 'postgresql', host: 'db.internal', port: 5432, username: 'app', initialDatabase: 'sales', ssl: true, trustServerCertificate: false, encryptedPassword: 'secret', cliAccess: 'read-only' },
  { id: 'my-1', name: 'Staging', provider: 'mysql', host: 'stage', port: 3306, username: 'app', ssl: false, trustServerCertificate: false, encryptedPassword: 'secret', cliAccess: 'read-write' },
  { id: 'ms-1', name: 'Hidden', provider: 'sqlserver', host: 'hidden', port: 1433, username: 'sa', ssl: false, trustServerCertificate: false, encryptedPassword: 'secret' }
]

const definitions: Record<string, ProviderDefinition> = {
  postgresql: { id: 'postgresql', label: 'PostgreSQL', description: '', mode: 'server', defaultDatabase: 'postgres', defaultSsl: false },
  mysql: { id: 'mysql', label: 'MySQL', description: '', mode: 'server', defaultSsl: false },
  sqlserver: { id: 'sqlserver', label: 'SQL Server', description: '', mode: 'server', defaultDatabase: 'master', defaultSsl: false }
}

const table = (schema: string, name: string, extra: Partial<DatabaseObject> = {}): DatabaseObject => ({
  schema, name, type: 'table', columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }], constraints: [], indexes: [], defaults: [], ...extra
})

function fakeServices(overrides: Partial<CliServices> = {}) {
  const executed: Array<{ connection: string; database?: string; sql: string; options: BoundedQueryOptions }> = []
  const services: CliServices = {
    version: '9.9.9',
    loadConnections: () => connections,
    provider: (connection) => ({ definition: definitions[connection.provider], dialect: connection.provider as SqlDialect }),
    listDatabases: async () => ['sales', 'hr'],
    getSchema: async () => [
      table('public', 'invoices', { defaults: [{ column: 'id', expression: "nextval('invoices_id_seq')" }] }),
      table('public', 'customers'),
      table('audit', 'invoices'),
      { schema: 'public', name: 'invoices_audit', type: 'trigger', parentName: 'invoices', columns: [], constraints: [], indexes: [], defaults: [] }
    ],
    executeBounded: async (connection, database, sql, options): Promise<QueryResult> => {
      executed.push({ connection: connection.name, database, sql, options })
      return {
        durationMs: 3.21,
        messages: [],
        resultSets: [{ columns: ['id', 'note'], columnTypes: ['integer', 'text'], rows: [[1, 'x'.repeat(30)], [2, null]], rowCount: 2, truncated: true }]
      }
    },
    readFile: async (path) => `SELECT '${path}'`,
    readStdin: async () => 'SELECT 42',
    fileExists: () => true,
    ...overrides
  }
  return { services, executed }
}

const run = (argv: string[], services = fakeServices().services, stdoutIsTTY = false) => runProgram(argv, services, { stdoutIsTTY })

test('no arguments, help, --help, and -h all show general help listing every command', async () => {
  for (const argv of [[], ['help'], ['--help'], ['-h']]) {
    const result = await run(argv)
    assert.equal(result.exitCode, 0)
    assert.match(result.stdout, /Getting started/)
    for (const command of COMMANDS.filter((item) => item.name !== 'version')) assert.match(result.stdout, new RegExp(`\\b${command.name}\\b`))
  }
})

test('command help is available as "help <command>" and "<command> --help", including aliases', async () => {
  const viaHelp = await run(['help', 'query'])
  const viaFlag = await run(['query', '--help'])
  const viaAlias = await run(['sql', '-h'])
  assert.equal(viaHelp.stdout, viaFlag.stdout)
  assert.equal(viaHelp.stdout, viaAlias.stdout)
  assert.match(viaHelp.stdout, /--write/)
  assert.match(viaHelp.stdout, /Examples:/)
})

test('unknown commands and options suggest the closest match and exit with the usage code', async () => {
  const command = await run(['qurey', 'Prod'])
  assert.equal(command.exitCode, 2)
  assert.match(command.stderr, /Did you mean "query"/)
  const option = await run(['query', 'Prod', '--max-row', '5', 'SELECT 1'])
  assert.equal(option.exitCode, 2)
  assert.match(option.stderr, /Did you mean "--max-rows"/)
  assert.match(option.stderr, /latch help query/)
})

test('version prints only the version', async () => {
  assert.equal((await run(['--version'])).stdout, '9.9.9\n')
  assert.equal((await run(['version'])).stdout, '9.9.9\n')
})

test('connections lists only enabled connections, without credentials', async () => {
  const result = await run(['connections'])
  assert.equal(result.exitCode, 0)
  const output = JSON.parse(result.stdout)
  assert.deepEqual(output.connections.map((item: { name: string }) => item.name), ['Prod', 'Staging'])
  assert.equal(output.connections[0].defaultDatabase, 'sales')
  assert.doesNotMatch(result.stdout, /secret|encryptedPassword|username/)
})

test('a disabled connection is reported as an access problem, not as missing', async () => {
  const result = await run(['databases', 'Hidden'])
  assert.equal(result.exitCode, 3)
  assert.match(result.stderr, /not enabled for command line access.*Settings > Command line/)
  const missing = await run(['databases', 'Nope'])
  assert.equal(missing.exitCode, 2)
  assert.match(missing.stderr, /Available: "Prod", "Staging"/)
})

test('connection names match case-insensitively, and ids work too', async () => {
  assert.equal((await run(['databases', 'prod'])).exitCode, 0)
  assert.equal((await run(['databases', 'pg-1'])).exitCode, 0)
})

test('queries run read-only with the default limits, and truncation is reported on stderr', async () => {
  const { services, executed } = fakeServices()
  const result = await run(['query', 'Prod', 'SELECT id FROM invoices'], services)
  assert.equal(result.exitCode, 0)
  assert.deepEqual(executed[0], { connection: 'Prod', database: 'sales', sql: 'SELECT id FROM invoices', options: { readOnly: true, timeoutMs: 30_000, maxRows: 200 } })
  const output = JSON.parse(result.stdout)
  assert.equal(output.readOnly, true)
  assert.equal(output.resultSets[0].truncated, true)
  assert.match(result.stderr, /cut off at 200 rows/)
})

test('read-only queries refuse writes before reaching the database', async () => {
  const { services, executed } = fakeServices()
  const readOnly = await run(['query', 'Prod', 'DELETE FROM invoices'], services)
  assert.equal(readOnly.exitCode, 3)
  assert.match(readOnly.stderr, /read-only for the command line/)
  const writable = await run(['query', 'Staging', '--db', 'app', 'DELETE FROM invoices'], services)
  assert.equal(writable.exitCode, 3)
  assert.match(writable.stderr, /rerun with --write/)
  assert.equal(executed.length, 0)
})

test('--write requires a Read & write connection and skips the read-only guard', async () => {
  const { services, executed } = fakeServices()
  const denied = await run(['query', 'Prod', '--write', 'DELETE FROM invoices'], services)
  assert.equal(denied.exitCode, 3)
  const allowed = await run(['query', 'Staging', '--db', 'app', '--write', '-e', 'DELETE FROM invoices'], services)
  assert.equal(allowed.exitCode, 0)
  assert.equal(executed.length, 1)
  assert.equal(executed[0].options.readOnly, false)
})

test('SQL comes from exactly one of the argument, -e, or -f (with - for stdin)', async () => {
  const { services, executed } = fakeServices()
  assert.equal((await run(['query', 'Prod', '-f', '-'], services)).exitCode, 0)
  assert.equal(executed.at(-1)?.sql, 'SELECT 42')
  assert.equal((await run(['query', 'Prod', '--file=report.sql'], services)).exitCode, 0)
  assert.equal(executed.at(-1)?.sql, "SELECT 'report.sql'")
  const none = await run(['query', 'Prod'], services)
  assert.equal(none.exitCode, 2)
  assert.match(none.stderr, /-e "<sql>"/)
  assert.equal((await run(['query', 'Prod', 'SELECT 1', '-e', 'SELECT 2'], services)).exitCode, 2)
  const unquoted = await run(['query', 'Prod', 'SELECT', '1'], services)
  assert.match(unquoted.stderr, /Quote the SQL/)
})

test('a server connection without a default database asks for --db', async () => {
  const result = await run(['query', 'Staging', 'SELECT 1'])
  assert.equal(result.exitCode, 2)
  assert.match(result.stderr, /Pass --db/)
})

test('numeric options are validated', async () => {
  assert.equal((await run(['query', 'Prod', '--max-rows', '0', 'SELECT 1'])).exitCode, 2)
  assert.equal((await run(['query', 'Prod', '--timeout', 'soon', 'SELECT 1'])).exitCode, 2)
  const { services, executed } = fakeServices()
  await run(['query', 'Prod', '--max-rows', '5', '--timeout', '2', 'SELECT 1'], services)
  assert.deepEqual(executed[0].options, { readOnly: true, timeoutMs: 2_000, maxRows: 5 })
})

test('long values are clipped unless --max-cell-chars is 0', async () => {
  const clipped = JSON.parse((await run(['query', 'Prod', '--max-cell-chars', '10', 'SELECT 1'])).stdout)
  assert.equal(clipped.resultSets[0].rows[0][1], `${'x'.repeat(10)}…[20 more characters]`)
  const full = JSON.parse((await run(['query', 'Prod', '--max-cell-chars', '0', 'SELECT 1'])).stdout)
  assert.equal(full.resultSets[0].rows[0][1], 'x'.repeat(30))
})

test('output defaults to a table in a terminal, and --format overrides it', async () => {
  const tty = await run(['query', 'Prod', 'SELECT 1'], fakeServices().services, true)
  assert.match(tty.stdout, /^id\s+note\n--/)
  assert.match(tty.stdout, /NULL/)
  assert.match(tty.stdout, /2 rows \(truncated\)/)
  const csv = await run(['query', 'Prod', 'SELECT 1', '--format', 'csv'], fakeServices().services, true)
  assert.equal(csv.stdout.split('\r\n')[0], 'id,note')
  assert.equal((await run(['query', 'Prod', 'SELECT 1', '-o', 'yaml'])).exitCode, 2)
})

test('objects filters, sorts, and pages, reporting the total and the next offset', async () => {
  const output = JSON.parse((await run(['objects', 'Prod', '--filter', 'invoice', '--type', 'tables', '--limit', '1'])).stdout)
  assert.equal(output.total, 2)
  assert.equal(output.nextOffset, 1)
  assert.deepEqual(output.objects, [{ schema: 'audit', name: 'invoices', type: 'table', columns: 1 }])
  const unknownType = await run(['objects', 'Prod', '--type', 'sequence'])
  assert.equal(unknownType.exitCode, 2)
})

test('describe resolves qualified and quoted names, prefers tables over same-named triggers, and lists triggers', async () => {
  const output = JSON.parse((await run(['describe', 'Prod', '"public".[INVOICES]'])).stdout)
  assert.equal(output.object.schema, 'public')
  assert.deepEqual(output.object.triggers, ['invoices_audit'])
  const ambiguous = await run(['describe', 'Prod', 'invoices'])
  assert.equal(ambiguous.exitCode, 2)
  assert.match(ambiguous.stderr, /audit\.invoices \(table\), public\.invoices \(table\)/)
  const missing = await run(['describe', 'Prod', 'invoice'])
  assert.match(missing.stderr, /Similar: .*invoices/)
})

test('database errors exit with code 1 and explain timeouts', async () => {
  const { services } = fakeServices({ executeBounded: async () => { throw new Error('canceling statement due to statement timeout') } })
  const result = await run(['query', 'Prod', 'SELECT pg_sleep(60)'], services)
  assert.equal(result.exitCode, 1)
  assert.match(result.stderr, /raise it with --timeout/)
  const aggregate = fakeServices({ listDatabases: async () => { throw new AggregateError([new Error('connect ECONNREFUSED 10.0.0.1:5432')]) } })
  assert.match((await run(['databases', 'Prod'], aggregate.services)).stderr, /ECONNREFUSED/)
})

test('JSON keeps rows on one line and stays valid', async () => {
  const result = await run(['query', 'Prod', 'SELECT 1'])
  assert.match(result.stdout, /\n {8}\[1, "x{30}"\],\n {8}\[2, null\]\n/)
  assert.match(result.stdout, /"columns": \["id", "note"\]/)
  assert.equal(JSON.parse(result.stdout).resultSets[0].rows.length, 2)
})

test('a failed login for a chosen database points at the database list', async () => {
  const { services } = fakeServices({ executeBounded: async () => { throw new Error("Login failed for user 'app'.") } })
  const result = await run(['query', 'Prod', '--db', 'missing', 'SELECT 1'], services)
  assert.equal(result.exitCode, 1)
  assert.match(result.stderr, /Check that database "missing" exists.*latch databases "Prod"/)
  const withoutDb = await run(['query', 'Prod', 'SELECT 1'], services)
  assert.doesNotMatch(withoutDb.stderr, /Check that database/)
})
