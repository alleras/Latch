import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { readSqlFile, sqlFileName, stripBom, writeSqlFile } from '../src/main/sql-files.ts'

let directory = ''

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'latch-sql-files-'))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

test('stripBom removes only a leading byte order mark', () => {
  assert.equal(stripBom('﻿SELECT 1'), 'SELECT 1')
  assert.equal(stripBom('SELECT ﻿1'), 'SELECT ﻿1')
  assert.equal(stripBom(''), '')
})

test('sqlFileName returns the base name', () => {
  assert.equal(sqlFileName('/tmp/reports/daily.sql'), 'daily.sql')
})

test('readSqlFile returns path, name and BOM-free content', async () => {
  const path = join(directory, 'with-bom.sql')
  await writeFile(path, '﻿SELECT 1', 'utf8')
  const file = await readSqlFile(path)
  assert.equal(file.path, path)
  assert.equal(file.name, basename(path))
  assert.equal(file.content, 'SELECT 1')
})

test('readSqlFile of an empty file returns empty content', async () => {
  const path = join(directory, 'empty.sql')
  await writeFile(path, '', 'utf8')
  const file = await readSqlFile(path)
  assert.equal(file.content, '')
})

test('writeSqlFile writes UTF-8 without a BOM and preserves CRLF', async () => {
  const path = join(directory, 'crlf.sql')
  await writeSqlFile(path, 'SELECT 1;\r\nSELECT 2;')
  const bytes = await readFile(path)
  assert.notEqual(bytes[0], 0xef)
  assert.equal(bytes.toString('utf8'), 'SELECT 1;\r\nSELECT 2;')
})

test('readSqlFile returns an absolute, normalized path', async () => {
  // Built by hand because path.join would normalize the ".." away before the call.
  const path = [directory, 'nested', '..', 'normalized.sql'].join(sep)
  await writeFile(join(directory, 'normalized.sql'), 'SELECT 1', 'utf8')
  const file = await readSqlFile(path)
  assert.equal(file.path, join(directory, 'normalized.sql'))
})

test('readSqlFile rejects for a missing file', async () => {
  await assert.rejects(readSqlFile(join(directory, 'definitely-missing.sql')))
})
