/**
 * Statement guard for read-only command line queries.
 *
 * This is one layer of two. Where the database can enforce read-only access itself (PostgreSQL and
 * MySQL read-only transactions, SQLite read-only files), the driver does so as well; SQL Server has
 * no session-level equivalent, so there this guard and a rolled-back transaction are the protection.
 *
 * The guard tokenizes the script the way the target database would: quoted text, quoted identifiers,
 * and comments are opaque, while MySQL executable comments are treated as code. It then requires
 * every statement to start with a read keyword and rejects write keywords anywhere, because T-SQL
 * does not need semicolons between statements and CTEs may contain data-modifying statements.
 * Anything it cannot tokenize with certainty, such as an unterminated string, is rejected.
 */

export type SqlDialect = 'postgresql' | 'mysql' | 'sqlserver' | 'sqlite'

export type ReadOnlyCheck = { allowed: true } | { allowed: false; reason: string }

const READ_STATEMENTS: Record<SqlDialect, ReadonlySet<string>> = {
  postgresql: new Set(['select', 'with', 'values', 'table', 'show', 'explain']),
  mysql: new Set(['select', 'with', 'values', 'table', 'show', 'explain', 'describe', 'desc']),
  // DECLARE and SET only touch variables and options of a session that ends with the command.
  sqlserver: new Set(['select', 'with', 'declare', 'set']),
  // The database file is also opened read-only, so a writing PRAGMA fails in SQLite itself.
  sqlite: new Set(['select', 'with', 'values', 'explain', 'pragma'])
}

const WRITE_WORDS = [
  'insert', 'update', 'delete', 'merge', 'upsert', 'truncate', 'create', 'alter', 'drop', 'rename',
  'grant', 'revoke', 'exec', 'execute', 'call', 'into', 'commit', 'rollback', 'savepoint', 'begin'
]

const DIALECT_WRITE_WORDS: Record<SqlDialect, string[]> = {
  postgresql: [
    'copy', 'set_config', 'setval', 'nextval', 'dblink_exec', 'lo_import', 'lo_export', 'lo_unlink', 'lo_create',
    'lo_put', 'lo_from_bytea', 'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_promote', 'pg_switch_wal'
  ],
  mysql: ['load', 'handler', 'lock', 'unlock', 'flush', 'kill', 'shutdown'],
  sqlserver: [
    'deny', 'backup', 'restore', 'kill', 'shutdown', 'reconfigure', 'dbcc', 'bulk', 'writetext', 'updatetext',
    'enable', 'disable', 'setuser', 'openrowset', 'openquery', 'opendatasource', 'waitfor', 'receive', 'send',
    'conversation', 'use', 'save'
  ],
  sqlite: ['attach', 'detach', 'vacuum', 'reindex']
}

const deniedWords = (dialect: SqlDialect): ReadonlySet<string> => new Set([...WRITE_WORDS, ...DIALECT_WRITE_WORDS[dialect]])

const DENIED_WORDS: Record<SqlDialect, ReadonlySet<string>> = {
  postgresql: deniedWords('postgresql'),
  mysql: deniedWords('mysql'),
  sqlserver: deniedWords('sqlserver'),
  sqlite: deniedWords('sqlite')
}

interface ScanOptions {
  dialect: SqlDialect
  /** MySQL treats backslashes in strings as escapes unless NO_BACKSLASH_ESCAPES is set. */
  backslashEscapes: boolean
}

interface ScannedStatement {
  words: string[]
}

type ScanResult = { statements: ScannedStatement[] } | { error: string }

const WORD_START = /[A-Za-z_\u0080-￿]/
const WORD_PART = /[A-Za-z0-9_$\u0080-￿]/
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/

function scan(sql: string, { dialect, backslashEscapes }: ScanOptions): ScanResult {
  const statements: ScannedStatement[] = []
  let current: ScannedStatement = { words: [] }
  let hasCode = false
  let executableComment = false
  const nestedComments = dialect === 'postgresql' || dialect === 'sqlserver'

  const finishStatement = (): void => {
    if (hasCode) statements.push(current)
    current = { words: [] }
    hasCode = false
  }

  /** Returns the index after the closing quote, or -1 when the text never closes it. */
  const skipQuoted = (start: number, close: string, doubledEscape: boolean, backslash: boolean): number => {
    for (let index = start; index < sql.length; index += 1) {
      const character = sql[index]
      if (backslash && character === '\\') {
        index += 1
        continue
      }
      if (character !== close) continue
      if (doubledEscape && sql[index + 1] === close) {
        index += 1
        continue
      }
      return index + 1
    }
    return -1
  }

  let index = 0
  while (index < sql.length) {
    const character = sql[index]
    const next = sql[index + 1]

    if (/\s/.test(character)) {
      index += 1
      continue
    }

    if (character === '-' && next === '-') {
      // MySQL only starts a comment when whitespace follows; `1--1` is arithmetic there.
      const isComment = dialect !== 'mysql' || index + 2 >= sql.length || /[\s\x00-\x1f]/.test(sql[index + 2])
      if (isComment) {
        const end = sql.indexOf('\n', index)
        index = end === -1 ? sql.length : end + 1
        continue
      }
    }

    if (character === '#' && dialect === 'mysql') {
      const end = sql.indexOf('\n', index)
      index = end === -1 ? sql.length : end + 1
      continue
    }

    if (executableComment && character === '*' && next === '/') {
      executableComment = false
      index += 2
      continue
    }

    if (character === '/' && next === '*') {
      if (dialect === 'mysql' && (sql[index + 2] === '!' || (sql[index + 2] === 'M' && sql[index + 3] === '!'))) {
        // `/*! ... */` is executed by MySQL and MariaDB, so its contents are scanned as code.
        if (executableComment) return { error: 'Nested executable comments are not supported in read-only mode.' }
        executableComment = true
        index += sql[index + 2] === '!' ? 3 : 4
        while (/[0-9]/.test(sql[index] ?? '')) index += 1
        continue
      }
      let depth = 1
      index += 2
      while (index < sql.length && depth > 0) {
        if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1
          index += 2
        } else if (nestedComments && sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1
          index += 2
        } else {
          index += 1
        }
      }
      if (depth > 0) return { error: 'The query has an unterminated comment.' }
      continue
    }

    if (character === "'") {
      const previousWord = current.words.at(-1)
      const escapeString = dialect === 'postgresql' && previousWord === 'e' && /[eE]/.test(sql[index - 1] ?? '')
      if (escapeString) current.words.pop()
      const end = skipQuoted(index + 1, "'", true, backslashEscapes || escapeString)
      if (end === -1) return { error: 'The query has an unterminated string.' }
      hasCode = true
      index = end
      continue
    }

    if (character === '"' || character === '`') {
      const end = skipQuoted(index + 1, character, true, character === '"' && backslashEscapes)
      if (end === -1) return { error: 'The query has an unterminated quoted name.' }
      hasCode = true
      index = end
      continue
    }

    if (character === '[' && (dialect === 'sqlserver' || dialect === 'sqlite')) {
      const end = skipQuoted(index + 1, ']', dialect === 'sqlserver', false)
      if (end === -1) return { error: 'The query has an unterminated bracketed name.' }
      hasCode = true
      index = end
      continue
    }

    if (character === '$' && dialect === 'postgresql') {
      const tag = sql.slice(index).match(DOLLAR_TAG)?.[0]
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length)
        if (end === -1) return { error: 'The query has an unterminated dollar-quoted string.' }
        hasCode = true
        index = end + tag.length
        continue
      }
    }

    if (WORD_START.test(character)) {
      let end = index + 1
      while (end < sql.length && WORD_PART.test(sql[end])) end += 1
      current.words.push(sql.slice(index, end).toLowerCase())
      hasCode = true
      index = end
      continue
    }

    if (character === ';') {
      finishStatement()
      index += 1
      continue
    }

    hasCode = true
    index += 1
  }

  if (executableComment) return { error: 'The query has an unterminated executable comment.' }
  finishStatement()
  return { statements }
}

function checkScan(result: ScanResult, dialect: SqlDialect): ReadOnlyCheck {
  if ('error' in result) return { allowed: false, reason: result.error }
  if (result.statements.length === 0) return { allowed: false, reason: 'The query is empty.' }

  const readStatements = READ_STATEMENTS[dialect]
  const deniedWords = DENIED_WORDS[dialect]
  for (const statement of result.statements) {
    const first = statement.words[0]
    if (!first || !readStatements.has(first)) {
      const label = first ? first.toUpperCase() : 'that'
      return { allowed: false, reason: `${label} statements are not allowed in read-only mode. Allowed statements: ${[...readStatements].map((word) => word.toUpperCase()).join(', ')}.` }
    }
    const denied = statement.words.find((word) => deniedWords.has(word))
    if (denied) {
      return { allowed: false, reason: `${denied.toUpperCase()} is not allowed in read-only mode. If it is a table or column name, quote it.` }
    }
  }
  return { allowed: true }
}

export function checkReadOnlySql(sql: string, dialect: SqlDialect): ReadOnlyCheck {
  // MySQL's string escaping depends on a server mode the client cannot see, so both readings must pass.
  const readings = dialect === 'mysql' ? [false, true] : [false]
  for (const backslashEscapes of readings) {
    const check = checkScan(scan(sql, { dialect, backslashEscapes }), dialect)
    if (!check.allowed) return check
  }
  return { allowed: true }
}
