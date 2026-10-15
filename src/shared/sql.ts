const BLOCK_COMMENTS = /\/\*[\s\S]*?\*\//g
const LINE_COMMENTS = /--[^\r\n]*/g
const SCHEMA_STATEMENT = /^\s*(?:CREATE|ALTER|DROP|RENAME)\b/i

export function mayChangeSchema(sql: string): boolean {
  const withoutComments = sql.replace(BLOCK_COMMENTS, ' ').replace(LINE_COMMENTS, ' ')
  return withoutComments.split(';').some((statement) => SCHEMA_STATEMENT.test(statement))
}
