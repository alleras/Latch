import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * The files the renderer may read and write by path: only the ones the user picked in an open or save
 * dialog. The list is persisted so tabs restored at launch still reach their files, and the renderer
 * trims it at launch to the files its tabs still use.
 */
export interface FileAccess {
  /** Records a path the user picked and returns it absolute. */
  grant: (path: string) => string
  /** Returns the path absolute, or throws when the user never picked it. */
  check: (path: string) => string
  /** Keeps access only to the given paths. It can only remove access, never add it. */
  retain: (paths: string[]) => void
}

export function createFileAccess(storePath: string, platform: string = process.platform): FileAccess {
  // Windows paths name the same file regardless of case.
  const key = (path: string): string => platform === 'win32' ? path.toLowerCase() : path
  let granted: Map<string, string> | null = null

  const load = (): Map<string, string> => {
    if (granted) return granted
    granted = new Map()
    try {
      const stored: unknown = JSON.parse(readFileSync(storePath, 'utf8'))
      if (Array.isArray(stored)) {
        for (const path of stored) if (typeof path === 'string') granted.set(key(path), path)
      }
    } catch {
      // A missing or unreadable list grants nothing; the user opens the file from the dialog again.
    }
    return granted
  }

  const save = (paths: Map<string, string>): void => {
    try {
      const temporary = `${storePath}.${process.pid}.tmp`
      mkdirSync(dirname(storePath), { recursive: true })
      writeFileSync(temporary, JSON.stringify([...paths.values()]), 'utf8')
      renameSync(temporary, storePath)
    } catch (error) {
      // Access still holds for this session; only the next launch is affected.
      console.error('Failed to save the list of opened files.', error)
    }
  }

  return {
    grant(path) {
      const absolute = resolve(path)
      const paths = load()
      if (paths.get(key(absolute)) !== absolute) {
        paths.set(key(absolute), absolute)
        save(paths)
      }
      return absolute
    },
    check(path) {
      const absolute = resolve(path)
      if (!load().has(key(absolute))) throw new Error(`Latch only reads and writes files picked in a file dialog: ${absolute}`)
      return absolute
    },
    retain(keep) {
      const keepKeys = new Set(keep.map((path) => key(resolve(path))))
      const paths = load()
      let changed = false
      for (const pathKey of [...paths.keys()]) {
        if (keepKeys.has(pathKey)) continue
        paths.delete(pathKey)
        changed = true
      }
      if (changed) save(paths)
    }
  }
}
