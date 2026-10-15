export const EXPLORER_STORAGE_KEY = 'latch:database-explorer:v1'

export interface ExplorerSnapshot {
  connectionId: string | null
  database?: string
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function readExplorerSnapshot(value: string | null): ExplorerSnapshot | null {
  if (!value) return null
  try {
    const candidate = JSON.parse(value) as Record<string, unknown>
    if (candidate.version !== 1) return null
    return {
      connectionId: optionalString(candidate.connectionId) ?? null,
      database: optionalString(candidate.database)
    }
  } catch {
    return null
  }
}

export function serializeExplorerSnapshot(snapshot: ExplorerSnapshot): string {
  return JSON.stringify({ version: 1, ...snapshot })
}
