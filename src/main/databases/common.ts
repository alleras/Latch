export function serializeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return `[BLOB · ${value.byteLength} bytes]`
  return value
}

export function serializeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, serializeValue(value)])
  ))
}

