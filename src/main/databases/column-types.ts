interface SqlServerTypeDetails {
  type: string
  length?: number | null
  precision?: number | null
  scale?: number | null
}

/** Length is in characters for character types, bytes for binary types. */
export function sqlServerTypeDeclaration({ type, length, precision, scale }: SqlServerTypeDetails): string {
  const name = type.toUpperCase()
  if (/^(N?VAR)?CHAR$|^NCHAR$|^VARBINARY$|^BINARY$/.test(name) && length != null) {
    return `${name}(${length === -1 || length === 65535 ? 'MAX' : length})`
  }
  if (/^(DECIMAL|NUMERIC)$/.test(name) && precision != null && scale != null) {
    return `${name}(${precision},${scale})`
  }
  if (/^(TIME|DATETIME2|DATETIMEOFFSET)$/.test(name) && scale != null) return `${name}(${scale})`
  if (name === 'FLOAT' && precision != null) return `${name}(${precision})`
  return name
}

export function sqlServerResultType(column: {
  type: unknown
  length: number
  precision?: number
  scale?: number
}): string | null {
  const type = (column.type as { declaration?: string }).declaration
  if (!type) return null
  // TDS reports Unicode character lengths in bytes; MAX uses the sentinel 0xffff.
  const length = /^n(var)?char$/i.test(type) && column.length !== 65535 && column.length !== -1
    ? column.length / 2 : column.length
  return sqlServerTypeDeclaration({ ...column, type, length })
}

/** Keep quoted enum values and user-defined type names exactly as declared. */
export function mysqlTypeDeclaration(type: string): string {
  return type.replace(/^[a-z]+/i, (name) => name.toUpperCase())
}

const MYSQL_TYPES: Record<number, string> = {
  0: 'DECIMAL', 1: 'TINYINT', 2: 'SMALLINT', 3: 'INT', 4: 'FLOAT', 5: 'DOUBLE',
  6: 'NULL', 7: 'TIMESTAMP', 8: 'BIGINT', 9: 'MEDIUMINT', 10: 'DATE', 11: 'TIME',
  12: 'DATETIME', 13: 'YEAR', 14: 'DATE', 15: 'VARCHAR', 16: 'BIT', 242: 'VECTOR',
  245: 'JSON', 246: 'DECIMAL', 247: 'ENUM', 248: 'SET', 249: 'TINYBLOB',
  250: 'MEDIUMBLOB', 251: 'LONGBLOB', 252: 'BLOB', 253: 'VARCHAR', 254: 'CHAR', 255: 'GEOMETRY'
}

export function mysqlResultType(field: {
  columnType?: number
  characterSet?: number
  columnLength?: number
  decimals: number
  flags: number | string[]
}): string | null {
  let type = MYSQL_TYPES[field.columnType ?? -1]
  if (!type) return null
  const binary = field.characterSet === 63
  if (type === 'VARCHAR' && binary) type = 'VARBINARY'
  if (type === 'CHAR' && binary) type = 'BINARY'
  if (type.endsWith('BLOB') && !binary) type = type.replace('BLOB', 'TEXT')
  const length = field.columnLength
  if (type === 'DECIMAL' && length != null) {
    const unsigned = typeof field.flags === 'number' ? (field.flags & 32) !== 0 : field.flags.includes('UNSIGNED')
    return `${type}(${length - (unsigned ? 0 : 1) - (field.decimals > 0 ? 1 : 0)},${field.decimals})`
  }
  if (type === 'BIT' && length != null) return `${type}(${length})`
  // Expression fields have no declared source column. The protocol supplies byte
  // capacity, so label that unit instead of pretending it is a character count.
  if (/^(VAR)?(CHAR|BINARY)$/.test(type) && length != null) return `${type} (up to ${length} bytes)`
  return type
}
