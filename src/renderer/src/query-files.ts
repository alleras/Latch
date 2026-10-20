import type { QueryTabState } from './query-tabs'

/** File name portion of a path from either platform; the renderer has no node:path. */
export function fileTitle(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return separator >= 0 ? path.slice(separator + 1) : path
}

export function defaultSavePath(tab: QueryTabState): string {
  return tab.filePath ?? `${tab.title}.sql`
}

/** Windows paths name the same file regardless of case; other platforms compare exactly. */
export function pathsEqual(a: string, b: string, platform: string): boolean {
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

export function findTabForPath(tabs: QueryTabState[], path: string, platform: string): QueryTabState | undefined {
  return tabs.find((tab) => tab.filePath !== undefined && pathsEqual(tab.filePath, path, platform))
}

/**
 * A save writes the text captured when it started. The tab is clean afterwards only if nothing was
 * typed meanwhile, i.e. the model's version is still the captured one. A tab without a model (not
 * active, so nothing could be typed) counts as clean.
 */
export function saveLeavesTabClean(capturedVersion: number | null, currentVersion: number | null): boolean {
  return capturedVersion === null || capturedVersion === currentVersion
}

/** File tabs with unsaved edits among `ids`, in tab order. Untitled tabs never qualify. */
export function unsavedFileTabs(tabs: QueryTabState[], ids: Set<string>): QueryTabState[] {
  return tabs.filter((tab) => ids.has(tab.id) && tab.filePath !== undefined && tab.unsaved)
}

/** When a connection is removed, file tabs keep their text and detach; untitled tabs close. */
export function partitionTabsForRemovedConnection(
  tabs: QueryTabState[],
  connectionId: string
): { detach: Set<string>; close: Set<string> } {
  const detach = new Set<string>()
  const close = new Set<string>()
  for (const tab of tabs) {
    if (tab.connectionId !== connectionId) continue
    if (tab.filePath !== undefined) detach.add(tab.id)
    else close.add(tab.id)
  }
  return { detach, close }
}
