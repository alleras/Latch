import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DatabaseObject } from '../src/shared/types.ts'
import { createSqlCatalogIndex, sqlCatalogCandidates } from '../src/renderer/src/features/query-workspace/editor/sql-catalog.ts'
import { analyzeSqlCompletion } from '../src/renderer/src/features/query-workspace/editor/sql-completion-context.ts'

function relation(name: string, schema: string | undefined, columns: Array<[string, string]>): DatabaseObject {
  return {
    name,
    schema,
    type: 'table',
    columns: columns.map(([columnName, type]) => ({ name: columnName, type, nullable: false, primaryKey: columnName === 'id' })),
    constraints: [],
    indexes: [],
    defaults: []
  }
}

const catalog = createSqlCatalogIndex([
  relation('users', 'public', [['id', 'integer'], ['email', 'text']]),
  relation('orders', 'sales', [['id', 'integer'], ['user_id', 'integer'], ['total', 'numeric']]),
  { ...relation('calculate_tax', 'sales', []), type: 'function' },
  { ...relation('rebuild_cache', 'public', []), type: 'procedure' }
])

function completionAt(markedSql: string) {
  const caret = markedSql.indexOf('|')
  assert.notEqual(caret, -1)
  const sql = markedSql.slice(0, caret) + markedSql.slice(caret + 1)
  const context = analyzeSqlCompletion(sql, caret)
  return { context, candidates: sqlCatalogCandidates(catalog, context) }
}

test('relation positions suggest relations without every column', () => {
  const { context, candidates } = completionAt('SELECT * FROM us|')
  assert.equal(context.kind, 'relations')
  assert.deepEqual(candidates.map((candidate) => candidate.label), ['public.users', 'sales.orders'])
})

test('a schema qualifier narrows relation suggestions and inserts only the local name', () => {
  const { context, candidates } = completionAt('SELECT * FROM sales.|')
  assert.deepEqual(context, { kind: 'relations', schemaPath: ['sales'] })
  assert.deepEqual(candidates.map((candidate) => candidate.insertText), ['orders'])
})

test('an alias qualifier suggests only columns from its relation', () => {
  const { candidates } = completionAt('SELECT o.| FROM sales.orders AS o')
  assert.deepEqual(candidates.map((candidate) => candidate.label), ['id', 'user_id', 'total'])
})

test('unqualified expression completion uses sources found after the caret', () => {
  const { context, candidates } = completionAt('SELECT em| FROM public.users u')
  assert.equal(context.kind, 'expressions')
  assert.deepEqual(candidates.filter((candidate) => candidate.kind === 'column').map((candidate) => candidate.label), ['id', 'email'])
})

test('joined aliases resolve independently', () => {
  const { candidates } = completionAt(`
    SELECT o.to|
    FROM public.users u
    JOIN sales.orders o ON o.user_id = u.id
  `)
  assert.deepEqual(candidates.map((candidate) => candidate.label), ['id', 'user_id', 'total'])
})

test('comments and strings do not offer catalog completions', () => {
  assert.equal(completionAt("SELECT 'public.us|ers'").context.kind, 'none')
  assert.equal(completionAt('SELECT 1 -- public.us|ers').context.kind, 'none')
  assert.equal(completionAt('SELECT /* public.us|ers */ 1').context.kind, 'none')
  assert.equal(completionAt('SELECT * FROM "us|ers"').context.kind, 'none')
})

test('statement boundaries prevent sources leaking from an earlier query', () => {
  const { context, candidates } = completionAt('SELECT * FROM public.users; SELECT |')
  assert.equal(context.kind, 'general')
  assert.equal(candidates.some((candidate) => candidate.kind === 'column'), false)
})

test('routine contexts distinguish functions and procedures', () => {
  const expression = completionAt('SELECT | FROM public.users').candidates
  assert.equal(expression.some((candidate) => candidate.label === 'sales.calculate_tax'), true)
  assert.equal(expression.some((candidate) => candidate.label === 'public.rebuild_cache'), false)

  const call = completionAt('CALL public.|').candidates
  assert.deepEqual(call.map((candidate) => candidate.label), ['rebuild_cache'])
})

test('an unqualified source with duplicate names safely offers columns from every matching schema', () => {
  const duplicateCatalog = createSqlCatalogIndex([
    relation('events', 'public', [['id', 'integer'], ['created_at', 'timestamp']]),
    relation('events', 'audit', [['id', 'bigint'], ['actor', 'text']])
  ])
  const context = analyzeSqlCompletion('SELECT e. FROM events e', 'SELECT e.'.length)
  assert.deepEqual(
    sqlCatalogCandidates(duplicateCatalog, context).map((candidate) => `${candidate.label}: ${candidate.detail}`),
    ['id: public.events · integer', 'created_at: public.events · timestamp', 'id: audit.events · bigint', 'actor: audit.events · text']
  )
})

test('qualified completion on a large catalog only materializes the selected relation columns', () => {
  const largeCatalog = createSqlCatalogIndex(Array.from({ length: 5000 }, (_, tableIndex) => (
    relation(`table_${tableIndex}`, 'public', Array.from({ length: 20 }, (_, columnIndex) => [`column_${columnIndex}`, 'text']))
  )))
  const context = analyzeSqlCompletion('SELECT target. FROM public.table_4999 target', 'SELECT target.'.length)
  const candidates = sqlCatalogCandidates(largeCatalog, context)
  assert.equal(candidates.length, 20)
  assert.equal(candidates[0].detail, 'public.table_4999 · text')
})
