const relationCues = new Set(['from', 'join', 'update', 'into', 'using', 'table'])
const routineCues = new Set(['call', 'exec', 'execute'])
const fromClauseEnd = new Set([
  'where', 'group', 'order', 'having', 'limit', 'offset', 'fetch', 'returning', 'set',
  'values', 'union', 'intersect', 'except', 'qualify', 'window'
])
const reservedAliasWords = new Set([
  ...relationCues,
  ...routineCues,
  ...fromClauseEnd,
  'as', 'by', 'cross', 'delete', 'full', 'inner', 'insert', 'left', 'lateral', 'merge',
  'natural', 'on', 'outer', 'right', 'select', 'straight_join', 'truncate', 'with'
])

interface SqlToken {
  value: string
  normalized: string
  kind: 'identifier' | 'number' | 'symbol' | 'string' | 'comment'
  start: number
  end: number
  depth: number
  closed: boolean
  quoted?: boolean
}

export interface SqlSource {
  /** Identifier path as written, for example `["public", "customers"]`. */
  path: string[]
  alias?: string
}

export type SqlCompletionContext =
  | { kind: 'none' }
  | { kind: 'relations'; schemaPath?: string[] }
  | { kind: 'qualified'; qualifierPath: string[]; sources: SqlSource[] }
  | { kind: 'expressions'; sources: SqlSource[] }
  | { kind: 'routines'; schemaPath?: string[] }
  | { kind: 'general'; sources: SqlSource[] }

function isIdentifierStart(character: string): boolean {
  return /[A-Za-z_@$#]/.test(character) || character.charCodeAt(0) >= 0x80
}

function isIdentifierPart(character: string): boolean {
  return /[A-Za-z0-9_@$#]/.test(character) || character.charCodeAt(0) >= 0x80
}

function quotedToken(sql: string, start: number, closing: string, depth: number): SqlToken {
  let index = start + 1
  let value = ''
  let closed = false
  while (index < sql.length) {
    if (sql[index] === closing) {
      if (sql[index + 1] === closing) {
        value += closing
        index += 2
        continue
      }
      index += 1
      closed = true
      break
    }
    value += sql[index]
    index += 1
  }
  return { value, normalized: value.toLowerCase(), kind: 'identifier', start, end: index, depth, closed, quoted: true }
}

/**
 * Tokenizes only the statement containing the caret. Earlier statement tokens are discarded and
 * scanning stops at the next separator. This parser intentionally accepts incomplete SQL.
 */
function statementTokens(sql: string, caret: number): { tokens: SqlToken[]; caretDepth: number } {
  let tokens: SqlToken[] = []
  let depth = 0
  let caretDepth = 0
  let passedCaret = false

  for (let index = 0; index < sql.length;) {
    if (!passedCaret && index >= caret) {
      passedCaret = true
      caretDepth = depth
    }
    const start = index
    const character = sql[index]

    if (/\s/.test(character)) {
      index += 1
      continue
    }

    if (character === '-' && sql[index + 1] === '-') {
      index += 2
      while (index < sql.length && sql[index] !== '\n') index += 1
      tokens.push({ value: sql.slice(start, index), normalized: '', kind: 'comment', start, end: index, depth, closed: index < sql.length })
      continue
    }

    if (character === '/' && sql[index + 1] === '*') {
      index += 2
      let nesting = 1
      while (index < sql.length && nesting > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          nesting += 1
          index += 2
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          nesting -= 1
          index += 2
        } else {
          index += 1
        }
      }
      tokens.push({ value: sql.slice(start, index), normalized: '', kind: 'comment', start, end: index, depth, closed: nesting === 0 })
      continue
    }

    if (character === "'") {
      index += 1
      let closed = false
      while (index < sql.length) {
        if (sql[index] === "'") {
          if (sql[index + 1] === "'") {
            index += 2
            continue
          }
          index += 1
          closed = true
          break
        }
        if (sql[index] === '\\' && index + 1 < sql.length) index += 2
        else index += 1
      }
      tokens.push({ value: sql.slice(start, index), normalized: '', kind: 'string', start, end: index, depth, closed })
      continue
    }

    if (character === '$') {
      const delimiter = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/)?.[0]
      if (delimiter) {
        index += delimiter.length
        const closing = sql.indexOf(delimiter, index)
        const closed = closing >= 0
        index = closed ? closing + delimiter.length : sql.length
        tokens.push({ value: sql.slice(start, index), normalized: '', kind: 'string', start, end: index, depth, closed })
        continue
      }
    }

    if (character === '"' || character === '`' || character === '[') {
      const closing = character === '[' ? ']' : character
      const token = quotedToken(sql, start, closing, depth)
      index = token.end
      tokens.push(token)
      continue
    }

    if (isIdentifierStart(character)) {
      index += 1
      while (index < sql.length && isIdentifierPart(sql[index])) index += 1
      const value = sql.slice(start, index)
      tokens.push({ value, normalized: value.toLowerCase(), kind: 'identifier', start, end: index, depth, closed: true })
      continue
    }

    if (/[0-9]/.test(character)) {
      index += 1
      while (index < sql.length && /[0-9A-Fa-f_xX.]/.test(sql[index])) index += 1
      const value = sql.slice(start, index)
      tokens.push({ value, normalized: value.toLowerCase(), kind: 'number', start, end: index, depth, closed: true })
      continue
    }

    if (character === ';') {
      index += 1
      if (start < caret) {
        tokens = []
        depth = 0
        caretDepth = 0
        continue
      }
      break
    }

    if (character === '(') {
      tokens.push({ value: character, normalized: character, kind: 'symbol', start, end: start + 1, depth, closed: true })
      depth += 1
      index += 1
      continue
    }

    if (character === ')') {
      depth = Math.max(0, depth - 1)
      tokens.push({ value: character, normalized: character, kind: 'symbol', start, end: start + 1, depth, closed: true })
      index += 1
      continue
    }

    tokens.push({ value: character, normalized: character, kind: 'symbol', start, end: start + 1, depth, closed: true })
    index += 1
  }

  if (!passedCaret) caretDepth = depth
  return { tokens, caretDepth }
}

function queryScopeDepth(tokensBeforeCaret: SqlToken[], caretDepth: number): number {
  let scopeDepth = 0
  for (const token of tokensBeforeCaret) {
    if (token.kind !== 'identifier' || token.depth > caretDepth) continue
    if (['select', 'update', 'insert', 'delete', 'merge'].includes(token.normalized)) scopeDepth = token.depth
  }
  return scopeDepth
}

function tokenAtDepth(tokens: SqlToken[], index: number, depth: number): SqlToken | undefined {
  const token = tokens[index]
  return token?.depth === depth ? token : undefined
}

function parseSource(tokens: SqlToken[], start: number, depth: number): { source?: SqlSource; end: number } {
  let index = start
  while (tokenAtDepth(tokens, index, depth)?.normalized === 'lateral') index += 1
  const first = tokenAtDepth(tokens, index, depth)
  if (!first || first.kind !== 'identifier') return { end: index }

  const path = [first.value]
  index += 1
  while (
    tokenAtDepth(tokens, index, depth)?.value === '.'
    && tokenAtDepth(tokens, index + 1, depth)?.kind === 'identifier'
  ) {
    path.push(tokens[index + 1].value)
    index += 2
  }

  let alias: string | undefined
  if (tokenAtDepth(tokens, index, depth)?.normalized === 'as') index += 1
  const aliasToken = tokenAtDepth(tokens, index, depth)
  if (aliasToken?.kind === 'identifier' && !reservedAliasWords.has(aliasToken.normalized)) {
    alias = aliasToken.value
    index += 1
  }
  return { source: { path, alias }, end: index }
}

function sourcesInScope(tokens: SqlToken[], depth: number): SqlSource[] {
  const sources: SqlSource[] = []
  const identities = new Set<string>()
  let inFromList = false

  const addSource = (source: SqlSource | undefined): void => {
    if (!source) return
    const identity = JSON.stringify([source.path.map((part) => part.toLowerCase()), source.alias?.toLowerCase()])
    if (identities.has(identity)) return
    identities.add(identity)
    sources.push(source)
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokenAtDepth(tokens, index, depth)
    if (!token) continue
    if (fromClauseEnd.has(token.normalized)) inFromList = false

    if (relationCues.has(token.normalized) && token.normalized !== 'table') {
      const parsed = parseSource(tokens, index + 1, depth)
      addSource(parsed.source)
      inFromList = token.normalized === 'from'
      index = Math.max(index, parsed.end - 1)
      continue
    }

    if (inFromList && token.value === ',') {
      const parsed = parseSource(tokens, index + 1, depth)
      addSource(parsed.source)
      index = Math.max(index, parsed.end - 1)
    }
  }
  return sources
}

function qualifierBeforeCaret(tokens: SqlToken[]): { path: string[]; startIndex: number } | undefined {
  if (tokens.at(-1)?.value !== '.') return undefined
  const path: string[] = []
  let index = tokens.length - 2
  const lastIdentifier = tokens[index]
  if (lastIdentifier?.kind !== 'identifier') return undefined
  path.unshift(lastIdentifier.value)
  index -= 1
  while (tokens[index]?.value === '.' && tokens[index - 1]?.kind === 'identifier') {
    path.unshift(tokens[index - 1].value)
    index -= 2
  }
  return { path, startIndex: index + 1 }
}

function isFromListPosition(tokens: SqlToken[], depth: number): boolean {
  let inFromList = false
  for (const token of tokens) {
    if (token.depth !== depth) continue
    if (token.normalized === 'from') inFromList = true
    else if (token.normalized === 'join') inFromList = false
    else if (fromClauseEnd.has(token.normalized)) inFromList = false
  }
  return inFromList && tokens.at(-1)?.value === ','
}

export function analyzeSqlCompletion(sql: string, caret: number): SqlCompletionContext {
  const boundedCaret = Math.max(0, Math.min(caret, sql.length))
  const { tokens, caretDepth } = statementTokens(sql, boundedCaret)
  const containing = tokens.find((token) => token.start < boundedCaret && boundedCaret <= token.end)
  if (containing && (containing.kind === 'string' || containing.kind === 'comment') && (boundedCaret < containing.end || !containing.closed)) {
    return { kind: 'none' }
  }
  // Monaco's default word range does not include identifier quotes, so replacing a partial quoted
  // name would append the completion outside the quotes. Wait until the user leaves that token.
  if (containing?.quoted) return { kind: 'none' }
  if (containing?.kind === 'identifier' && !containing.closed) return { kind: 'none' }

  const currentIdentifier = containing?.kind === 'identifier' ? containing : undefined
  const tokensBeforeCaret = tokens.filter((token) => token.end <= boundedCaret && token.kind !== 'comment' && token.kind !== 'string' && token !== currentIdentifier)
  const scopeDepth = queryScopeDepth(tokensBeforeCaret, caretDepth)
  const statementSyntax = tokens.filter((token) => token.kind !== 'comment' && token.kind !== 'string' && token !== currentIdentifier)
  const sources = sourcesInScope(statementSyntax, scopeDepth)
  const qualifier = qualifierBeforeCaret(tokensBeforeCaret)

  if (qualifier) {
    const previous = tokensBeforeCaret[qualifier.startIndex - 1]
    if (previous && previous.depth === scopeDepth && relationCues.has(previous.normalized)) {
      return { kind: 'relations', schemaPath: qualifier.path }
    }
    if (previous?.normalized === 'call' || previous?.normalized === 'exec' || previous?.normalized === 'execute') {
      return { kind: 'routines', schemaPath: qualifier.path }
    }
    return { kind: 'qualified', qualifierPath: qualifier.path, sources }
  }

  const previous = tokensBeforeCaret.at(-1)
  if (previous && relationCues.has(previous.normalized)) return { kind: 'relations' }
  if (previous && routineCues.has(previous.normalized)) return { kind: 'routines' }
  if (isFromListPosition(tokensBeforeCaret, scopeDepth)) return { kind: 'relations' }
  if (sources.length > 0) return { kind: 'expressions', sources }
  return { kind: 'general', sources }
}
