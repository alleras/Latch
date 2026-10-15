import type { QueryTabState } from './query-tabs'

export const QUERY_WORKSPACE_STORAGE_KEY = 'latch:query-workspace:v1'
export const LEGACY_QUERY_STORAGE_KEY = 'latch:query'

interface PersistedQueryTab {
  id: string
  title: string
  connectionId: string
  database?: string
  query: string
}

export interface QueryWorkspaceSnapshot {
  version: 1
  activeTabId: string | null
  explorerConnectionId: string | null
  explorerDatabase?: string
  tabs: PersistedQueryTab[]
}

export interface RestoredQueryWorkspace {
  tabs: QueryTabState[]
  drafts: Map<string, string>
  activeTabId: string | null
  explorerConnectionId: string | null
  explorerDatabase?: string
  nextQueryNumber: number
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function readQueryWorkspace(value: string | null): QueryWorkspaceSnapshot | null {
  if (!value) return null

  try {
    const candidate = JSON.parse(value) as Record<string, unknown>
    if (candidate.version !== 1 || !Array.isArray(candidate.tabs)) return null

    const tabs = candidate.tabs.flatMap((value): PersistedQueryTab[] => {
      if (!value || typeof value !== 'object') return []
      const tab = value as Record<string, unknown>
      if (
        typeof tab.id !== 'string'
        || typeof tab.title !== 'string'
        || typeof tab.connectionId !== 'string'
        || typeof tab.query !== 'string'
      ) return []

      return [{
        id: tab.id,
        title: tab.title,
        connectionId: tab.connectionId,
        database: optionalString(tab.database),
        query: tab.query
      }]
    })

    return {
      version: 1,
      activeTabId: optionalString(candidate.activeTabId) ?? null,
      explorerConnectionId: optionalString(candidate.explorerConnectionId) ?? null,
      explorerDatabase: optionalString(candidate.explorerDatabase),
      tabs
    }
  } catch {
    return null
  }
}

export function restoreQueryWorkspace(
  snapshot: QueryWorkspaceSnapshot | null,
  validConnectionIds: Set<string>
): RestoredQueryWorkspace {
  const seenTabIds = new Set<string>()
  const persistedTabs = snapshot?.tabs.filter((tab) => {
    if (!validConnectionIds.has(tab.connectionId) || seenTabIds.has(tab.id)) return false
    seenTabIds.add(tab.id)
    return true
  }) ?? []
  const tabs = persistedTabs.map<QueryTabState>((tab) => ({
    id: tab.id,
    title: tab.title,
    connectionId: tab.connectionId,
    database: tab.database,
    result: null,
    error: null,
    running: false
  }))
  const drafts = new Map(persistedTabs.map((tab) => [tab.id, tab.query]))
  const activeTabId = tabs.some((tab) => tab.id === snapshot?.activeTabId)
    ? snapshot?.activeTabId ?? null
    : tabs[0]?.id ?? null
  const explorerConnectionId = snapshot?.explorerConnectionId
    && validConnectionIds.has(snapshot.explorerConnectionId)
    ? snapshot.explorerConnectionId
    : null
  const greatestQueryNumber = tabs.reduce((greatest, tab) => {
    const match = /^Query (\d+)/.exec(tab.title)
    return match ? Math.max(greatest, Number(match[1])) : greatest
  }, 0)

  return {
    tabs,
    drafts,
    activeTabId,
    explorerConnectionId,
    explorerDatabase: explorerConnectionId === snapshot?.explorerConnectionId ? snapshot?.explorerDatabase : undefined,
    nextQueryNumber: greatestQueryNumber + 1
  }
}

export function createQueryWorkspaceSnapshot(
  tabs: QueryTabState[],
  drafts: Map<string, string>,
  activeTabId: string | null,
  explorerConnectionId: string | null,
  explorerDatabase?: string
): QueryWorkspaceSnapshot {
  return {
    version: 1,
    activeTabId,
    explorerConnectionId,
    explorerDatabase,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      connectionId: tab.connectionId,
      database: tab.database,
      query: drafts.get(tab.id) ?? ''
    }))
  }
}
