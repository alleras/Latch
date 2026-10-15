import { safeStorage } from 'electron'
import { Pool } from 'pg'
import type { DatabaseObject, QueryResult } from '../../shared/types'
import type { StoredServerConnection } from '../types'
import { serializeRows } from './common'
import { DatabaseSessionCache } from './session-cache'

type PostgresConnection = StoredServerConnection & { provider: 'postgresql' }

const sessions = new DatabaseSessionCache<Pool>((pool) => pool.end())

function createPool(connection: PostgresConnection, database?: string): Pool {
  const pool = new Pool({
    host: connection.host,
    port: connection.port,
    user: connection.username,
    password: safeStorage.decryptString(Buffer.from(connection.encryptedPassword, 'base64')),
    database: database ?? connection.initialDatabase ?? 'postgres',
    connectionTimeoutMillis: 12_000,
    ssl: connection.ssl ? { rejectUnauthorized: !connection.trustServerCertificate } : false,
    max: 5,
    idleTimeoutMillis: 5 * 60 * 1000
  })
  pool.on('error', (error) => console.error(`PostgreSQL pool error for ${connection.name}.`, error))
  return pool
}

function withPool<T>(connection: PostgresConnection, database: string | undefined, task: (pool: Pool) => Promise<T>): Promise<T> {
  const selectedDatabase = database ?? connection.initialDatabase ?? 'postgres'
  return sessions.run(connection.id, selectedDatabase, () => createPool(connection, database), task)
}

export async function testPostgres(connection: PostgresConnection): Promise<void> {
  await withPool(connection, undefined, async (pool) => { await pool.query('SELECT 1 AS connected') })
}

export async function listPostgresDatabases(connection: PostgresConnection): Promise<string[]> {
  return withPool(connection, undefined, async (pool) => {
    const result = await pool.query<{ name: string }>(`
      SELECT datname AS name FROM pg_database
      WHERE datallowconn AND has_database_privilege(datname, 'CONNECT')
      ORDER BY datname
    `)
    return result.rows.map((row: { name: string }) => row.name)
  })
}

export async function getPostgresSchema(connection: PostgresConnection, database: string): Promise<DatabaseObject[]> {
  return withPool(connection, database, async (pool) => {
    const tables = await pool.query<{ schema_name: string; name: string; type: 'BASE TABLE' | 'VIEW' }>(`
      SELECT table_schema AS schema_name, table_name AS name, table_type AS type
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `)
    const columns = await pool.query<{ schema_name: string; table_name: string; name: string; type: string; nullable: string }>(`
      SELECT table_schema AS schema_name, table_name, column_name AS name,
        data_type AS type, is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name, ordinal_position
    `)
    const routines = await pool.query<{ schema_name: string; name: string; type: 'procedure' | 'function' }>(`
      SELECT DISTINCT routine_schema AS schema_name, routine_name AS name,
        CASE WHEN routine_type = 'PROCEDURE' THEN 'procedure' ELSE 'function' END AS type
      FROM information_schema.routines
      WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schema_name, name
    `)
    const triggers = await pool.query<{ schema_name: string; name: string; parent_name: string }>(`
      SELECT DISTINCT event_object_schema AS schema_name, trigger_name AS name,
        event_object_table AS parent_name
      FROM information_schema.triggers
      WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schema_name, name
    `)
    const relations: DatabaseObject[] = tables.rows.map((table: { schema_name: string; name: string; type: 'BASE TABLE' | 'VIEW' }) => ({
      name: table.name,
      schema: table.schema_name,
      type: table.type === 'VIEW' ? 'view' : 'table',
      columns: columns.rows
        .filter((column: { schema_name: string; table_name: string }) => column.schema_name === table.schema_name && column.table_name === table.name)
        .map((column: { name: string; type: string; nullable: string }) => ({ name: column.name, type: column.type.toUpperCase(), nullable: column.nullable === 'YES', primaryKey: false }))
    }))
    return [
      ...relations,
      ...routines.rows.map((routine) => ({
        name: routine.name,
        schema: routine.schema_name,
        type: routine.type,
        columns: []
      })),
      ...triggers.rows.map((trigger) => ({
        name: trigger.name,
        schema: trigger.schema_name,
        type: 'trigger' as const,
        columns: [],
        parentName: trigger.parent_name
      }))
    ]
  })
}

export async function executePostgresQuery(connection: PostgresConnection, database: string, query: string): Promise<QueryResult> {
  return withPool(connection, database, async (pool) => {
    const startedAt = performance.now()
    const result = await pool.query<Record<string, unknown>>(query)
    const durationMs = performance.now() - startedAt
    const rows = serializeRows(result.rows)
    const columns = result.fields.map((field: { name: string }) => field.name)
    const affected = result.rowCount ?? 0
    return {
      columns,
      rows,
      rowCount: columns.length ? rows.length : affected,
      durationMs,
      message: columns.length ? undefined : `${affected} row${affected === 1 ? '' : 's'} affected`
    }
  })
}

export function closePostgresConnection(connectionId: string): Promise<void> {
  return sessions.closeConnection(connectionId)
}

export function closeAllPostgresConnections(): Promise<void> {
  return sessions.closeAll()
}

