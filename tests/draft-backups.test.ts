import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DRAFT_BACKUP_DIRECTORY,
  deleteDraftBackup,
  draftBackupPath,
  flushDraftBackups,
  readDraftBackup,
  writeDraftBackup,
  writeDraftBackupSync
} from '../src/main/draft-backups.ts'

let root = ''
let directory = ''

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'latch-drafts-'))
  directory = join(root, DRAFT_BACKUP_DIRECTORY)
})

after(async () => {
  await rm(root, { recursive: true, force: true })
})

test('draftBackupPath joins directory and <id>.sql', () => {
  const id = randomUUID()
  assert.equal(draftBackupPath(directory, id), join(directory, `${id}.sql`))
})

test('draftBackupPath rejects non-UUID ids', () => {
  for (const bad of ['../../etc', 'abc', 'x'.repeat(36), '', `${randomUUID()}/..`]) {
    assert.throws(() => draftBackupPath(directory, bad), /Invalid draft id/)
  }
})

test('write then read returns the content', async () => {
  const id = randomUUID()
  await writeDraftBackup(directory, id, 'SELECT 1;\r\n-- edited')
  assert.equal(await readDraftBackup(directory, id), 'SELECT 1;\r\n-- edited')
})

test('read of a missing backup returns null', async () => {
  assert.equal(await readDraftBackup(directory, randomUUID()), null)
})

test('delete removes the file and tolerates a second delete', async () => {
  const id = randomUUID()
  await writeDraftBackup(directory, id, 'x')
  await deleteDraftBackup(directory, id)
  assert.equal(existsSync(draftBackupPath(directory, id)), false)
  await deleteDraftBackup(directory, id)
})

test('writeDraftBackupSync writes the content', async () => {
  const id = randomUUID()
  writeDraftBackupSync(directory, id, 'sync content')
  assert.equal(await readFile(draftBackupPath(directory, id), 'utf8'), 'sync content')
})

test('write creates the directory when it does not exist', async () => {
  const nested = join(root, 'nested', DRAFT_BACKUP_DIRECTORY)
  const id = randomUUID()
  await writeDraftBackup(nested, id, 'deep')
  assert.equal(await readDraftBackup(nested, id), 'deep')
  const syncNested = join(root, 'nested-sync', DRAFT_BACKUP_DIRECTORY)
  writeDraftBackupSync(syncNested, id, 'deep sync')
  assert.equal(await readDraftBackup(syncNested, id), 'deep sync')
})

test('a backup in the middle of being written is never exposed partially', async () => {
  const id = randomUUID()
  await writeDraftBackup(directory, id, 'OLD')
  const big = 'SELECT 1;\n'.repeat(1_600_000)
  const pending = writeDraftBackup(directory, id, big)
  const seen = await readDraftBackup(directory, id)
  await pending
  assert.ok(seen === 'OLD' || seen === big, `read saw a partial backup of length ${seen?.length ?? 'null'}`)
  assert.equal(await readDraftBackup(directory, id), big)
})

test('writers leave no temporary files behind', async () => {
  const id = randomUUID()
  await writeDraftBackup(directory, id, 'a')
  writeDraftBackupSync(directory, id, 'b')
  const names = await readdir(directory)
  assert.deepEqual(names.filter((name) => !name.endsWith('.sql')), [])
})

test('flushDraftBackups waits for writes that are still in flight', async () => {
  const id = randomUUID()
  const big = 'SELECT 2;\n'.repeat(800_000)
  void writeDraftBackup(directory, id, big)
  await flushDraftBackups()
  assert.equal(await readDraftBackup(directory, id), big)
})
