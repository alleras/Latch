import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextActiveTabId, type QueryTabState } from '../src/renderer/src/query-tabs.ts'

function tab(id: string): QueryTabState {
  return { id, title: id, connectionId: 'c1', unsaved: false, loading: false, result: null, error: null, running: false }
}

const tabs = ['a', 'b', 'c', 'd'].map(tab)

test('nextActiveTabId keeps the active tab when it is not closing', () => {
  assert.equal(nextActiveTabId(tabs, 'b', new Set(['c', 'd']), 2), 'b')
})

test('nextActiveTabId lands on the tab at the anchor among those left', () => {
  assert.equal(nextActiveTabId(tabs, 'b', new Set(['b']), 1), 'c')
  assert.equal(nextActiveTabId(tabs, 'd', new Set(['d']), 3), 'c')
  assert.equal(nextActiveTabId(tabs, 'a', new Set(['a', 'b']), -4), 'c')
})

test('nextActiveTabId is null when every tab closes', () => {
  assert.equal(nextActiveTabId(tabs, 'a', new Set(['a', 'b', 'c', 'd']), 0), null)
  assert.equal(nextActiveTabId([], null, new Set(), 0), null)
})
