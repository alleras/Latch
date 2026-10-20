import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { SqlFile } from '../shared/types'

const BYTE_ORDER_MARK = '﻿'

export function stripBom(text: string): string {
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text
}

export function sqlFileName(path: string): string {
  return basename(path)
}

export async function readSqlFile(path: string): Promise<SqlFile> {
  const content = stripBom(await readFile(path, 'utf8'))
  return { path, name: sqlFileName(path), content }
}

export async function writeSqlFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8')
}
