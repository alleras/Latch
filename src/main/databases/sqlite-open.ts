import type { DatabaseSync, DatabaseSyncOptions } from 'node:sqlite'

/**
 * Loads node:sqlite on first use rather than at startup: Node prints an experimental-feature warning
 * when the module loads, and the `latch` command line filters that warning only once it is running.
 */
export function openSqliteDatabase(path: string, options?: DatabaseSyncOptions): DatabaseSync {
  const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite')
  // DatabaseSync rejects an explicit undefined options argument.
  return options ? new Database(path, options) : new Database(path)
}
