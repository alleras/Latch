import { safeStorage } from 'electron'
import sql from 'mssql'
import type { DatabaseObject, QueryResult, SchemaConstraint, SchemaDefault, SchemaIndex } from '../../shared/types'
import type { StoredServerConnection } from '../types'
import { pushGrouped, relationKey, rowsAffectedMessage, serializeRows } from './common'
import { DatabaseSessionCache } from './session-cache'
import { sqlServerResultType, sqlServerTypeDeclaration } from './column-types'

type SqlServerConnection = StoredServerConnection & { provider: 'sqlserver' | 'azuresql' }

const sessions = new DatabaseSessionCache<sql.ConnectionPool>((pool) => pool.close())

function config(connection: SqlServerConnection, database = 'master', max = 5): sql.config {
  return {
    server: connection.host,
    port: connection.port,
    user: connection.username,
    password: safeStorage.decryptString(Buffer.from(connection.encryptedPassword, 'base64')),
    database,
    connectionTimeout: 12_000,
    requestTimeout: 30_000,
    pool: {
      max,
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

function createPool(connection: SqlServerConnection, database: string, max = 5): Promise<sql.ConnectionPool> {
  const pool = new sql.ConnectionPool(config(connection, database, max))
  pool.on('error', (error) => console.error(`SQL Server pool error for ${connection.name}/${database}.`, error))
  return pool.connect()
}

function withPool<T>(connection: SqlServerConnection, database: string, task: (pool: sql.ConnectionPool) => Promise<T>, sessionId?: string): Promise<T> {
  const sessionKey = sessionId ? JSON.stringify([database, sessionId]) : database
  return sessions.run(
    connection.id,
    sessionKey,
    () => createPool(connection, database, sessionId ? 1 : 5),
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
    const [tables, columns, constraintParts, indexParts, defaults, routines, triggers] = await Promise.all([
      pool.request().query<{ schemaName: string; name: string; type: 'table' | 'view' }>(`
        SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS name,
          CASE WHEN TABLE_TYPE = 'VIEW' THEN 'view' ELSE 'table' END AS type
        FROM INFORMATION_SCHEMA.TABLES
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `),
      pool.request().query<{ schemaName: string; tableName: string; name: string; type: string; nullable: string; length: number | null; precision: number | null; scale: number | null }>(`
        SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS tableName, COLUMN_NAME AS name,
          DATA_TYPE AS type, IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS length,
          NUMERIC_PRECISION AS [precision],
          CASE WHEN DATA_TYPE IN ('time', 'datetime2', 'datetimeoffset') THEN DATETIME_PRECISION ELSE NUMERIC_SCALE END AS scale
        FROM INFORMATION_SCHEMA.COLUMNS
        ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
      `),
      pool.request().query<{
        schemaName: string
        tableName: string
        name: string
        type: 'primary-key' | 'foreign-key' | 'unique' | 'check'
        columnName: string | null
        ordinalPosition: number
        referencedSchema: string | null
        referencedTable: string | null
        referencedColumn: string | null
        expression: string | null
        onUpdate: string | null
        onDelete: string | null
      }>(`
        SELECT schema_row.name AS schemaName, table_row.name AS tableName, key_constraint.name,
          CASE key_constraint.type WHEN 'PK' THEN 'primary-key' ELSE 'unique' END AS type,
          column_row.name AS columnName, index_column.key_ordinal AS ordinalPosition,
          CAST(NULL AS sysname) AS referencedSchema, CAST(NULL AS sysname) AS referencedTable,
          CAST(NULL AS sysname) AS referencedColumn, CAST(NULL AS nvarchar(max)) AS expression,
          CAST(NULL AS nvarchar(60)) AS onUpdate, CAST(NULL AS nvarchar(60)) AS onDelete
        FROM sys.key_constraints key_constraint
        JOIN sys.tables table_row ON table_row.object_id = key_constraint.parent_object_id
        JOIN sys.schemas schema_row ON schema_row.schema_id = table_row.schema_id
        JOIN sys.index_columns index_column
          ON index_column.object_id = table_row.object_id AND index_column.index_id = key_constraint.unique_index_id AND index_column.key_ordinal > 0
        JOIN sys.columns column_row ON column_row.object_id = table_row.object_id AND column_row.column_id = index_column.column_id

        UNION ALL

        SELECT schema_row.name, table_row.name, foreign_key.name, 'foreign-key', parent_column.name,
          foreign_key_column.constraint_column_id, referenced_schema.name, referenced_table.name,
          referenced_column.name, NULL, foreign_key.update_referential_action_desc, foreign_key.delete_referential_action_desc
        FROM sys.foreign_keys foreign_key
        JOIN sys.foreign_key_columns foreign_key_column ON foreign_key_column.constraint_object_id = foreign_key.object_id
        JOIN sys.tables table_row ON table_row.object_id = foreign_key.parent_object_id
        JOIN sys.schemas schema_row ON schema_row.schema_id = table_row.schema_id
        JOIN sys.columns parent_column ON parent_column.object_id = table_row.object_id AND parent_column.column_id = foreign_key_column.parent_column_id
        JOIN sys.tables referenced_table ON referenced_table.object_id = foreign_key.referenced_object_id
        JOIN sys.schemas referenced_schema ON referenced_schema.schema_id = referenced_table.schema_id
        JOIN sys.columns referenced_column ON referenced_column.object_id = referenced_table.object_id AND referenced_column.column_id = foreign_key_column.referenced_column_id

        UNION ALL

        SELECT schema_row.name, table_row.name, check_constraint.name, 'check', column_row.name,
          0, NULL, NULL, NULL, check_constraint.definition, NULL, NULL
        FROM sys.check_constraints check_constraint
        JOIN sys.tables table_row ON table_row.object_id = check_constraint.parent_object_id
        JOIN sys.schemas schema_row ON schema_row.schema_id = table_row.schema_id
        LEFT JOIN sys.columns column_row ON column_row.object_id = table_row.object_id AND column_row.column_id = check_constraint.parent_column_id

        ORDER BY schemaName, tableName, name, ordinalPosition
      `),
      pool.request().query<{
        schemaName: string
        tableName: string
        name: string
        unique: boolean
        primary: boolean
        type: string
        columnName: string
        ordinalPosition: number
        descending: boolean
        included: boolean
        predicate: string | null
      }>(`
        SELECT schema_row.name AS schemaName, object_row.name AS tableName, index_row.name,
          index_row.is_unique AS [unique], index_row.is_primary_key AS [primary], index_row.type_desc AS type,
          column_row.name AS columnName, index_column.index_column_id AS ordinalPosition,
          index_column.is_descending_key AS descending, index_column.is_included_column AS included,
          index_row.filter_definition AS predicate
        FROM sys.indexes index_row
        JOIN sys.objects object_row ON object_row.object_id = index_row.object_id AND object_row.type IN ('U', 'V')
        JOIN sys.schemas schema_row ON schema_row.schema_id = object_row.schema_id
        JOIN sys.index_columns index_column ON index_column.object_id = index_row.object_id AND index_column.index_id = index_row.index_id
        JOIN sys.columns column_row ON column_row.object_id = object_row.object_id AND column_row.column_id = index_column.column_id
        WHERE index_row.index_id > 0 AND index_row.is_hypothetical = 0
        ORDER BY schema_row.name, object_row.name, index_row.name, index_column.index_column_id
      `),
      pool.request().query<{ schemaName: string; tableName: string; name: string; columnName: string; expression: string }>(`
        SELECT schema_row.name AS schemaName, table_row.name AS tableName, default_constraint.name,
          column_row.name AS columnName, default_constraint.definition AS expression
        FROM sys.default_constraints default_constraint
        JOIN sys.tables table_row ON table_row.object_id = default_constraint.parent_object_id
        JOIN sys.schemas schema_row ON schema_row.schema_id = table_row.schema_id
        JOIN sys.columns column_row ON column_row.object_id = table_row.object_id AND column_row.column_id = default_constraint.parent_column_id
        ORDER BY schema_row.name, table_row.name, column_row.column_id
      `),
      pool.request().query<{ schemaName: string; name: string; type: 'procedure' | 'function' }>(`
        SELECT s.name AS schemaName, o.name,
          CASE WHEN o.type IN ('P', 'PC') THEN 'procedure' ELSE 'function' END AS type
        FROM sys.objects o
        JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE o.type IN ('P', 'PC', 'FN', 'IF', 'TF', 'FS', 'FT')
          AND o.is_ms_shipped = 0
        ORDER BY s.name, o.name
      `),
      pool.request().query<{ schemaName: string | null; name: string; parentName: string | null }>(`
        SELECT
          CASE WHEN t.parent_class = 1 THEN OBJECT_SCHEMA_NAME(t.parent_id) ELSE NULL END AS schemaName,
          t.name,
          CASE WHEN t.parent_class = 1 THEN OBJECT_NAME(t.parent_id) ELSE NULL END AS parentName
        FROM sys.triggers t
        WHERE t.is_ms_shipped = 0
        ORDER BY schemaName, t.name
      `)
    ])

    const columnsByRelation = new Map<string, typeof columns.recordset>()
    for (const column of columns.recordset) pushGrouped(columnsByRelation, relationKey(column.schemaName, column.tableName), column)
    const constraintsByRelation = new Map<string, SchemaConstraint[]>()
    const constraintByIdentity = new Map<string, SchemaConstraint>()
    for (const part of constraintParts.recordset) {
      const relation = relationKey(part.schemaName, part.tableName)
      const identity = relationKey(relation, part.name)
      let constraint = constraintByIdentity.get(identity)
      if (!constraint) {
        constraint = {
          name: part.name,
          type: part.type,
          columns: [],
          referencedSchema: part.referencedSchema ?? undefined,
          referencedTable: part.referencedTable ?? undefined,
          referencedColumns: part.referencedTable ? [] : undefined,
          expression: part.expression ?? undefined,
          onUpdate: part.onUpdate ?? undefined,
          onDelete: part.onDelete ?? undefined
        }
        constraintByIdentity.set(identity, constraint)
        pushGrouped(constraintsByRelation, relation, constraint)
      }
      if (part.columnName) constraint.columns.push(part.columnName)
      if (part.referencedColumn) constraint.referencedColumns?.push(part.referencedColumn)
    }
    const indexesByRelation = new Map<string, SchemaIndex[]>()
    const indexByIdentity = new Map<string, SchemaIndex>()
    for (const part of indexParts.recordset) {
      const relation = relationKey(part.schemaName, part.tableName)
      const identity = relationKey(relation, part.name)
      let index = indexByIdentity.get(identity)
      if (!index) {
        index = { name: part.name, unique: part.unique, primary: part.primary, type: part.type.replaceAll('_', ' '), columns: [], predicate: part.predicate ?? undefined }
        indexByIdentity.set(identity, index)
        pushGrouped(indexesByRelation, relation, index)
      }
      index.columns.push({ name: part.columnName, descending: part.descending, included: part.included })
    }
    const defaultsByRelation = new Map<string, SchemaDefault[]>()
    for (const defaultRow of defaults.recordset) {
      pushGrouped(defaultsByRelation, relationKey(defaultRow.schemaName, defaultRow.tableName), {
        name: defaultRow.name,
        column: defaultRow.columnName,
        expression: defaultRow.expression
      })
    }

    const relations: DatabaseObject[] = tables.recordset.map((table) => ({
      name: table.name,
      schema: table.schemaName,
      type: table.type,
      columns: (columnsByRelation.get(relationKey(table.schemaName, table.name)) ?? []).map((column) => ({
        name: column.name,
        type: sqlServerTypeDeclaration(column),
        nullable: column.nullable === 'YES',
        primaryKey: (constraintsByRelation.get(relationKey(table.schemaName, table.name)) ?? [])
          .some((constraint) => constraint.type === 'primary-key' && constraint.columns.includes(column.name))
      })),
      constraints: constraintsByRelation.get(relationKey(table.schemaName, table.name)) ?? [],
      indexes: indexesByRelation.get(relationKey(table.schemaName, table.name)) ?? [],
      defaults: defaultsByRelation.get(relationKey(table.schemaName, table.name)) ?? []
    }))

    return [
      ...relations,
      ...routines.recordset.map((routine) => ({
        name: routine.name,
        schema: routine.schemaName,
        type: routine.type,
        columns: [],
        constraints: [],
        indexes: [],
        defaults: []
      })),
      ...triggers.recordset.map((trigger) => ({
        name: trigger.name,
        schema: trigger.schemaName ?? undefined,
        type: 'trigger' as const,
        columns: [],
        constraints: [],
        indexes: [],
        defaults: [],
        parentName: trigger.parentName ?? undefined
      }))
    ]
  })
}

interface SqlServerArrayColumn {
  name: string
  type: unknown
  length: number
  precision?: number
  scale?: number
}

interface SqlServerArrayResult {
  recordsets?: unknown[][][]
  columns?: SqlServerArrayColumn[][]
  rowsAffected?: number[]
}

export async function executeSqlServerQuery(connection: SqlServerConnection, database: string, query: string, sessionId: string): Promise<QueryResult> {
  return withPool(connection, database, async (pool) => {
    const startedAt = performance.now()
    const request = pool.request()
    request.multiple = true
    request.arrayRowMode = true
    const response = await request.query(query) as unknown as SqlServerArrayResult
    const durationMs = performance.now() - startedAt
    const affected = (response.rowsAffected ?? []).reduce((total, count) => total + count, 0)
    const resultSets = (response.recordsets ?? []).map((rows, index) => {
      const columns = response.columns?.[index] ?? []
      return {
        columns: columns.map((column) => column.name),
        columnTypes: columns.map(sqlServerResultType),
        rows: serializeRows(rows),
        rowCount: rows.length
      }
    })
    return {
      resultSets,
      durationMs,
      messages: resultSets.length > 0
        ? []
        : [affected > 0 ? rowsAffectedMessage(affected) : 'Command completed successfully']
    }
  }, sessionId)
}

export function closeSqlServerConnection(connectionId: string): Promise<void> {
  return sessions.closeConnection(connectionId)
}

export function closeAllSqlServerConnections(): Promise<void> {
  return sessions.closeAll()
}
