import type { QueryResult } from '../../shared/types'

export interface QueryTabState {
  id: string
  title: string
  /** Null for a tab that has no execution target yet; such tabs cannot run. */
  connectionId: string | null
  database?: string
  /** Present on tabs bound to a file on disk. */
  filePath?: string
  /** Text differs from what was last opened or saved. Always false for untitled tabs. */
  unsaved: boolean
  /** True while a restored file tab's text is still being read. */
  loading: boolean
  result: QueryResult | null
  error: string | null
  running: boolean
}

export type CloseTabScope = 'tab' | 'others' | 'right' | 'all'

export function updateQueryTab(
  tabs: QueryTabState[],
  tabId: string,
  update: Partial<Omit<QueryTabState, 'id'>>
): QueryTabState[] {
  return tabs.map((tab) => tab.id === tabId ? { ...tab, ...update } : tab)
}

export function connectionDatabaseKey(connectionId: string, database?: string): string {
  return JSON.stringify([connectionId, database ?? ''])
}

export function tabIdsForCloseScope(
  tabs: QueryTabState[],
  tabId: string,
  scope: CloseTabScope
): Set<string> {
  if (scope === 'all') return new Set(tabs.map((tab) => tab.id))

  const targetIndex = tabs.findIndex((tab) => tab.id === tabId)
  if (targetIndex < 0) return new Set()
  if (scope === 'tab') return new Set([tabId])
  if (scope === 'others') return new Set(tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id))
  return new Set(tabs.slice(targetIndex + 1).map((tab) => tab.id))
}
