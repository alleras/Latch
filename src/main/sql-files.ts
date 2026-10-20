import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { SqlFile } from '../shared/types'

const BYTE_ORDER_MARK = '﻿'

export function stripBom(text: string): string {
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text
}

export function sqlFileName(path: string): string {
  return basename(path)
}

/** Reads a file and reports it under its absolute, normalized path so tabs can be matched by path. */
export async function readSqlFile(path: string): Promise<SqlFile> {
  const absolute = resolve(path)
  const content = stripBom(await readFile(absolute, 'utf8'))
  return { path: absolute, name: sqlFileName(absolute), content }
}

export async function writeSqlFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8')
}
