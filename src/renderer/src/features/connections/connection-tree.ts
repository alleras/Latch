import type { Connection, ProviderDefinition } from '../../../../shared/types'

export interface IndexedConnection {
  connection: Connection
  providerLabel: string
  search: string
  databases: { name: string; search: string }[]
}

export function indexConnections(connections: Connection[], providers: ProviderDefinition[], databases: Record<string, string[]>): IndexedConnection[] {
  const labels = new Map(providers.map((provider) => [provider.id, provider.label]))
  return connections.map((connection) => {
    const providerLabel = labels.get(connection.provider) ?? connection.provider
    return {
      connection,
      providerLabel,
      search: [connection.name, providerLabel, connection.provider, connection.provider === 'sqlite' ? connection.path : connection.host].join(' ').toLocaleLowerCase(),
      databases: (databases[connection.id] ?? []).map((name) => ({ name, search: name.toLocaleLowerCase() }))
    }
  })
}

export interface ConnectionTreeRow {
  kind: 'connection' | 'databases' | 'database' | 'empty'
  entry: IndexedConnection
  database?: string
  expanded: boolean
  count: number
  top: number
  height: number
}

export function connectionRows(entries: IndexedConnection[], expanded: Set<string>, needle: string, loading: Set<string>, sizes: { connectionRowHeight: number; detailRowHeight: number; rowHeight: number }): ConnectionTreeRow[] {
  const rows: ConnectionTreeRow[] = []
  let top = 0
  const append = (row: Omit<ConnectionTreeRow, 'top'>): void => {
    rows.push({ ...row, top })
    top += row.height
  }
  for (const entry of entries) {
    const matchesConnection = !needle || entry.search.includes(needle)
    const databases = matchesConnection ? entry.databases : entry.databases.filter((database) => database.search.includes(needle))
    if (!matchesConnection && databases.length === 0) continue
    const open = entry.connection.provider !== 'sqlite' && (Boolean(needle) || expanded.has(entry.connection.id))
    const common = { entry, expanded: open, count: databases.length }
    append({ ...common, kind: 'connection', height: sizes.connectionRowHeight })
    if (!open) continue
    append({ ...common, kind: 'databases', height: sizes.detailRowHeight })
    for (const database of databases) append({ ...common, kind: 'database', database: database.name, height: sizes.rowHeight })
    if (databases.length === 0 && !loading.has(entry.connection.id)) append({ ...common, kind: 'empty', height: sizes.detailRowHeight })
  }
  return rows
}

/** Binary search avoids scanning thousands of rows on each scroll event. */
export function visibleConnectionRows(rows: ConnectionTreeRow[], scrollTop: number, height: number): ConnectionTreeRow[] {
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (rows[middle].top + rows[middle].height <= scrollTop) low = middle + 1
    else high = middle
  }
  const start = Math.max(0, low - 4)
  let end = low
  while (end < rows.length && rows[end].top < scrollTop + height) end += 1
  return rows.slice(start, Math.min(rows.length, end + 4))
}
