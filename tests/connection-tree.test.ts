import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Connection, ProviderDefinition } from '../src/shared/types.ts'
import { connectionRows, indexConnections, visibleConnectionRows } from '../src/renderer/src/features/connections/connection-tree.ts'

const sizes = { connectionRowHeight: 44, detailRowHeight: 28, rowHeight: 30 }
const server: Connection = { id: 'server', name: 'Production', provider: 'sqlserver', host: 'db.example.com', port: 1433, username: 'user', ssl: true, trustServerCertificate: false }
const local: Connection = { id: 'local', name: 'Local', provider: 'sqlite', path: '/data/archive.sqlite' }
const providers = [{ id: 'sqlserver', label: 'SQL Server' }] as ProviderDefinition[]
const entries = indexConnections([server, local], providers, { server: ['Sales', 'Accounting'] })

test('connection filter searches hosts, provider labels, and local paths', () => {
  for (const needle of ['db.example', 'sql server', 'production']) {
    const rows = connectionRows(entries, new Set(), needle, new Set(), sizes)
    assert.equal(rows[0].entry.connection.id, 'server')
    assert.equal(rows.filter((row) => row.kind === 'database').length, 2)
  }
  const rows = connectionRows(entries, new Set(), 'archive.sqlite', new Set(), sizes)
  assert.deepEqual(rows.map((row) => row.entry.connection.id), ['local'])
})

test('matching a loaded database reveals its collapsed parent and only matching databases', () => {
  const rows = connectionRows(entries, new Set(), 'account', new Set(), sizes)
  assert.deepEqual(rows.map((row) => [row.kind, row.database]), [['connection', undefined], ['databases', undefined], ['database', 'Accounting']])
  assert.equal(rows[0].expanded, true)
  const cleared = connectionRows(entries, new Set(), '', new Set(), sizes)
  assert.deepEqual(cleared.map((row) => row.kind), ['connection', 'connection'])
})

test('unknown filter terms return an empty collection', () => {
  assert.deepEqual(connectionRows(entries, new Set(['server']), 'missing', new Set(), sizes), [])
})

test('expanded loading servers avoid an incorrect empty message', () => {
  const entries = indexConnections([server], providers, {})
  assert.deepEqual(connectionRows(entries, new Set(['server']), '', new Set(['server']), sizes).map((row) => row.kind), ['connection', 'databases'])
  assert.equal(connectionRows(entries, new Set(['server']), '', new Set(), sizes).at(-1)?.kind, 'empty')
})

test('large connection and database collections render only a viewport near either end', () => {
  const connections = Array.from({ length: 5000 }, (_, index) => ({ ...server, id: `server-${index}`, name: `Server ${index}` }))
  const databases = Array.from({ length: 10000 }, (_, index) => `Database ${index}`)
  const entries = indexConnections(connections, providers, { 'server-0': databases })
  const rows = connectionRows(entries, new Set(['server-0']), '', new Set(), sizes)
  assert.equal(rows.length, 15001)
  for (const top of [0, 150000, rows.at(-1)!.top - 250]) {
    const visible = visibleConnectionRows(rows, top, 300)
    assert.ok(visible.length < 25)
    assert.ok(visible.some((row) => row.top <= top && row.top + row.height > top))
  }
  const matches = connectionRows(entries, new Set(), 'database 9999', new Set(), sizes)
  assert.equal(matches.at(-1)?.database, 'Database 9999')
})
