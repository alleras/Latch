import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DRAFT_BACKUP_DIRECTORY,
  deleteDraftBackup,
  draftBackupPath,
  flushDraftBackups,
  pruneDraftBackups,
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

test('an older write that finishes after a newer sync write does not replace it', async () => {
  const id = randomUUID()
  const pending = writeDraftBackup(directory, id, 'SELECT 3;\n'.repeat(800_000))
  writeDraftBackupSync(directory, id, 'newest')
  await pending
  assert.equal(await readDraftBackup(directory, id), 'newest')
})

test('of two writes in flight, the later one wins whichever finishes first', async () => {
  const id = randomUUID()
  const older = writeDraftBackup(directory, id, 'SELECT 4;\n'.repeat(800_000))
  const newer = writeDraftBackup(directory, id, 'small')
  await Promise.all([older, newer])
  assert.equal(await readDraftBackup(directory, id), 'small')
})

test('a write still in flight when the backup is deleted does not bring it back', async () => {
  const id = randomUUID()
  const pending = writeDraftBackup(directory, id, 'SELECT 5;\n'.repeat(800_000))
  await deleteDraftBackup(directory, id)
  await pending
  assert.equal(existsSync(draftBackupPath(directory, id)), false)
  assert.deepEqual((await readdir(directory)).filter((name) => name.startsWith(id)), [])
})

test('a backup that exists but cannot be read rejects instead of reading as missing', async () => {
  const id = randomUUID()
  await mkdir(draftBackupPath(directory, id), { recursive: true })
  await assert.rejects(readDraftBackup(directory, id, []))
})

test('prune removes old orphaned backups and stale temporary files only', async () => {
  const pruneDirectory = join(root, 'prune')
  await mkdir(pruneDirectory, { recursive: true })
  const now = Date.now()
  const daysAgo = (days: number): Date => new Date(now - days * 24 * 60 * 60 * 1000)
  const kept = randomUUID()
  const oldOrphan = randomUUID()
  const recentOrphan = randomUUID()
  const files: Array<[string, Date]> = [
    [`${kept}.sql`, daysAgo(30)],
    [`${oldOrphan}.sql`, daysAgo(8)],
    [`${recentOrphan}.sql`, daysAgo(1)],
    [`${kept}.sql.1.7.tmp`, daysAgo(1)],
    [`${kept}.sql.1.8.tmp`, new Date(now)],
    [`${kept}.sql.${process.pid}.9.tmp`, daysAgo(1)],
    ['notes.txt', daysAgo(30)]
  ]
  for (const [name, time] of files) {
    await writeFile(join(pruneDirectory, name), 'x', 'utf8')
    await utimes(join(pruneDirectory, name), time, time)
  }
  await pruneDraftBackups(pruneDirectory, [kept], now)
  assert.deepEqual((await readdir(pruneDirectory)).sort(), [
    `${kept}.sql`,
    `${kept}.sql.${process.pid}.9.tmp`,
    `${kept}.sql.1.8.tmp`,
    `${recentOrphan}.sql`,
    'notes.txt'
  ].sort())
})

test('prune tolerates a missing directory', async () => {
  await pruneDraftBackups(join(root, 'never-created'), [])
})
