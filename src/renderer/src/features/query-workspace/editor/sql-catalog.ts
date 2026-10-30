import type { DatabaseObject } from '../../../../../shared/types'
import type { SqlCompletionContext, SqlSource } from './sql-completion-context'

export type SqlCatalogCandidateKind = 'relation' | 'column' | 'function' | 'procedure'

export interface SqlCatalogCandidate {
  label: string
  insertText: string
  detail: string
  kind: SqlCatalogCandidateKind
  sortText: string
}

interface SqlCatalogRelation {
  object: DatabaseObject
  qualifiedName: string
  columns: SqlCatalogCandidate[]
}

export interface SqlCatalogIndex {
  relations: SqlCatalogRelation[]
  routines: SqlCatalogCandidate[]
  functions: SqlCatalogCandidate[]
  relationCandidates: SqlCatalogCandidate[]
  relationCandidatesBySchema: Map<string, SqlCatalogCandidate[]>
  routinesBySchema: Map<string, SqlCatalogCandidate[]>
  relationsBySchema: Map<string, SqlCatalogRelation[]>
  relationsByName: Map<string, SqlCatalogRelation[]>
  relationsByQualifiedName: Map<string, SqlCatalogRelation>
}

function canonical(identifier: string): string {
  return identifier.toLowerCase()
}

function qualifiedKey(schema: string | undefined, name: string): string {
  return JSON.stringify([canonical(schema ?? ''), canonical(name)])
}

function pushGrouped<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key)
  if (values) values.push(value)
  else map.set(key, [value])
}

export function createSqlCatalogIndex(schema: DatabaseObject[]): SqlCatalogIndex {
  const relations: SqlCatalogRelation[] = []
  const routines: SqlCatalogCandidate[] = []
  const functions: SqlCatalogCandidate[] = []
  const relationCandidates: SqlCatalogCandidate[] = []
  const relationCandidatesBySchema = new Map<string, SqlCatalogCandidate[]>()
  const routinesBySchema = new Map<string, SqlCatalogCandidate[]>()
  const relationsBySchema = new Map<string, SqlCatalogRelation[]>()
  const relationsByName = new Map<string, SqlCatalogRelation[]>()
  const relationsByQualifiedName = new Map<string, SqlCatalogRelation>()

  for (const object of schema) {
    const qualifiedName = object.schema ? `${object.schema}.${object.name}` : object.name
    if (object.type === 'table' || object.type === 'view') {
      const relation: SqlCatalogRelation = {
        object,
        qualifiedName,
        columns: object.columns.map((column) => ({
          label: column.name,
          insertText: column.name,
          detail: `${qualifiedName} · ${column.type}`,
          kind: 'column',
          sortText: `2_${canonical(column.name)}_${canonical(qualifiedName)}`
        }))
      }
      relations.push(relation)
      const qualifiedCandidate = relationCandidate(relation, true)
      relationCandidates.push(qualifiedCandidate)
      pushGrouped(relationCandidatesBySchema, canonical(object.schema ?? ''), relationCandidate(relation, false))
      pushGrouped(relationsBySchema, canonical(object.schema ?? ''), relation)
      pushGrouped(relationsByName, canonical(object.name), relation)
      relationsByQualifiedName.set(qualifiedKey(object.schema, object.name), relation)
    } else if (object.type === 'function' || object.type === 'procedure') {
      const routine: SqlCatalogCandidate = {
        label: qualifiedName,
        insertText: qualifiedName,
        detail: object.type,
        kind: object.type,
        sortText: `3_${canonical(qualifiedName)}`
      }
      routines.push(routine)
      if (object.type === 'function') functions.push(routine)
      const localRoutine = object.schema
        ? { ...routine, label: object.name, insertText: object.name }
        : routine
      pushGrouped(routinesBySchema, canonical(object.schema ?? ''), localRoutine)
    }
  }

  return {
    relations,
    routines,
    functions,
    relationCandidates,
    relationCandidatesBySchema,
    routinesBySchema,
    relationsBySchema,
    relationsByName,
    relationsByQualifiedName
  }
}

function relationCandidate(relation: SqlCatalogRelation, qualified: boolean): SqlCatalogCandidate {
  return {
    label: qualified ? relation.qualifiedName : relation.object.name,
    insertText: qualified ? relation.qualifiedName : relation.object.name,
    detail: relation.object.type,
    kind: 'relation',
    sortText: `1_${canonical(relation.qualifiedName)}`
  }
}

function relationsForSource(catalog: SqlCatalogIndex, source: SqlSource): SqlCatalogRelation[] {
  const name = source.path.at(-1)
  if (!name) return []
  const schema = source.path.length > 1 ? source.path.at(-2) : undefined
  if (schema) {
    const relation = catalog.relationsByQualifiedName.get(qualifiedKey(schema, name))
    return relation ? [relation] : []
  }
  return catalog.relationsByName.get(canonical(name)) ?? []
}

function sourceForQualifier(sources: SqlSource[], qualifier: string): SqlSource | undefined {
  const key = canonical(qualifier)
  return sources.find((source) => canonical(source.alias ?? source.path.at(-1) ?? '') === key)
}

function columnsForSources(catalog: SqlCatalogIndex, sources: SqlSource[]): SqlCatalogCandidate[] {
  const candidates: SqlCatalogCandidate[] = []
  const seenRelations = new Set<SqlCatalogRelation>()
  for (const source of sources) {
    for (const relation of relationsForSource(catalog, source)) {
      if (seenRelations.has(relation)) continue
      seenRelations.add(relation)
      candidates.push(...relation.columns)
    }
  }
  return candidates
}

function qualifiedCandidates(catalog: SqlCatalogIndex, context: Extract<SqlCompletionContext, { kind: 'qualified' }>): SqlCatalogCandidate[] {
  if (context.qualifierPath.length === 1) {
    const qualifier = context.qualifierPath[0]
    const source = sourceForQualifier(context.sources, qualifier)
    if (source) return relationsForSource(catalog, source).flatMap((relation) => relation.columns)

    const unqualifiedRelations = catalog.relationsByName.get(canonical(qualifier)) ?? []
    if (unqualifiedRelations.length > 0) return unqualifiedRelations.flatMap((relation) => relation.columns)

    const schemaRelations = catalog.relationsBySchema.get(canonical(qualifier))
    const schemaRoutines = routinesForSchema(catalog, context.qualifierPath)
    if (schemaRelations || schemaRoutines.length > 0) {
      return [
        ...(catalog.relationCandidatesBySchema.get(canonical(qualifier)) ?? []),
        ...schemaRoutines
      ]
    }
    return []
  }

  const name = context.qualifierPath.at(-1) ?? ''
  const schema = context.qualifierPath.at(-2)
  return catalog.relationsByQualifiedName.get(qualifiedKey(schema, name))?.columns ?? []
}

function routinesForSchema(catalog: SqlCatalogIndex, schemaPath?: string[]): SqlCatalogCandidate[] {
  const schema = schemaPath?.at(-1)
  if (!schema) return catalog.routines
  return catalog.routinesBySchema.get(canonical(schema)) ?? []
}

export function sqlCatalogCandidates(catalog: SqlCatalogIndex, context: SqlCompletionContext): SqlCatalogCandidate[] {
  switch (context.kind) {
    case 'none':
      return []
    case 'relations': {
      const schema = context.schemaPath?.at(-1)
      if (!schema) return catalog.relationCandidates
      return catalog.relationCandidatesBySchema.get(canonical(schema)) ?? []
    }
    case 'qualified':
      return qualifiedCandidates(catalog, context)
    case 'expressions':
      return [...columnsForSources(catalog, context.sources), ...catalog.functions]
    case 'routines':
      return routinesForSchema(catalog, context.schemaPath)
    case 'general':
      return [...catalog.relationCandidates, ...catalog.functions]
  }
}
