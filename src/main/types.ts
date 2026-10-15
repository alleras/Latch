import type { ServerConnection, SqliteConnection } from '../shared/types'

export type StoredServerConnection = ServerConnection & { encryptedPassword: string }
export type StoredConnection = SqliteConnection | StoredServerConnection

