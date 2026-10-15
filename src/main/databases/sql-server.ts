import { safeStorage } from 'electron'
import sql from 'mssql'
import type { DatabaseObject, QueryResult } from '../../shared/types'
import type { StoredServerConnection } from '../types'
import { serializeRows } from './common'
import { DatabaseSessionCache } from './session-cache'

type SqlServerConnection = StoredServerConnection & { provider: 'sqlserver' | 'azuresql' }

const sessions = new DatabaseSessionCache<sql.ConnectionPool>((pool) => pool.close())

function config(connection: SqlServerConnection, database = 'master'): sql.config {
  return {
    server: connection.host,
    port: connection.port,
    user: connection.username,
    password: safeStorage.decryptString(Buffer.from(connection.encryptedPassword, 'base64')),
    database,
    connectionTimeout: 12_000,
    requestTimeout: 30_000,
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 5 * 60 * 1000
    },
    options: {
      encrypt: connection.ssl,
      trustServerCertificate: connection.trustServerCertificate,
      enableArithAbort: true
    }
  }
}

function createPool(connection: SqlServerConnection, database: string): Promise<sql.ConnectionPool> {
  const pool = new sql.ConnectionPool(config(connection, database))
  pool.on('error', (error) => console.error(`SQL Server pool error for ${connection.name}/${database}.`, error))
  return pool.connect()
}

function withPool<T>(connection: SqlServerConnection, database: string, task: (pool: sql.ConnectionPool) => Promise<T>): Promise<T> {
  return sessions.run(
    connection.id,
    database,
    () => createPool(connection, database),
    task
  )
}

export async function testSqlServer(connection: SqlServerConnection): Promise<void> {
  await withPool(connection, connection.initialDatabase ?? 'master', async (pool) => { await pool.request().query('SELECT 1 AS connected') })
}

export async function listSqlServerDatabases(connection: SqlServerConnection): Promise<string[]> {
  return withPool(connection, connection.initialDatabase ?? 'master', async (pool) => {
    const result = await pool.request().query<{ name: string }>(`
      SELECT name FROM sys.databases
      WHERE state = 0
      ORDER BY name
    `)
    return result.recordset.map((row) => row.name)
  })
}

export async function getSqlServerSchema(connection: SqlServerConnection, database: string): Promise<DatabaseObject[]> {
  return withPool(connection, database, async (pool) => {
    const tables = await pool.request().query<{ schemaName: string; name: string; type: 'table' | 'view' }>(`
      SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS name,
        CASE WHEN TABLE_TYPE = 'VIEW' THEN 'view' ELSE 'table' END AS type
      FROM INFORMATION_SCHEMA.TABLES
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `)
    const columns = await pool.request().query<{ schemaName: string; tableName: string; name: string; type: string; nullable: string }>(`
      SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS tableName, COLUMN_NAME AS name,
        DATA_TYPE AS type, IS_NULLABLE AS nullable
      FROM INFORMATION_SCHEMA.COLUMNS
      ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
    `)

    const routines = await pool.request().query<{ schemaName: string; name: string; type: 'procedure' | 'function' }>(`
      SELECT s.name AS schemaName, o.name,
        CASE WHEN o.type IN ('P', 'PC') THEN 'procedure' ELSE 'function' END AS type
      FROM sys.objects o
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      WHERE o.type IN ('P', 'PC', 'FN', 'IF', 'TF', 'FS', 'FT')
        AND o.is_ms_shipped = 0
      ORDER BY s.name, o.name
    `)

    const triggers = await pool.request().query<{ schemaName: string | null; name: string; parentName: string | null }>(`
      SELECT
        CASE WHEN t.parent_class = 1 THEN OBJECT_SCHEMA_NAME(t.parent_id) ELSE NULL END AS schemaName,
        t.name,
        CASE WHEN t.parent_class = 1 THEN OBJECT_NAME(t.parent_id) ELSE NULL END AS parentName
      FROM sys.triggers t
      WHERE t.is_ms_shipped = 0
      ORDER BY schemaName, t.name
    `)

    const relations: DatabaseObject[] = tables.recordset.map((table) => ({
      name: table.name,
      schema: table.schemaName,
      type: table.type,
      columns: columns.recordset
        .filter((column) => column.schemaName === table.schemaName && column.tableName === table.name)
        .map((column) => ({ name: column.name, type: column.type.toUpperCase(), nullable: column.nullable === 'YES', primaryKey: false }))
    }))

    return [
      ...relations,
      ...routines.recordset.map((routine) => ({
        name: routine.name,
        schema: routine.schemaName,
        type: routine.type,
        columns: []
      })),
      ...triggers.recordset.map((trigger) => ({
        name: trigger.name,
        schema: trigger.schemaName ?? undefined,
        type: 'trigger' as const,
        columns: [],
        parentName: trigger.parentName ?? undefined
      }))
    ]
  })
}

export async function executeSqlServerQuery(connection: SqlServerConnection, database: string, query: string): Promise<QueryResult> {
  return withPool(connection, database, async (pool) => {
    const startedAt = performance.now()
    const response = await pool.request().query(query)
    const durationMs = performance.now() - startedAt
    const rows = serializeRows((response.recordset ?? []) as Record<string, unknown>[])
    const columns = response.recordset ? Object.keys(response.recordset.columns) : []
    const affected = response.rowsAffected.reduce((total, count) => total + count, 0)
    return {
      columns,
      rows,
      rowCount: rows.length || affected,
      durationMs,
      message: columns.length ? undefined : `${affected} row${affected === 1 ? '' : 's'} affected`
    }
  })
}

export function closeSqlServerConnection(connectionId: string): Promise<void> {
  return sessions.closeConnection(connectionId)
}

export function closeAllSqlServerConnections(): Promise<void> {
  return sessions.closeAll()
}

