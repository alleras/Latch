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

  const returned = result.resultSets.map((resultSet, index) => {
    const prefix = result.resultSets.length > 1 ? `Results ${index + 1}: ` : ''
    return `${prefix}${resultSet.rowCount} row${resultSet.rowCount === 1 ? '' : 's'} returned`
  })
  const lines = [...returned, ...result.messages, `Completed in ${result.durationMs.toFixed(1)} ms`]
  if (lines.length === 1) lines.unshift('Command completed successfully')
  return {
    kind: 'success',
    title: 'Query completed',
    lines,
    copyText: lines.join('\n')
  }
}
