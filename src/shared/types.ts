export type ProviderId = 'sqlite' | 'postgresql' | 'mysql' | 'sqlserver' | 'azuresql'
export type ServerProviderId = Exclude<ProviderId, 'sqlite'>

export interface ProviderDefinition {
  id: ProviderId
  label: string
  description: string
  mode: 'file' | 'server'
  defaultPort?: number
  defaultDatabase?: string
  defaultSsl: boolean
}

interface ConnectionBase {
  id: string
  name: string
  provider: ProviderId
}

export interface SqliteConnection extends ConnectionBase {
  provider: 'sqlite'
  path: string
}

export interface ServerConnection extends ConnectionBase {
  provider: ServerProviderId
  host: string
  port: number
  username: string
  initialDatabase?: string
  ssl: boolean
  trustServerCertificate: boolean
}

export type Connection = SqliteConnection | ServerConnection

export interface ServerConnectionInput {
  provider: ServerProviderId
  name: string
  host: string
  port: number
  username: string
  password: string
  initialDatabase?: string
  ssl: boolean
  trustServerCertificate: boolean
}

export interface SchemaColumn {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
}

export type DatabaseObjectType = 'table' | 'view' | 'procedure' | 'function' | 'trigger'

export interface DatabaseObject {
  name: string
  schema?: string
  type: DatabaseObjectType
  columns: SchemaColumn[]
  parentName?: string
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
  message?: string
}

export interface LatchApi {
  listProviders: () => Promise<ProviderDefinition[]>
  listConnections: () => Promise<Connection[]>
  openDatabase: () => Promise<Connection | null>
  createDatabase: () => Promise<Connection | null>
  addServerConnection: (input: ServerConnectionInput) => Promise<Connection>
  removeConnection: (id: string) => Promise<Connection[]>
  listDatabases: (connectionId: string) => Promise<string[]>
  getSchema: (connectionId: string, database?: string) => Promise<DatabaseObject[]>
  executeQuery: (connectionId: string, database: string | undefined, sql: string) => Promise<QueryResult>
  writeClipboard: (text: string) => Promise<void>
  onCloseActiveTab: (callback: () => void) => () => void
}
