import type { CliAccess, DatabaseObject, DatabaseObjectType } from '../../shared/types'
import type { StoredConnection } from '../types'
import { UsageError } from './arguments'
import type { CommandName } from './spec'

/** The command line refused an action because of the user's access settings in Latch. */
export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccessDeniedError'
  }
}

export function cliAccess(connection: StoredConnection): CliAccess {
  return connection.cliAccess ?? 'off'
}

export const ENABLE_HINT = 'Enable it in Latch > Settings > Command line.'
export const NO_CONNECTIONS_HINT = 'Enable connections in Latch > Settings > Command line.'

/** Finds a connection by id, then exact name, then case-insensitive name; only enabled connections are usable. */
export function resolveConnection(connections: StoredConnection[], reference: string, command: CommandName): StoredConnection {
  const matches = (candidates: StoredConnection[]): StoredConnection[] => {
    const byId = candidates.filter((connection) => connection.id === reference)
    if (byId.length > 0) return byId
    const exact = candidates.filter((connection) => connection.name === reference)
    if (exact.length > 0) return exact
    const folded = reference.toLocaleLowerCase()
    return candidates.filter((connection) => connection.name.toLocaleLowerCase() === folded)
  }

  const enabled = connections.filter((connection) => cliAccess(connection) !== 'off')
  const found = matches(enabled)
  if (found.length === 1) return found[0]
  if (found.length > 1) {
    throw new UsageError(`More than one connection is named "${reference}". Use its id instead: ${found.map((connection) => connection.id).join(', ')}.`, command)
  }
  if (matches(connections).length > 0) {
    throw new AccessDeniedError(`Connection "${reference}" is not enabled for command line access. ${ENABLE_HINT}`)
  }
  const names = enabled.map((connection) => `"${connection.name}"`)
  throw new UsageError(
    names.length > 0
      ? `No enabled connection is named "${reference}". Available: ${names.join(', ')}. Run "latch connections" for details.`
      : `No connections are enabled for command line access. ${NO_CONNECTIONS_HINT}`,
    command
  )
}

export function connectionTarget(connection: StoredConnection): string {
  return connection.provider === 'sqlite' ? connection.path : `${connection.host}:${connection.port}`
}

/** Splits `schema.name`, honoring "double", [bracket], and `backtick` quoting around either part. */
export function parseObjectReference(reference: string): { schema?: string; name: string } {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  for (let index = 0; index < reference.length; index += 1) {
    const character = reference[index]
    if (quote) {
      if (character === quote) {
        if (quote !== ']' && reference[index + 1] === quote) {
          current += character
          index += 1
        } else if (quote === ']' && reference[index + 1] === ']') {
          current += ']'
          index += 1
        } else {
          quote = null
        }
      } else {
        current += character
      }
      continue
    }
    if (character === '"' || character === '`') quote = character
    else if (character === '[') quote = ']'
    else if (character === '.') {
      parts.push(current)
      current = ''
    } else current += character
  }
  parts.push(current)
  const trimmed = parts.map((part) => part.trim())
  if (trimmed.some((part) => part.length === 0) || trimmed.length > 2) {
    throw new UsageError(`"${reference}" is not an object name. Use name or schema.name.`, 'describe')
  }
  return trimmed.length === 2 ? { schema: trimmed[0], name: trimmed[1] } : { name: trimmed[0] }
}

export function qualifiedName(object: Pick<DatabaseObject, 'schema' | 'name'>): string {
  return object.schema ? `${object.schema}.${object.name}` : object.name
}

export function findObject(objects: DatabaseObject[], reference: string): DatabaseObject {
  const { schema, name } = parseObjectReference(reference)
  const select = (equal: (left: string, right: string) => boolean): DatabaseObject[] => {
    const matches = objects.filter((object) => equal(object.name, name) && (schema === undefined || equal(object.schema ?? '', schema)))
    // A table and a trigger may share a name; the table is what callers mean.
    const relations = matches.filter((object) => object.type !== 'trigger')
    return relations.length > 0 ? relations : matches
  }
  let found = select((left, right) => left === right)
  if (found.length === 0) found = select((left, right) => left.toLocaleLowerCase() === right.toLocaleLowerCase())
  if (found.length === 1) return found[0]
  if (found.length > 1) {
    const labels = found.map((object) => `${qualifiedName(object)} (${object.type})`).sort()
    throw new UsageError(`"${reference}" matches more than one object: ${labels.join(', ')}. Qualify it with a schema.`, 'describe')
  }
  const folded = name.toLocaleLowerCase()
  const similar = objects
    .filter((object) => object.name.toLocaleLowerCase().includes(folded) || folded.includes(object.name.toLocaleLowerCase()))
    .slice(0, 5)
    .map(qualifiedName)
  throw new UsageError(
    `No object named "${reference}".${similar.length > 0 ? ` Similar: ${similar.join(', ')}.` : ''} Run "latch objects <connection> --filter <text>" to search.`,
    'describe'
  )
}

export interface ObjectFilter {
  schema?: string
  types: DatabaseObjectType[]
  filter?: string
}

export function filterObjects(objects: DatabaseObject[], { schema, types, filter }: ObjectFilter): DatabaseObject[] {
  const schemaNeedle = schema?.toLocaleLowerCase()
  const needle = filter?.toLocaleLowerCase()
  const typeSet = new Set(types)
  return objects
    .filter((object) => (
      (typeSet.size === 0 || typeSet.has(object.type))
      && (schemaNeedle === undefined || (object.schema ?? '').toLocaleLowerCase() === schemaNeedle)
      && (needle === undefined || qualifiedName(object).toLocaleLowerCase().includes(needle))
    ))
    .sort((left, right) => (
      (left.schema ?? '').localeCompare(right.schema ?? '')
      || left.name.localeCompare(right.name)
      || left.type.localeCompare(right.type)
    ))
}
