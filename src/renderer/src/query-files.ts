import type { SqlFileEncoding } from '../../shared/types'
import type { QueryTabState } from './query-tabs'

const ENCODING_LABELS: Record<SqlFileEncoding, string> = {
  utf8: 'UTF-8',
  utf8bom: 'UTF-8 with BOM',
  utf16le: 'UTF-16 LE',
  utf16be: 'UTF-16 BE',
  windows1252: 'Windows-1252'
}

/** Status bar name of a tab's encoding. Untitled tabs, and file tabs from before encodings were kept, are UTF-8. */
export function encodingLabel(encoding: SqlFileEncoding | undefined): string {
  return ENCODING_LABELS[encoding ?? 'utf8']
}

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

/** The queued tabs still worth asking about during a close: those still open and still unsaved, in queue order. */
export function unsavedTabsInQueue(tabs: QueryTabState[], queue: string[]): string[] {
  const unsaved = new Set(tabs.filter((tab) => tab.unsaved).map((tab) => tab.id))
  return queue.filter((id) => unsaved.has(id))
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
