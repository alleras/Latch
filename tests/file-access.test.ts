import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileAccess } from '../src/main/file-access.ts'

let directory = ''
let storeNumber = 0

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'latch-file-access-'))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

function newStore(): string {
  storeNumber += 1
  return join(directory, `store-${storeNumber}`, 'file-access.json')
}

test('check rejects a path that was never granted', () => {
  const access = createFileAccess(newStore())
  assert.throws(() => access.check(join(directory, 'secret.sql')), /file dialog/)
})

test('grant returns the absolute path and allows it', () => {
  const access = createFileAccess(newStore())
  const path = join(directory, 'report.sql')
  assert.equal(access.grant(join(directory, 'nested', '..', 'report.sql')), path)
  assert.equal(access.check(path), path)
})

test('paths match case-insensitively only on Windows', () => {
  const path = join(directory, 'Report.sql')
  const windows = createFileAccess(newStore(), 'win32')
  windows.grant(path)
  assert.equal(windows.check(path.toUpperCase()), path.toUpperCase())
  const linux = createFileAccess(newStore(), 'linux')
  linux.grant(path)
  assert.throws(() => linux.check(path.toUpperCase()), /file dialog/)
})

test('grants survive a restart', () => {
  const store = newStore()
  const path = join(directory, 'kept.sql')
  createFileAccess(store).grant(path)
  assert.equal(createFileAccess(store).check(path), path)
})

test('retain drops every path not listed and never adds one', () => {
  const store = newStore()
  const access = createFileAccess(store)
  const kept = join(directory, 'kept.sql')
  const dropped = join(directory, 'dropped.sql')
  const neverGranted = join(directory, 'never.sql')
  access.grant(kept)
  access.grant(dropped)
  access.retain([kept, neverGranted])
  assert.equal(access.check(kept), kept)
  assert.throws(() => access.check(dropped), /file dialog/)
  assert.throws(() => access.check(neverGranted), /file dialog/)
  const restarted = createFileAccess(store)
  assert.throws(() => restarted.check(dropped), /file dialog/)
})

test('an unreadable store grants nothing', async () => {
  const store = newStore()
  createFileAccess(store).grant(join(directory, 'x.sql'))
  await writeFile(store, '{ not json', 'utf8')
  assert.throws(() => createFileAccess(store).check(join(directory, 'x.sql')), /file dialog/)
})
