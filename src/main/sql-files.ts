import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SqlFile, SqlFileEncoding } from '../shared/types'

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const UTF16LE_BOM = Buffer.from([0xff, 0xfe])
const UTF16BE_BOM = Buffer.from([0xfe, 0xff])
const SQL_FILE_ENCODINGS: ReadonlySet<string> = new Set<SqlFileEncoding>(['utf8', 'utf8bom', 'utf16le', 'utf16be', 'windows1252'])

/**
 * Code points of Windows-1252 bytes 0x80-0x9F. The five bytes the code page leaves unassigned map to
 * the C1 control with the same value, so every byte sequence decodes and encodes back unchanged.
 */
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178
]
const WINDOWS_1252_BYTES = new Map(WINDOWS_1252_HIGH.map((codePoint, index) => [codePoint, 0x80 + index]))

export function isSqlFileEncoding(value: unknown): value is SqlFileEncoding {
  return typeof value === 'string' && SQL_FILE_ENCODINGS.has(value)
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
}

function decodeWindows1252(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_HIGH[byte - 0x80] : byte)
  return text
}

/** Null when the text holds a character Windows-1252 has no byte for. */
function encodeWindows1252(text: string): Buffer | null {
  const bytes = Buffer.alloc(text.length)
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    const byte = code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : WINDOWS_1252_BYTES.get(code)
    if (byte === undefined) return null
    bytes[index] = byte
  }
  return bytes
}

function startsWith(bytes: Uint8Array, prefix: Buffer): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value)
}

/**
 * Detects how a file's text is stored: a byte order mark names UTF-8 or UTF-16, BOM-less bytes are
 * UTF-8 when they are valid UTF-8, and anything else is read as Windows-1252, which accepts every byte.
 */
export function decodeSqlText(bytes: Uint8Array): { content: string; encoding: SqlFileEncoding } {
  if (startsWith(bytes, UTF8_BOM)) {
    const content = decodeUtf8(bytes.subarray(UTF8_BOM.length))
    if (content !== null) return { content, encoding: 'utf8bom' }
  } else if (bytes.length % 2 === 0 && startsWith(bytes, UTF16LE_BOM)) {
    return { content: Buffer.from(bytes.subarray(2)).toString('utf16le'), encoding: 'utf16le' }
  } else if (bytes.length % 2 === 0 && startsWith(bytes, UTF16BE_BOM)) {
    return { content: Buffer.from(bytes.subarray(2)).swap16().toString('utf16le'), encoding: 'utf16be' }
  } else {
    const content = decodeUtf8(bytes)
    if (content !== null) return { content, encoding: 'utf8' }
  }
  return { content: decodeWindows1252(bytes), encoding: 'windows1252' }
}

/** Encodes text for disk. Text that Windows-1252 cannot hold is written as UTF-8 with a BOM instead. */
export function encodeSqlText(content: string, encoding: SqlFileEncoding): { bytes: Buffer; encoding: SqlFileEncoding } {
  switch (encoding) {
    case 'utf8':
      return { bytes: Buffer.from(content, 'utf8'), encoding }
    case 'utf8bom':
      return { bytes: Buffer.concat([UTF8_BOM, Buffer.from(content, 'utf8')]), encoding }
    case 'utf16le':
      return { bytes: Buffer.concat([UTF16LE_BOM, Buffer.from(content, 'utf16le')]), encoding }
    case 'utf16be':
      return { bytes: Buffer.concat([UTF16BE_BOM, Buffer.from(content, 'utf16le').swap16()]), encoding }
    case 'windows1252': {
      const bytes = encodeWindows1252(content)
      return bytes ? { bytes, encoding } : encodeSqlText(content, 'utf8bom')
    }
  }
}

/** Reads a file and reports it under its absolute, normalized path so tabs can be matched by path. */
export async function readSqlFile(path: string): Promise<SqlFile> {
  const absolute = resolve(path)
  return { path: absolute, ...decodeSqlText(await readFile(absolute)) }
}

/** Writes the text in the requested encoding and resolves to the encoding actually written. */
export async function writeSqlFile(path: string, content: string, encoding: SqlFileEncoding): Promise<SqlFileEncoding> {
  const encoded = encodeSqlText(content, encoding)
  await writeFile(path, encoded.bytes)
  return encoded.encoding
}
