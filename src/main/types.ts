import type { ServerConnection, SqliteConnection } from '../shared/types'

export type StoredServerConnection = ServerConnection & { encryptedPassword: string }
export type StoredConnection = SqliteConnection | StoredServerConnection

/** Limits for a one-off query from the `latch` command line. */
export interface BoundedQueryOptions {
  /** Enforce read-only access in the database where the provider supports it. */
  readOnly: boolean
  timeoutMs: number
  /** Rows kept per result set; further rows are dropped and the set is marked truncated. */
  maxRows: number
}

