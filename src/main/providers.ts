import type { DatabaseObject, ProviderDefinition, ProviderId, QueryResult, ServerProviderId } from '../shared/types'
import { closeAllMySqlConnections, closeMySqlConnection, executeMySqlQuery, getMySqlSchema, listMySqlDatabases, testMySql } from './databases/mysql'
import { closeAllPostgresConnections, closePostgresConnection, executePostgresQuery, getPostgresSchema, listPostgresDatabases, testPostgres } from './databases/postgresql'
import { closeAllSqlServerConnections, closeSqlServerConnection, executeSqlServerQuery, getSqlServerSchema, listSqlServerDatabases, testSqlServer } from './databases/sql-server'
import { closeAllSqliteConnections, closeSqliteConnection, executeSqliteQuery, getSqliteSchema } from './databases/sqlite'
import type { StoredConnection, StoredServerConnection } from './types'

interface ProviderAdapter {
  definition: ProviderDefinition
  test?: (connection: StoredConnection) => Promise<void>
  listDatabases: (connection: StoredConnection) => Promise<string[]>
  getSchema: (connection: StoredConnection, database?: string) => Promise<DatabaseObject[]>
  execute: (connection: StoredConnection, database: string | undefined, query: string) => Promise<QueryResult>
  closeConnection: (connectionId: string) => Promise<void>
  closeAll: () => Promise<void>
}

type ProviderServerConnection<P extends ServerProviderId> = StoredServerConnection & { provider: P }

function server<P extends ServerProviderId>(connection: StoredConnection, provider: P): ProviderServerConnection<P> {
  if (connection.provider !== provider) throw new Error(`Expected a ${provider} connection.`)
  return connection as ProviderServerConnection<P>
}

function requireDatabase(database?: string): string {
  if (!database) throw new Error('Select a database first.')
  return database
}

const adapters = {
  postgresql: {
    definition: { id: 'postgresql', label: 'PostgreSQL', description: 'Postgres and compatible services', mode: 'server', defaultPort: 5432, defaultDatabase: 'postgres', defaultSsl: false },
    test: (connection) => testPostgres(server(connection, 'postgresql')),
    listDatabases: (connection) => listPostgresDatabases(server(connection, 'postgresql')),
    getSchema: (connection, database) => getPostgresSchema(server(connection, 'postgresql'), requireDatabase(database)),
    execute: (connection, database, query) => executePostgresQuery(server(connection, 'postgresql'), requireDatabase(database), query),
    closeConnection: closePostgresConnection,
    closeAll: closeAllPostgresConnections
  },
  mysql: {
    definition: { id: 'mysql', label: 'MySQL', description: 'MySQL and compatible services', mode: 'server', defaultPort: 3306, defaultSsl: false },
    test: (connection) => testMySql(server(connection, 'mysql')),
    listDatabases: (connection) => listMySqlDatabases(server(connection, 'mysql')),
    getSchema: (connection, database) => getMySqlSchema(server(connection, 'mysql'), requireDatabase(database)),
    execute: (connection, database, query) => executeMySqlQuery(server(connection, 'mysql'), requireDatabase(database), query),
    closeConnection: closeMySqlConnection,
    closeAll: closeAllMySqlConnections
  },
  sqlserver: {
    definition: { id: 'sqlserver', label: 'SQL Server', description: 'Microsoft SQL Server', mode: 'server', defaultPort: 1433, defaultDatabase: 'master', defaultSsl: false },
    test: (connection) => testSqlServer(server(connection, 'sqlserver')),
    listDatabases: (connection) => listSqlServerDatabases(server(connection, 'sqlserver')),
    getSchema: (connection, database) => getSqlServerSchema(server(connection, 'sqlserver'), requireDatabase(database)),
    execute: (connection, database, query) => executeSqlServerQuery(server(connection, 'sqlserver'), requireDatabase(database), query),
    closeConnection: closeSqlServerConnection,
    closeAll: closeAllSqlServerConnections
  },
  azuresql: {
    definition: { id: 'azuresql', label: 'Azure SQL', description: 'Microsoft Azure SQL Database', mode: 'server', defaultPort: 1433, defaultDatabase: 'master', defaultSsl: true },
    test: (connection) => testSqlServer(server(connection, 'azuresql')),
    listDatabases: (connection) => listSqlServerDatabases(server(connection, 'azuresql')),
    getSchema: (connection, database) => getSqlServerSchema(server(connection, 'azuresql'), requireDatabase(database)),
    execute: (connection, database, query) => executeSqlServerQuery(server(connection, 'azuresql'), requireDatabase(database), query),
    closeConnection: closeSqlServerConnection,
    closeAll: closeAllSqlServerConnections
  },
  sqlite: {
    definition: { id: 'sqlite', label: 'SQLite', description: 'Local SQLite database files', mode: 'file', defaultSsl: false },
    listDatabases: async (connection) => [connection.name],
    getSchema: async (connection) => {
      if (connection.provider !== 'sqlite') throw new Error('Expected a SQLite connection.')
      return getSqliteSchema(connection)
    },
    execute: async (connection, _database, query) => {
      if (connection.provider !== 'sqlite') throw new Error('Expected a SQLite connection.')
      return executeSqliteQuery(connection, query)
    },
    closeConnection: closeSqliteConnection,
    closeAll: closeAllSqliteConnections
  }
} satisfies Record<ProviderId, ProviderAdapter>

export const providers = Object.values(adapters).map((adapter) => adapter.definition)

function adapterFor(connection: StoredConnection): ProviderAdapter {
  return adapters[connection.provider]
}

export async function testProviderConnection(connection: StoredServerConnection): Promise<void> {
  const adapter = adapterFor(connection)
  const test = adapter.test
  if (!test) throw new Error('This provider does not use server connections.')
  try {
    await test(connection)
  } catch (error) {
    await adapter.closeConnection(connection.id).catch(() => undefined)
    throw error
  }
}

export function listProviderDatabases(connection: StoredConnection): Promise<string[]> {
  return adapterFor(connection).listDatabases(connection)
}

export function getProviderSchema(connection: StoredConnection, database?: string): Promise<DatabaseObject[]> {
  return adapterFor(connection).getSchema(connection, database)
}

export function executeProviderQuery(connection: StoredConnection, database: string | undefined, query: string): Promise<QueryResult> {
  return adapterFor(connection).execute(connection, database, query)
}

export function closeProviderConnection(connection: StoredConnection): Promise<void> {
  return adapterFor(connection).closeConnection(connection.id)
}

export async function closeAllProviderConnections(): Promise<void> {
  await Promise.all([...new Set(Object.values(adapters).map((adapter) => adapter.closeAll))].map((closeAll) => closeAll()))
}
