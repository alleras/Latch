export function serializeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return `[BLOB · ${value.byteLength} bytes]`
  return value
}

export function serializeRows(rows: unknown[][]): unknown[][] {
  return rows.map((row) => row.map(serializeValue))
}

export function rowsAffectedMessage(count: number): string {
  return `${count} row${count === 1 ? '' : 's'} affected`
}

export function pushGrouped<K, V>(groups: Map<K, V[]>, key: K, value: V): void {
  const values = groups.get(key)
  if (values) values.push(value)
  else groups.set(key, [value])
}

export function relationKey(schema: string | undefined, table: string): string {
  return JSON.stringify([schema ?? '', table])
}
