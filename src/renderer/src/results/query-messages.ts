import type { QueryResult } from '../../../shared/types'

export interface QueryMessageSummary {
  kind: 'idle' | 'success' | 'error'
  title: string
  lines: string[]
  copyText: string
}

export function queryMessageSummary(result: QueryResult | null, error: string | null): QueryMessageSummary {
  if (error) {
    return {
      kind: 'error',
      title: 'Query failed',
      lines: [error],
      copyText: error
    }
  }

  if (!result) {
    return {
      kind: 'idle',
      title: 'No messages',
      lines: ['Run a query to see execution messages.'],
      copyText: ''
    }
  }

  const rowSummary = result.message
    ?? `${result.rowCount} row${result.rowCount === 1 ? '' : 's'} returned`
  const lines = [rowSummary, `Completed in ${result.durationMs.toFixed(1)} ms`]
  return {
    kind: 'success',
    title: 'Query completed',
    lines,
    copyText: lines.join('\n')
  }
}
