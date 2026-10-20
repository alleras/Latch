import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { QueryTabState } from '../src/renderer/src/query-tabs.ts'
import {
  defaultSavePath,
  fileTitle,
  findTabForPath,
  partitionTabsForRemovedConnection,
  pathsEqual,
  saveLeavesTabClean,
  unsavedFileTabs
} from '../src/renderer/src/query-files.ts'

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

test('fileTitle handles both separators', () => {
  assert.equal(fileTitle('C:\\work\\report.sql'), 'report.sql')
  assert.equal(fileTitle('/home/d/queries/daily.sql'), 'daily.sql')
  assert.equal(fileTitle('plain.sql'), 'plain.sql')
})

test('defaultSavePath prefers the bound path, else <title>.sql', () => {
  assert.equal(defaultSavePath(tab({ id: 'a', title: 'report.sql', filePath: 'C:\\work\\report.sql' })), 'C:\\work\\report.sql')
  assert.equal(defaultSavePath(tab({ id: 'b', title: 'Query 3' })), 'Query 3.sql')
})

test('pathsEqual ignores case only on Windows', () => {
  assert.equal(pathsEqual('C:\\Q\\Daily.sql', 'c:\\q\\daily.sql', 'win32'), true)
  assert.equal(pathsEqual('/q/Daily.sql', '/q/daily.sql', 'linux'), false)
  assert.equal(pathsEqual('/q/Daily.sql', '/q/daily.sql', 'darwin'), false)
  assert.equal(pathsEqual('/q/daily.sql', '/q/daily.sql', 'linux'), true)
})

test('findTabForPath matches exactly on Linux and case-insensitively on Windows', () => {
  const tabs = [tab({ id: 'a', filePath: 'C:\\a.sql' }), tab({ id: 'b', filePath: 'C:\\b.sql' }), tab({ id: 'c' })]
  assert.equal(findTabForPath(tabs, 'C:\\b.sql', 'linux')?.id, 'b')
  assert.equal(findTabForPath(tabs, 'C:\\B.sql', 'linux'), undefined)
  assert.equal(findTabForPath(tabs, 'C:\\B.sql', 'win32')?.id, 'b')
  assert.equal(findTabForPath(tabs, 'C:\\missing.sql', 'win32'), undefined)
})

test('saveLeavesTabClean compares the version captured before the write with the current one', () => {
  assert.equal(saveLeavesTabClean(7, 7), true)
  assert.equal(saveLeavesTabClean(7, 9), false)
  assert.equal(saveLeavesTabClean(null, null), true)
  assert.equal(saveLeavesTabClean(null, 3), true)
})

test('unsavedFileTabs keeps tab order and ignores untitled and saved tabs', () => {
  const tabs = [
    tab({ id: 'untitled' }),
    tab({ id: 'A', filePath: 'a.sql', unsaved: true }),
    tab({ id: 'B', filePath: 'b.sql', unsaved: false }),
    tab({ id: 'C', filePath: 'c.sql', unsaved: true })
  ]
  const ids = new Set(tabs.map((item) => item.id))
  assert.deepEqual(unsavedFileTabs(tabs, ids).map((item) => item.id), ['A', 'C'])
})

test('unsavedFileTabs only considers the given ids', () => {
  const tabs = [
    tab({ id: 'A', filePath: 'a.sql', unsaved: true }),
    tab({ id: 'C', filePath: 'c.sql', unsaved: true })
  ]
  assert.deepEqual(unsavedFileTabs(tabs, new Set(['C'])).map((item) => item.id), ['C'])
  assert.deepEqual(unsavedFileTabs(tabs, new Set()), [])
})

test('partitionTabsForRemovedConnection detaches file tabs and closes untitled ones', () => {
  const tabs = [
    tab({ id: 'F', connectionId: 'c1', filePath: 'f.sql' }),
    tab({ id: 'U', connectionId: 'c1' }),
    tab({ id: 'G', connectionId: 'c2', filePath: 'g.sql' }),
    tab({ id: 'N', connectionId: null })
  ]
  const { detach, close } = partitionTabsForRemovedConnection(tabs, 'c1')
  assert.deepEqual([...detach], ['F'])
  assert.deepEqual([...close], ['U'])
})
