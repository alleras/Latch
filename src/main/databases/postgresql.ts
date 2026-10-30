import { safeStorage } from 'electron'
import { Pool } from 'pg'
import type { QueryArrayResult } from 'pg'
import type { DatabaseObject, QueryResult, SchemaConstraint, SchemaDefault, SchemaIndex } from '../../shared/types'
import type { StoredServerConnection } from '../types'
import { pushGrouped, relationKey, rowsAffectedMessage, serializeRows } from './common'
import { DatabaseSessionCache } from './session-cache'

type PostgresConnection = StoredServerConnection & { provider: 'postgresql' }

const sessions = new DatabaseSessionCache<Pool>((pool) => pool.end())

function createPool(connection: PostgresConnection, database?: string, max = 5): Pool {
  const pool = new Pool({
    host: connection.host,
    port: connection.port,
    user: connection.username,
    password: safeStorage.decryptString(Buffer.from(connection.encryptedPassword, 'base64')),
    database: database ?? connection.initialDatabase ?? 'postgres',
    connectionTimeoutMillis: 12_000,
    ssl: connection.ssl ? { rejectUnauthorized: !connection.trustServerCertificate } : false,
    max,
    idleTimeoutMillis: 5 * 60 * 1000
  })
  pool.on('error', (error) => console.error(`PostgreSQL pool error for ${connection.name}.`, error))
  return pool
}

function withPool<T>(connection: PostgresConnection, database: string | undefined, task: (pool: Pool) => Promise<T>, sessionId?: string): Promise<T> {
  const selectedDatabase = database ?? connection.initialDatabase ?? 'postgres'
  const sessionKey = sessionId ? JSON.stringify([selectedDatabase, sessionId]) : selectedDatabase
  return sessions.run(connection.id, sessionKey, () => createPool(connection, database, sessionId ? 1 : 5), task)
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
    const [tables, columns, constraints, indexes, routines, triggers] = await Promise.all([
      pool.query<{ schema_name: string; name: string; type: 'BASE TABLE' | 'VIEW' }>(`
        SELECT table_schema AS schema_name, table_name AS name, table_type AS type
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
      `),
      pool.query<{ schema_name: string; table_name: string; name: string; type: string; nullable: string; default_value: string | null }>(`
        SELECT c.table_schema AS schema_name, c.table_name, c.column_name AS name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
          c.is_nullable AS nullable, c.column_default AS default_value
        FROM information_schema.columns c
        JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
        JOIN pg_catalog.pg_class r ON r.relnamespace = n.oid AND r.relname = c.table_name
        JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid AND a.attname = c.column_name
        WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
      `),
      pool.query<{
        schema_name: string
        table_name: string
        name: string
        type: 'primary-key' | 'foreign-key' | 'unique' | 'check' | 'exclusion'
        columns: string[]
        referenced_schema: string | null
        referenced_table: string | null
        referenced_columns: string[]
        expression: string | null
        on_update: string | null
        on_delete: string | null
      }>(`
        SELECT ns.nspname AS schema_name, relation.relname AS table_name, constraint_row.conname AS name,
          CASE constraint_row.contype
            WHEN 'p' THEN 'primary-key'
            WHEN 'f' THEN 'foreign-key'
            WHEN 'u' THEN 'unique'
            WHEN 'c' THEN 'check'
            ELSE 'exclusion'
          END AS type,
          ARRAY(
            SELECT attribute.attname
            FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, position)
            JOIN pg_attribute attribute ON attribute.attrelid = constraint_row.conrelid AND attribute.attnum = key_column.attnum
            ORDER BY key_column.position
          ) AS columns,
          referenced_ns.nspname AS referenced_schema,
          referenced_relation.relname AS referenced_table,
          ARRAY(
            SELECT attribute.attname
            FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, position)
            JOIN pg_attribute attribute ON attribute.attrelid = constraint_row.confrelid AND attribute.attnum = key_column.attnum
            ORDER BY key_column.position
          ) AS referenced_columns,
          CASE WHEN constraint_row.contype IN ('c', 'x') THEN pg_get_constraintdef(constraint_row.oid, true) END AS expression,
          CASE constraint_row.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_update,
          CASE constraint_row.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
        FROM pg_constraint constraint_row
        JOIN pg_class relation ON relation.oid = constraint_row.conrelid
        JOIN pg_namespace ns ON ns.oid = relation.relnamespace
        LEFT JOIN pg_class referenced_relation ON referenced_relation.oid = constraint_row.confrelid
        LEFT JOIN pg_namespace referenced_ns ON referenced_ns.oid = referenced_relation.relnamespace
        WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
          AND constraint_row.contype IN ('p', 'f', 'u', 'c', 'x')
        ORDER BY ns.nspname, relation.relname, constraint_row.conname
      `),
      pool.query<{
        schema_name: string
        table_name: string
        name: string
        is_unique: boolean
        is_primary: boolean
        type: string
        position: number
        column_name: string | null
        expression: string
        descending: boolean
        included: boolean
        predicate: string | null
      }>(`
        SELECT ns.nspname AS schema_name, relation.relname AS table_name, index_relation.relname AS name,
          index_row.indisunique AS is_unique, index_row.indisprimary AS is_primary, access_method.amname AS type,
          index_column.position, attribute.attname AS column_name,
          pg_get_indexdef(index_row.indexrelid, index_column.position, true) AS expression,
          CASE WHEN index_column.position <= index_row.indnkeyatts THEN (index_row.indoption[index_column.position - 1] & 1) = 1 ELSE false END AS descending,
          index_column.position > index_row.indnkeyatts AS included,
          pg_get_expr(index_row.indpred, index_row.indrelid) AS predicate
        FROM pg_index index_row
        JOIN pg_class relation ON relation.oid = index_row.indrelid
        JOIN pg_namespace ns ON ns.oid = relation.relnamespace
        JOIN pg_class index_relation ON index_relation.oid = index_row.indexrelid
        JOIN pg_am access_method ON access_method.oid = index_relation.relam
        CROSS JOIN LATERAL generate_series(1, index_row.indnatts) AS index_column(position)
        LEFT JOIN pg_attribute attribute
          ON attribute.attrelid = relation.oid AND attribute.attnum = index_row.indkey[index_column.position - 1]
        WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY ns.nspname, relation.relname, index_relation.relname, index_column.position
      `),
      pool.query<{ schema_name: string; name: string; type: 'procedure' | 'function' }>(`
        SELECT DISTINCT routine_schema AS schema_name, routine_name AS name,
          CASE WHEN routine_type = 'PROCEDURE' THEN 'procedure' ELSE 'function' END AS type
        FROM information_schema.routines
        WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY schema_name, name
      `),
      pool.query<{ schema_name: string; name: string; parent_name: string }>(`
        SELECT DISTINCT event_object_schema AS schema_name, trigger_name AS name,
          event_object_table AS parent_name
        FROM information_schema.triggers
        WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY schema_name, name
      `)
    ])

    const columnsByRelation = new Map<string, typeof columns.rows>()
    for (const column of columns.rows) pushGrouped(columnsByRelation, relationKey(column.schema_name, column.table_name), column)
    const constraintsByRelation = new Map<string, SchemaConstraint[]>()
    for (const constraint of constraints.rows) {
      pushGrouped(constraintsByRelation, relationKey(constraint.schema_name, constraint.table_name), {
        name: constraint.name,
        type: constraint.type,
        columns: constraint.columns,
        referencedSchema: constraint.referenced_schema ?? undefined,
        referencedTable: constraint.referenced_table ?? undefined,
        referencedColumns: constraint.referenced_columns.length > 0 ? constraint.referenced_columns : undefined,
        expression: constraint.expression ?? undefined,
        onUpdate: constraint.on_update ?? undefined,
        onDelete: constraint.on_delete ?? undefined
      })
    }
    const indexesByRelation = new Map<string, SchemaIndex[]>()
    const indexByIdentity = new Map<string, SchemaIndex>()
    for (const index of indexes.rows) {
      const key = relationKey(index.schema_name, index.table_name)
      const identity = relationKey(key, index.name)
      let schemaIndex = indexByIdentity.get(identity)
      if (!schemaIndex) {
        schemaIndex = { name: index.name, unique: index.is_unique, primary: index.is_primary, type: index.type.toUpperCase(), columns: [], predicate: index.predicate ?? undefined }
        indexByIdentity.set(identity, schemaIndex)
        pushGrouped(indexesByRelation, key, schemaIndex)
      }
      schemaIndex.columns.push({
        name: index.column_name ?? undefined,
        expression: index.column_name ? undefined : index.expression,
        descending: index.descending,
        included: index.included
      })
    }
    const relations: DatabaseObject[] = tables.rows.map((table: { schema_name: string; name: string; type: 'BASE TABLE' | 'VIEW' }) => ({
      name: table.name,
      schema: table.schema_name,
      type: table.type === 'VIEW' ? 'view' : 'table',
      columns: (columnsByRelation.get(relationKey(table.schema_name, table.name)) ?? []).map((column) => ({
        name: column.name,
        type: column.type,
        nullable: column.nullable === 'YES',
        primaryKey: (constraintsByRelation.get(relationKey(table.schema_name, table.name)) ?? [])
          .some((constraint) => constraint.type === 'primary-key' && constraint.columns.includes(column.name))
      })),
      constraints: constraintsByRelation.get(relationKey(table.schema_name, table.name)) ?? [],
      indexes: indexesByRelation.get(relationKey(table.schema_name, table.name)) ?? [],
      defaults: (columnsByRelation.get(relationKey(table.schema_name, table.name)) ?? []).flatMap<SchemaDefault>((column) => (
        column.default_value === null ? [] : [{ column: column.name, expression: column.default_value }]
      ))
    }))
    return [
      ...relations,
      ...routines.rows.map((routine) => ({
        name: routine.name,
        schema: routine.schema_name,
        type: routine.type,
        columns: [],
        constraints: [],
        indexes: [],
        defaults: []
      })),
      ...triggers.rows.map((trigger) => ({
        name: trigger.name,
        schema: trigger.schema_name,
        type: 'trigger' as const,
        columns: [],
        constraints: [],
        indexes: [],
        defaults: [],
        parentName: trigger.parent_name
      }))
    ]
  })
}

export async function executePostgresQuery(connection: PostgresConnection, database: string, query: string, sessionId: string): Promise<QueryResult> {
  return withPool(connection, database, async (pool) => {
    const startedAt = performance.now()
    const response = await pool.query({ text: query, rowMode: 'array' }) as unknown as QueryArrayResult<unknown[]> | QueryArrayResult<unknown[]>[]
    const durationMs = performance.now() - startedAt
    const results = Array.isArray(response) ? response : [response]
    const fields = results.flatMap((result) => result.fields)
    // Resolve all result types in one round trip, including casts and expressions.
    // Metadata enrichment must never turn an already executed write into a query failure.
    const columnTypes = fields.length === 0 ? [] : await pool.query<{ type: string }>(`
      SELECT pg_catalog.format_type(field.type_oid, field.modifier) AS type
      FROM unnest($1::oid[], $2::int[]) WITH ORDINALITY AS field(type_oid, modifier, position)
      ORDER BY field.position
    `, [fields.map((field) => field.dataTypeID), fields.map((field) => field.dataTypeModifier)])
      .then((metadata) => metadata.rows.map((row) => row.type))
      .catch(() => fields.map(() => null))
    let typeOffset = 0
    const resultSets = results.flatMap((result) => {
      const types = columnTypes.slice(typeOffset, typeOffset + result.fields.length)
      typeOffset += result.fields.length
      if (result.fields.length === 0) return []
      return [{
        columns: result.fields.map((field) => field.name),
        columnTypes: types,
        rows: serializeRows(result.rows),
        rowCount: result.rows.length
      }]
    })
    const messages = results.flatMap((result) => {
      if (result.fields.length > 0) return []
      const affected = result.rowCount ?? 0
      return affected === 0 && ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(result.command)
        ? [`${result.command} completed`]
        : [rowsAffectedMessage(affected)]
    })
    return {
      resultSets,
      durationMs,
      messages
    }
  }, sessionId)
}

export function closePostgresConnection(connectionId: string): Promise<void> {
  return sessions.closeConnection(connectionId)
}

export function closeAllPostgresConnections(): Promise<void> {
  return sessions.closeAll()
}
