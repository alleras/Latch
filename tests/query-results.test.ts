import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import type { QueryResult } from '../src/shared/types.ts'
import { isTransactionControlStatement, splitSqlStatements } from '../src/main/databases/sql-statements.ts'
import { queryMessageSummary } from '../src/renderer/src/results/query-messages.ts'

function runSqliteScript(database: DatabaseSync, sql: string): QueryResult {
  const resultSets: QueryResult['resultSets'] = []
  const messages: string[] = []
  const startedAt = performance.now()
  for (const query of splitSqlStatements(sql)) {
    const statement = database.prepare(query)
    const columns = statement.columns()
    if (columns.length > 0) {
      statement.setReturnArrays(true)
      const rows = statement.all() as unknown as unknown[][]
      resultSets.push({ columns: columns.map((column) => column.name), rows, rowCount: rows.length })
    } else {
      const changes = Number(statement.run().changes)
      messages.push(changes === 0 || isTransactionControlStatement(query) ? 'Command completed successfully' : `${changes} row${changes === 1 ? '' : 's'} affected`)
    }
  }
  return { resultSets, messages, durationMs: performance.now() - startedAt }
}

test('SQLite script splitting preserves quoted semicolons, comments, and trigger bodies', () => {
  const statements = splitSqlStatements(`
    SELECT ';' AS value; -- this ; is a comment
    CREATE TRIGGER audit_insert AFTER INSERT ON items BEGIN
      INSERT INTO audit(message) VALUES ('created; item');
      UPDATE counters SET value = value + 1;
    END;
    SELECT 2;
  `)
  assert.equal(statements.length, 3)
  assert.match(statements[0], /^SELECT ';'/)
  assert.match(statements[1], /^-- this ; is a comment\s+CREATE TRIGGER/)
  assert.match(statements[1], /UPDATE counters/)
  assert.match(statements[2], /^SELECT 2/)
})

test('SQLite batches return every SELECT and preserve duplicate column values by ordinal', () => {
  const database = new DatabaseSync(':memory:')
  try {
    const result = runSqliteScript(database, `
      CREATE TABLE items (id INTEGER, name TEXT);
      INSERT INTO items VALUES (1, 'one');
      SELECT id, id, name FROM items;
      SELECT name FROM items;
    `)

    assert.equal(result.resultSets.length, 2)
    assert.deepEqual(result.resultSets[0].columns, ['id', 'id', 'name'])
    assert.deepEqual(result.resultSets[0].rows, [[1, 1, 'one']])
    assert.deepEqual(result.resultSets[1].rows, [['one']])
  } finally {
    database.close()
  }
})

test('SQLite transaction state survives separate executions in the same query session', () => {
  const database = new DatabaseSync(':memory:')
  try {
    runSqliteScript(database, 'CREATE TABLE items (id INTEGER);')
    const begun = runSqliteScript(database, 'BEGIN TRANSACTION; INSERT INTO items VALUES (1);')
    assert.deepEqual(begun.messages, ['Command completed successfully', '1 row affected'])
    const committed = runSqliteScript(database, 'COMMIT;')
    assert.deepEqual(committed.messages, ['Command completed successfully'])
    const selected = runSqliteScript(database, 'SELECT id FROM items;')
    assert.deepEqual(selected.resultSets[0].rows, [[1]])
  } finally {
    database.close()
  }
})

test('query messages summarize multiple result sets and command messages', () => {
  const result: QueryResult = {
    resultSets: [
      { columns: ['id'], rows: [[1], [2]], rowCount: 2 },
      { columns: ['name'], rows: [['one']], rowCount: 1 }
    ],
    messages: ['3 rows affected'],
    durationMs: 12.34
  }
  assert.deepEqual(queryMessageSummary(result, null).lines, [
    'Results 1: 2 rows returned',
    'Results 2: 1 row returned',
    '3 rows affected',
    'Completed in 12.3 ms'
  ])
})
