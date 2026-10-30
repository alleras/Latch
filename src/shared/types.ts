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

export type SchemaConstraintType = 'primary-key' | 'foreign-key' | 'unique' | 'check' | 'exclusion'

export interface SchemaConstraint {
  name: string
  type: SchemaConstraintType
  columns: string[]
  referencedSchema?: string
  referencedTable?: string
  referencedColumns?: string[]
  expression?: string
  onUpdate?: string
  onDelete?: string
}

export interface SchemaIndexColumn {
  name?: string
  expression?: string
  descending: boolean
  included: boolean
  prefixLength?: number
}

export interface SchemaIndex {
  name: string
  unique: boolean
  primary: boolean
  type?: string
  columns: SchemaIndexColumn[]
  predicate?: string
}

export interface SchemaDefault {
  name?: string
  column: string
  expression: string
}

export type DatabaseObjectType = 'table' | 'view' | 'procedure' | 'function' | 'trigger'

export interface DatabaseObject {
  name: string
  schema?: string
  type: DatabaseObjectType
  columns: SchemaColumn[]
  constraints: SchemaConstraint[]
  indexes: SchemaIndex[]
  defaults: SchemaDefault[]
  parentName?: string
}

export interface QueryResult {
  columns: string[]
  /** Full database type declarations, aligned with columns by ordinal (including aliases). */
  columnTypes?: (string | null)[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
  message?: string
}

export type MenuCommand = 'new-query' | 'open-file' | 'save' | 'save-as'

export interface ApplicationMenuItem {
  id: number
  label: string
  type: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu'
  enabled: boolean
  checked: boolean
  accelerator?: string
  submenu?: ApplicationMenuItem[]
}

/** How a file's text is stored on disk. Saving writes the same encoding back; UTF-16 always has a byte order mark. */
export type SqlFileEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'windows1252'

export interface SqlFile {
  path: string
  content: string
  encoding: SqlFileEncoding
}

export interface LatchApi {
  /** The main process's `process.platform`, for platform-specific rules such as path case. */
  platform: string
  getApplicationMenu: () => Promise<ApplicationMenuItem[]>
  executeMenuItem: (id: number) => Promise<void>
  onMenuBarFocus: (callback: (label: string | null) => void) => () => void
  setTitleBarColors: (background: string, foreground: string) => Promise<void>
  listProviders: () => Promise<ProviderDefinition[]>
  listConnections: () => Promise<Connection[]>
  openDatabase: () => Promise<Connection | null>
  createDatabase: () => Promise<Connection | null>
  addServerConnection: (input: ServerConnectionInput) => Promise<Connection>
  removeConnection: (id: string) => Promise<Connection[]>
  listDatabases: (connectionId: string) => Promise<string[]>
  getSchema: (connectionId: string, database?: string) => Promise<DatabaseObject[]>
  executeQuery: (connectionId: string, database: string | undefined, sql: string, sessionId: string) => Promise<QueryResult>
  writeClipboard: (text: string) => Promise<void>
  onCloseActiveTab: (callback: () => void) => () => void
  /** Shows the open dialog and reads the chosen files. Empty when cancelled. */
  openSqlFiles: () => Promise<SqlFile[]>
  /** Only files picked in an open or save dialog can be read or written by path. */
  readSqlFile: (path: string) => Promise<SqlFile>
  /** Resolves to the encoding written: UTF-8 with a BOM when the text does not fit the requested one. */
  writeSqlFile: (path: string, content: string, encoding: SqlFileEncoding) => Promise<SqlFileEncoding>
  /** Keeps file access only for these paths, the files restored tabs still use. */
  retainFileAccess: (paths: string[]) => Promise<void>
  /** Shows the save dialog. Null when cancelled. */
  chooseSqlFilePath: (defaultPath: string) => Promise<string | null>
  writeDraftBackup: (tabId: string, content: string) => Promise<void>
  writeDraftBackupSync: (tabId: string, content: string) => void
  /** Null when no backup exists for the tab; rejects when one exists but cannot be read. */
  readDraftBackup: (tabId: string) => Promise<string | null>
  deleteDraftBackup: (tabId: string) => Promise<void>
  /** Removes old backups of tabs other than these, and abandoned temporary files. */
  pruneDraftBackups: (keepTabIds: string[]) => Promise<void>
  onMenuCommand: (callback: (command: MenuCommand) => void) => () => void
}
