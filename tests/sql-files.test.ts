import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { decodeSqlText, encodeSqlText, isSqlFileEncoding, readSqlFile, writeSqlFile } from '../src/main/sql-files.ts'

let directory = ''

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'latch-sql-files-'))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

const bytes = (...values: number[]): Buffer => Buffer.from(values)

test('decodeSqlText reads UTF-8 without a BOM', () => {
  assert.deepEqual(decodeSqlText(Buffer.from("SELECT N'Café'", 'utf8')), { content: "SELECT N'Café'", encoding: 'utf8' })
})

test('decodeSqlText strips a UTF-8 BOM and remembers it', () => {
  const decoded = decodeSqlText(Buffer.concat([bytes(0xef, 0xbb, 0xbf), Buffer.from('SELECT 1', 'utf8')]))
  assert.deepEqual(decoded, { content: 'SELECT 1', encoding: 'utf8bom' })
})

test('decodeSqlText reads UTF-16 LE and BE by their BOM', () => {
  const little = Buffer.concat([bytes(0xff, 0xfe), Buffer.from("N'Müller'", 'utf16le')])
  assert.deepEqual(decodeSqlText(little), { content: "N'Müller'", encoding: 'utf16le' })
  const big = Buffer.concat([bytes(0xfe, 0xff), Buffer.from("N'Müller'", 'utf16le').swap16()])
  assert.deepEqual(decodeSqlText(big), { content: "N'Müller'", encoding: 'utf16be' })
})

test('decodeSqlText falls back to Windows-1252 for bytes that are not UTF-8', () => {
  // "Café – €5" as Windows-1252.
  const decoded = decodeSqlText(bytes(0x43, 0x61, 0x66, 0xe9, 0x20, 0x96, 0x20, 0x80, 0x35))
  assert.deepEqual(decoded, { content: 'Café – €5', encoding: 'windows1252' })
})

test('decodeSqlText of an empty file is empty UTF-8', () => {
  assert.deepEqual(decodeSqlText(Buffer.alloc(0)), { content: '', encoding: 'utf8' })
})

test('every byte sequence survives decode then encode unchanged', () => {
  const samples = [
    Buffer.from(Array.from({ length: 256 }, (_, value) => value)),
    bytes(0xef, 0xbb, 0xbf, 0xc3, 0x28),
    bytes(0xff, 0xfe, 0x41),
    bytes(0xfe, 0xff, 0x00),
    Buffer.concat([bytes(0xff, 0xfe), Buffer.from('a\r\nb', 'utf16le')]),
    Buffer.from('SELECT 1;\r\nSELECT 2;', 'utf8')
  ]
  for (const sample of samples) {
    const { content, encoding } = decodeSqlText(sample)
    const encoded = encodeSqlText(content, encoding)
    assert.equal(encoded.encoding, encoding)
    assert.deepEqual(encoded.bytes, sample)
  }
})

test('encodeSqlText falls back to UTF-8 with BOM when Windows-1252 cannot hold the text', () => {
  const encoded = encodeSqlText("N'東京'", 'windows1252')
  assert.equal(encoded.encoding, 'utf8bom')
  assert.deepEqual(encoded.bytes, Buffer.concat([bytes(0xef, 0xbb, 0xbf), Buffer.from("N'東京'", 'utf8')]))
})

test('isSqlFileEncoding accepts only known encodings', () => {
  for (const encoding of ['utf8', 'utf8bom', 'utf16le', 'utf16be', 'windows1252']) assert.equal(isSqlFileEncoding(encoding), true)
  for (const value of ['utf-8', 'latin1', '', null, 1]) assert.equal(isSqlFileEncoding(value), false)
})

test('readSqlFile returns the content and the encoding it found', async () => {
  const path = join(directory, 'with-bom.sql')
  await writeFile(path, Buffer.concat([bytes(0xef, 0xbb, 0xbf), Buffer.from('SELECT 1', 'utf8')]))
  assert.deepEqual(await readSqlFile(path), { path, content: 'SELECT 1', encoding: 'utf8bom' })
})

test('writeSqlFile writes back the encoding it was given and reports it', async () => {
  const path = join(directory, 'utf16.sql')
  assert.equal(await writeSqlFile(path, 'SELECT 1;\r\nSELECT 2;', 'utf16le'), 'utf16le')
  assert.deepEqual(await readFile(path), Buffer.concat([bytes(0xff, 0xfe), Buffer.from('SELECT 1;\r\nSELECT 2;', 'utf16le')]))
})

test('writeSqlFile reports the fallback encoding it used', async () => {
  const path = join(directory, 'fallback.sql')
  assert.equal(await writeSqlFile(path, '-- ✓', 'windows1252'), 'utf8bom')
  assert.equal((await readSqlFile(path)).content, '-- ✓')
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
