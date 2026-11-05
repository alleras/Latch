import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { runSqlServerBatch } from '../src/main/databases/sql-server-command.ts'

class FakeRequest extends EventEmitter {
  multiple = false
  arrayRowMode = false
  private readonly execute: (request: FakeRequest) => unknown

  constructor(execute: (request: FakeRequest) => unknown) {
    super()
    this.execute = execute
  }

  async batch(): Promise<unknown> {
    return this.execute(this)
  }
}

test('SQL Server batches return informational messages with result sets', async () => {
  const recordset = Object.assign([[1]], { columns: [] })
  const request = new FakeRequest((current) => {
    current.emit('info', { message: " Table 'items'. Scan count 1, logical reads 2. " })
    current.emit('info', { message: '\n SQL Server Execution Times:\n   CPU time = 0 ms, elapsed time = 1 ms.\n' })
    current.emit('info', { message: '   ' })
    return { recordsets: [recordset], rowsAffected: [1] }
  })

  const result = await runSqlServerBatch(request, 'SELECT value FROM items')

  assert.equal(request.multiple, true)
  assert.equal(request.arrayRowMode, true)
  assert.deepEqual(result.resultSets[0].rows, [[1]])
  assert.deepEqual(result.messages, [
    "Table 'items'. Scan count 1, logical reads 2.",
    'SQL Server Execution Times:\n   CPU time = 0 ms, elapsed time = 1 ms.'
  ])
})

test('SQL Server command messages follow informational messages', async () => {
  const request = new FakeRequest((current) => {
    current.emit('info', { message: 'operation detail' })
    return { rowsAffected: [2, 1] }
  })

  const result = await runSqlServerBatch(request, 'UPDATE items SET active = 1')

  assert.deepEqual(result.messages, ['operation detail', '3 rows affected'])
})
