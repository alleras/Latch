import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { QueryTabState } from '../src/renderer/src/query-tabs.ts'
import {
  createQueryWorkspaceSnapshot,
  readQueryWorkspace,
  restoreQueryWorkspace,
  type QueryWorkspaceSnapshot
} from '../src/renderer/src/query-workspace.ts'

const legacySnapshot = {
  version: 1,
  activeTabId: 'u1',
  tabs: [{ id: 'u1', title: 'Query 1', connectionId: 'c1', database: 'app', query: 'SELECT 1' }]
}

function tab(overrides: Partial<QueryTabState> & { id: string }): QueryTabState {
  return {
    title: `Query ${overrides.id}`,
    connectionId: 'c1',
    unsaved: false,
    loading: false,
    result: null,
    error: null,
    running: false,
    ...overrides
  }
}

test('legacy v1 snapshot without file fields still restores', () => {
  const snapshot = readQueryWorkspace(JSON.stringify(legacySnapshot))
  assert.ok(snapshot)
  const restored = restoreQueryWorkspace(snapshot, new Set(['c1']))
  assert.equal(restored.tabs.length, 1)
  assert.equal(restored.tabs[0].connectionId, 'c1')
  assert.equal(restored.tabs[0].filePath, undefined)
  assert.equal(restored.tabs[0].loading, false)
  assert.equal(restored.tabs[0].unsaved, false)
  assert.equal(restored.drafts.get('u1'), 'SELECT 1')
  assert.equal(restored.activeTabId, 'u1')
  assert.equal(restored.nextQueryNumber, 2)
})

test('read keeps a tab whose connectionId is null', () => {
  const snapshot = readQueryWorkspace(JSON.stringify({
    version: 1,
    activeTabId: null,
    tabs: [{ id: 'f1', title: 'daily.sql', connectionId: null, filePath: 'C:\\q\\daily.sql', unsaved: false }]
  }))
  assert.ok(snapshot)
  assert.equal(snapshot.tabs.length, 1)
  assert.equal(snapshot.tabs[0].connectionId, null)
  assert.equal(snapshot.tabs[0].filePath, 'C:\\q\\daily.sql')
  assert.equal(snapshot.tabs[0].query, undefined)
})

test('read drops a tab with neither query nor filePath', () => {
  const snapshot = readQueryWorkspace(JSON.stringify({
    version: 1,
    activeTabId: null,
    tabs: [
      { id: 'broken', title: 'Query 9', connectionId: 'c1' },
      { id: 'ok', title: 'Query 1', connectionId: 'c1', query: '' }
    ]
  }))
  assert.ok(snapshot)
  assert.deepEqual(snapshot.tabs.map((item) => item.id), ['ok'])
})

test('restore detaches a file tab whose connection is gone but drops an untitled one', () => {
  const snapshot: QueryWorkspaceSnapshot = {
    version: 1,
    activeTabId: 'u1',
    tabs: [
      { id: 'u1', title: 'Query 1', connectionId: 'gone', query: 'SELECT 1' },
      { id: 'f1', title: 'daily.sql', connectionId: 'gone', filePath: 'C:\\q\\daily.sql', unsaved: false },
      { id: 'u2', title: 'Query 2', connectionId: 'c1', query: 'SELECT 2' }
    ]
  }
  const restored = restoreQueryWorkspace(snapshot, new Set(['c1']))
  assert.deepEqual(restored.tabs.map((item) => item.id), ['f1', 'u2'])
  assert.equal(restored.tabs[0].connectionId, null)
  assert.equal(restored.tabs[0].database, undefined)
  assert.equal(restored.activeTabId, 'f1')
})

test('restore marks file tabs loading and keeps their text out of drafts', () => {
  const snapshot: QueryWorkspaceSnapshot = {
    version: 1,
    activeTabId: 'f1',
    tabs: [
      { id: 'f1', title: 'daily.sql', connectionId: 'c1', database: 'app', filePath: 'C:\\q\\daily.sql', unsaved: false },
      { id: 'u1', title: 'Query 1', connectionId: 'c1', query: 'SELECT 1' }
    ]
  }
  const restored = restoreQueryWorkspace(snapshot, new Set(['c1']))
  const file = restored.tabs.find((item) => item.id === 'f1')
  const untitled = restored.tabs.find((item) => item.id === 'u1')
  assert.equal(file?.loading, true)
  assert.equal(file?.filePath, 'C:\\q\\daily.sql')
  assert.equal(file?.connectionId, 'c1')
  assert.equal(file?.database, 'app')
  assert.equal(restored.drafts.has('f1'), false)
  assert.equal(untitled?.loading, false)
  assert.equal(restored.drafts.get('u1'), 'SELECT 1')
})

test('restore carries the unsaved flag for file tabs', () => {
  const snapshot: QueryWorkspaceSnapshot = {
    version: 1,
    activeTabId: null,
    tabs: [
      { id: 'dirty', title: 'a.sql', connectionId: 'c1', filePath: 'a.sql', unsaved: true },
      { id: 'clean', title: 'b.sql', connectionId: 'c1', filePath: 'b.sql' }
    ]
  }
  const restored = restoreQueryWorkspace(snapshot, new Set(['c1']))
  assert.equal(restored.tabs.find((item) => item.id === 'dirty')?.unsaved, true)
  assert.equal(restored.tabs.find((item) => item.id === 'clean')?.unsaved, false)
})

test('snapshot omits query for file tabs and includes filePath and unsaved', () => {
  const tabs = [tab({ id: 'f1', title: 'daily.sql', filePath: 'C:\\q\\daily.sql', unsaved: true, connectionId: null })]
  const drafts = new Map([['f1', 'huge file text']])
  const snapshot = createQueryWorkspaceSnapshot(tabs, drafts, 'f1')
  assert.deepEqual(snapshot.tabs, [{
    id: 'f1',
    title: 'daily.sql',
    connectionId: null,
    database: undefined,
    filePath: 'C:\\q\\daily.sql',
    unsaved: true
  }])
  assert.equal(JSON.stringify(snapshot).includes('huge file text'), false)
})

test('snapshot keeps query for untitled tabs', () => {
  const tabs = [tab({ id: 'u1', title: 'Query 1', database: 'app' })]
  const snapshot = createQueryWorkspaceSnapshot(tabs, new Map([['u1', 'SELECT 1']]), 'u1')
  assert.deepEqual(snapshot.tabs, [{ id: 'u1', title: 'Query 1', connectionId: 'c1', database: 'app', query: 'SELECT 1' }])
  assert.equal('filePath' in snapshot.tabs[0], false)
})

test('snapshot round-trips through read for both tab kinds', () => {
  const tabs = [
    tab({ id: 'u1', title: 'Query 1' }),
    tab({ id: 'f1', title: 'a.sql', filePath: 'a.sql', unsaved: true, connectionId: null })
  ]
  const written = JSON.stringify(createQueryWorkspaceSnapshot(tabs, new Map([['u1', 'SELECT 1']]), 'f1'))
  const read = readQueryWorkspace(written)
  assert.ok(read)
  assert.deepEqual(read.tabs.map((item) => [item.id, item.connectionId, item.filePath, item.unsaved, item.query]), [
    ['u1', 'c1', undefined, undefined, 'SELECT 1'],
    ['f1', null, 'a.sql', true, undefined]
  ])
})
