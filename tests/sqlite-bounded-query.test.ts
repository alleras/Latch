import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import type { SqliteConnection } from '../src/shared/types.ts'
import { executeSqliteBoundedQuery } from '../src/main/databases/sqlite-command.ts'

let directory: string
let connection: SqliteConnection

before(() => {
  directory = mkdtempSync(join(tmpdir(), 'latch-sqlite-bounded-'))
  const path = join(directory, 'data.db')
  const database = new DatabaseSync(path)
  database.exec('CREATE TABLE numbers (n INTEGER PRIMARY KEY, label TEXT)')
  const insert = database.prepare('INSERT INTO numbers (n, label) VALUES (?, ?)')
  for (let n = 1; n <= 5_000; n += 1) insert.run(n, `row ${n}`)
  database.close()
  connection = { id: 'local', name: 'Local', provider: 'sqlite', path }
})

after(() => rmSync(directory, { recursive: true, force: true }))

test('rows stop at the limit and the result set is marked truncated', () => {
  const result = executeSqliteBoundedQuery(connection, 'SELECT n, label FROM numbers ORDER BY n; SELECT count(*) AS total FROM numbers', { readOnly: true, timeoutMs: 1_000, maxRows: 3 })
  assert.deepEqual(result.resultSets[0].rows, [[1, 'row 1'], [2, 'row 2'], [3, 'row 3']])
  assert.equal(result.resultSets[0].truncated, true)
  assert.deepEqual(result.resultSets[1].rows, [[5_000]])
  assert.equal(result.resultSets[1].truncated, undefined)
})

test('read-only queries open the file read-only, so SQLite itself rejects writes', () => {
  assert.throws(
    () => executeSqliteBoundedQuery(connection, 'DELETE FROM numbers', { readOnly: true, timeoutMs: 1_000, maxRows: 10 }),
    /readonly/i
  )
  const count = executeSqliteBoundedQuery(connection, 'SELECT count(*) FROM numbers', { readOnly: true, timeoutMs: 1_000, maxRows: 10 })
  assert.deepEqual(count.resultSets[0].rows, [[5_000]])
})

test('write mode can change data', () => {
  const result = executeSqliteBoundedQuery(connection, 'DELETE FROM numbers WHERE n > 4990', { readOnly: false, timeoutMs: 1_000, maxRows: 10 })
  assert.deepEqual(result.messages, ['10 rows affected'])
})

test('a missing file is an error instead of a new empty database', () => {
  assert.throws(
    () => executeSqliteBoundedQuery({ ...connection, path: join(directory, 'missing.db') }, 'SELECT 1', { readOnly: true, timeoutMs: 1_000, maxRows: 10 }),
    /does not exist/
  )
})
