/**
 * Splits a SQLite script without breaking quoted values, comments, or trigger bodies. SQLite's
 * synchronous prepare API accepts one statement at a time, unlike the server drivers' batch APIs.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let hasCode = false
  let quote: "'" | '"' | '`' | ']' | null = null
  let lineComment = false
  let blockCommentDepth = 0
  let triggerBodyDepth = 0
  let isTrigger = false
  const leadingWords: string[] = []

  const reset = (): void => {
    current = ''
    hasCode = false
    triggerBodyDepth = 0
    isTrigger = false
    leadingWords.length = 0
  }

  const finish = (): void => {
    if (hasCode) statements.push(current.trim())
    reset()
  }

  for (let index = 0; index < sql.length;) {
    const character = sql[index]
    const next = sql[index + 1]

    if (lineComment) {
      current += character
      index += 1
      if (character === '\n') lineComment = false
      continue
    }

    if (blockCommentDepth > 0) {
      if (character === '/' && next === '*') {
        current += '/*'
        blockCommentDepth += 1
        index += 2
      } else if (character === '*' && next === '/') {
        current += '*/'
        blockCommentDepth -= 1
        index += 2
      } else {
        current += character
        index += 1
      }
      continue
    }

    if (quote) {
      current += character
      index += 1
      if (character !== quote) continue
      if (sql[index] === quote) {
        current += sql[index]
        index += 1
      } else {
        quote = null
      }
      continue
    }

    if (character === '-' && next === '-') {
      current += '--'
      lineComment = true
      index += 2
      continue
    }
    if (character === '/' && next === '*') {
      current += '/*'
      blockCommentDepth = 1
      index += 2
      continue
    }
    if (character === "'" || character === '"' || character === '`' || character === '[') {
      current += character
      quote = character === '[' ? ']' : character
      hasCode = true
      index += 1
      continue
    }

    if (/[A-Za-z_]/.test(character)) {
      let end = index + 1
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end])) end += 1
      const word = sql.slice(index, end)
      const normalized = word.toLowerCase()
      current += word
      hasCode = true
      if (leadingWords.length < 3) {
        leadingWords.push(normalized)
        isTrigger = leadingWords[0] === 'create'
          && (leadingWords[1] === 'trigger' || (['temp', 'temporary'].includes(leadingWords[1]) && leadingWords[2] === 'trigger'))
      }
      if (isTrigger && (normalized === 'begin' || normalized === 'case')) triggerBodyDepth += 1
      else if (isTrigger && normalized === 'end') triggerBodyDepth = Math.max(0, triggerBodyDepth - 1)
      index = end
      continue
    }

    current += character
    index += 1
    if (character === ';' && (!isTrigger || triggerBodyDepth === 0)) {
      finish()
    } else if (!/\s/.test(character)) {
      hasCode = true
    }
  }

  finish()
  return statements
}

export function isTransactionControlStatement(sql: string): boolean {
  const withoutLeadingComments = sql
    .replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/u, '')
  return /^(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(withoutLeadingComments)
}
