/**
 * The `latch` command line's commands and options. Parsing and help text are both generated from
 * this table, so help can never drift from what the parser accepts.
 */

export type CommandName = 'connections' | 'databases' | 'objects' | 'describe' | 'query' | 'help' | 'version'

export interface OptionSpec {
  name: string
  short?: string
  /** Placeholder for the option's value; absent for flags. */
  value?: string
  description: string
}

export interface ArgumentSpec {
  name: string
  description: string
  optional?: boolean
}

export interface CommandSpec {
  name: CommandName
  aliases: string[]
  summary: string
  arguments: ArgumentSpec[]
  options: OptionSpec[]
  details: string[]
  examples: string[]
}

export const FORMATS = ['json', 'table', 'csv'] as const
export type OutputFormat = (typeof FORMATS)[number]

export const OBJECT_TYPES = ['table', 'view', 'procedure', 'function', 'trigger'] as const

export const QUERY_LIMITS = {
  maxRows: { default: 200, min: 1, max: 100_000 },
  timeoutSeconds: { default: 30, min: 1, max: 3_600 },
  maxCellChars: { default: 2_000, min: 0, max: 10_000_000 }
} as const

export const OBJECT_LIMITS = {
  limit: { default: 200, min: 1, max: 100_000 }
} as const

export const EXIT_CODES = {
  ok: 0,
  error: 1,
  usage: 2,
  denied: 3
} as const

export const GLOBAL_OPTIONS: OptionSpec[] = [
  { name: 'format', short: 'o', value: 'json|table|csv', description: 'Output format. Defaults to table in a terminal and json otherwise.' },
  { name: 'help', short: 'h', description: 'Show help for the command.' }
]

const CONNECTION_ARGUMENT: ArgumentSpec = { name: 'connection', description: 'Connection name (case-insensitive) or id, as shown by "latch connections".' }
const DATABASE_OPTION: OptionSpec = { name: 'db', short: 'd', value: 'name', description: 'Database to use. Defaults to the connection\'s initial database. Ignored for SQLite.' }

export const COMMANDS: CommandSpec[] = [
  {
    name: 'connections',
    aliases: ['conns', 'list', 'ls'],
    summary: 'List the connections enabled for command line access',
    arguments: [],
    options: [],
    details: [
      'Only connections set to "Read-only" or "Read & write" in Latch > Settings > Command line are listed.',
      'Passwords are never shown.'
    ],
    examples: ['latch connections', 'latch connections --format table']
  },
  {
    name: 'databases',
    aliases: ['dbs'],
    summary: 'List the databases on a connection',
    arguments: [CONNECTION_ARGUMENT],
    options: [],
    details: ['SQLite connections have a single database, named after the connection.'],
    examples: ['latch databases "Local Postgres"']
  },
  {
    name: 'objects',
    aliases: ['tables', 'schema'],
    summary: 'List tables, views, procedures, functions, and triggers',
    arguments: [CONNECTION_ARGUMENT],
    options: [
      DATABASE_OPTION,
      { name: 'schema', short: 's', value: 'name', description: 'Only objects in this schema (case-insensitive).' },
      { name: 'type', short: 't', value: OBJECT_TYPES.join('|'), description: 'Only objects of this type. Repeatable or comma-separated.' },
      { name: 'filter', value: 'text', description: 'Only objects whose name or schema.name contains this text (case-insensitive).' },
      { name: 'limit', short: 'n', value: 'count', description: `Maximum objects to return (default ${OBJECT_LIMITS.limit.default}).` },
      { name: 'offset', value: 'count', description: 'Skip this many matching objects, for paging (default 0).' }
    ],
    details: [
      'Results are sorted by schema, then name. The output reports the total number of matches, so',
      'use --filter, --schema, or --offset when a database has more objects than the limit.',
      'To count objects, read "total" (for example with --type table --limit 1).'
    ],
    examples: [
      'latch objects prod --db sales --type table',
      'latch objects prod --db sales --filter invoice',
      'latch objects prod --db sales --schema dbo --limit 50 --offset 50',
      'latch objects prod --db sales --type table --limit 1   # "total" is the table count'
    ]
  },
  {
    name: 'describe',
    aliases: ['desc', 'show'],
    summary: 'Show an object\'s columns, keys, indexes, defaults, and triggers',
    arguments: [
      CONNECTION_ARGUMENT,
      { name: 'object', description: 'Object name, optionally schema-qualified: users, public.users, [dbo].[Users], "My Table".' }
    ],
    options: [DATABASE_OPTION],
    details: ['Names match exactly first, then case-insensitively. Ambiguous names list the candidates.'],
    examples: ['latch describe prod public.invoices --db sales', 'latch describe local users']
  },
  {
    name: 'query',
    aliases: ['sql', 'q', 'run', 'exec'],
    summary: 'Run SQL against a connection (read-only unless --write)',
    arguments: [
      CONNECTION_ARGUMENT,
      { name: 'sql', description: 'SQL to run. Use -e or -f instead for SQL starting with "-", or to read a file or stdin.', optional: true }
    ],
    options: [
      DATABASE_OPTION,
      { name: 'execute', short: 'e', value: 'sql', description: 'SQL to run.' },
      { name: 'file', short: 'f', value: 'path', description: 'Read SQL from a file, or from stdin when the path is "-".' },
      { name: 'write', description: 'Allow statements that change data or schema. The connection must be set to "Read & write" in Latch.' },
      { name: 'max-rows', value: 'count', description: `Rows kept per result set (default ${QUERY_LIMITS.maxRows.default}, max ${QUERY_LIMITS.maxRows.max}). Extra rows are dropped and the result is marked truncated.` },
      { name: 'timeout', value: 'seconds', description: `Cancel the query after this many seconds (default ${QUERY_LIMITS.timeoutSeconds.default}).` },
      { name: 'max-cell-chars', value: 'count', description: `Shorten longer text values (default ${QUERY_LIMITS.maxCellChars.default}; 0 keeps full values).` }
    ],
    details: [
      'Without --write, only read statements are accepted: SELECT, WITH, VALUES, TABLE, SHOW, EXPLAIN,',
      'DESCRIBE (MySQL), PRAGMA (SQLite), DECLARE and SET (SQL Server). PostgreSQL and MySQL queries also',
      'run in a read-only transaction, SQLite files are opened read-only, and SQL Server queries run in a',
      'transaction that is always rolled back.',
      'Prefer a LIMIT/TOP clause over --max-rows: the row limit is applied after rows are fetched for',
      'server databases.',
      'Each command opens and closes its own connection, so transactions do not span commands.'
    ],
    examples: [
      'latch query prod --db sales "SELECT id, total FROM invoices ORDER BY id DESC LIMIT 20"',
      'latch query prod --db sales -f report.sql --format csv > report.csv',
      'echo "SELECT count(*) FROM users" | latch query local -f -',
      'latch query staging --db app --write -e "UPDATE flags SET enabled = true WHERE name = \'beta\'"'
    ]
  },
  {
    name: 'help',
    aliases: [],
    summary: 'Show help for latch or for one command',
    arguments: [{ name: 'command', description: 'Command to describe.', optional: true }],
    options: [],
    details: [],
    examples: ['latch help', 'latch help query']
  },
  {
    name: 'version',
    aliases: [],
    summary: 'Print the Latch version',
    arguments: [],
    options: [],
    details: [],
    examples: ['latch version']
  }
]

export function findCommand(name: string): CommandSpec | undefined {
  const normalized = name.toLowerCase()
  return COMMANDS.find((command) => command.name === normalized || command.aliases.includes(normalized))
}
