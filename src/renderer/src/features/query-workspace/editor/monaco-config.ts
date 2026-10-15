import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import 'monaco-editor/esm/vs/basic-languages/mysql/mysql.contribution'
import 'monaco-editor/esm/vs/basic-languages/pgsql/pgsql.contribution'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import type { DatabaseObject, ProviderId } from '../../../../../shared/types'

const monacoGlobal = self as typeof self & {
  MonacoEnvironment?: { getWorker: (_moduleId: string, _label: string) => Worker }
}

monacoGlobal.MonacoEnvironment = { getWorker: () => new EditorWorker() }

const languageByProvider: Record<ProviderId, string> = {
  sqlite: 'sql',
  postgresql: 'pgsql',
  mysql: 'mysql',
  sqlserver: 'sql',
  azuresql: 'sql'
}

export function sqlLanguageForProvider(provider: ProviderId): string {
  return languageByProvider[provider]
}

export function defineLatchThemes(): void {
  monaco.editor.defineTheme('latch-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '666d77', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c9f55f' },
      { token: 'keyword.sql', foreground: 'c9f55f' },
      { token: 'number', foreground: '80b8ff' },
      { token: 'string', foreground: '8ddd8a' },
      { token: 'operator', foreground: 'b8bec7' },
      { token: 'delimiter', foreground: '8f959e' }
    ],
    colors: {
      'editor.background': '#0f1216',
      'editor.foreground': '#e8ebe5',
      'editorCursor.foreground': '#c9f55f',
      'editor.lineHighlightBackground': '#15191e',
      'editorLineNumber.foreground': '#464c55',
      'editorLineNumber.activeForeground': '#8f959e',
      'editor.selectionBackground': '#c9f55f30',
      'editor.inactiveSelectionBackground': '#c9f55f18',
      'editorIndentGuide.background1': '#242830',
      'editorIndentGuide.activeBackground1': '#3b424c',
      'editorWidget.background': '#15191e',
      'editorWidget.border': '#30353e',
      'editorSuggestWidget.background': '#15191e',
      'editorSuggestWidget.border': '#30353e',
      'editorSuggestWidget.selectedBackground': '#252b32',
      'editorHoverWidget.background': '#15191e',
      'editorHoverWidget.border': '#30353e',
      'focusBorder': '#c9f55f55',
      'scrollbarSlider.background': '#343a4380',
      'scrollbarSlider.hoverBackground': '#464d5880'
    }
  })
  monaco.editor.defineTheme('latch-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7a838f', fontStyle: 'italic' },
      { token: 'keyword', foreground: '527500', fontStyle: 'bold' },
      { token: 'keyword.sql', foreground: '527500', fontStyle: 'bold' },
      { token: 'number', foreground: '2468a8' },
      { token: 'string', foreground: '287a3f' },
      { token: 'operator', foreground: '4c5663' },
      { token: 'delimiter', foreground: '697380' }
    ],
    colors: {
      'editor.background': '#fbfcfd',
      'editor.foreground': '#17202a',
      'editorCursor.foreground': '#527500',
      'editor.lineHighlightBackground': '#f2f4f6',
      'editorLineNumber.foreground': '#a1a9b3',
      'editorLineNumber.activeForeground': '#596370',
      'editor.selectionBackground': '#789f2430',
      'editor.inactiveSelectionBackground': '#789f2418',
      'editorIndentGuide.background1': '#dfe3e8',
      'editorIndentGuide.activeBackground1': '#b8c0ca',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#d2d8df',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#d2d8df',
      'editorSuggestWidget.selectedBackground': '#edf2e3',
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.border': '#d2d8df',
      'focusBorder': '#5f840866',
      'scrollbarSlider.background': '#aeb6c080',
      'scrollbarSlider.hoverBackground': '#8e98a580'
    }
  })
}

export function registerSqlCompletionProviders(getSchema: () => DatabaseObject[]): monaco.IDisposable[] {
  return ['sql', 'mysql', 'pgsql'].map((languageId) => (
    monaco.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters: ['.'],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        }
        const suggestions: monaco.languages.CompletionItem[] = []

        for (const table of getSchema().filter((item) => item.type === 'table' || item.type === 'view')) {
          const qualifiedName = table.schema ? `${table.schema}.${table.name}` : table.name
          suggestions.push({
            label: qualifiedName,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: table.type,
            insertText: qualifiedName,
            range,
            sortText: `1_${qualifiedName}`
          })
          for (const column of table.columns) {
            suggestions.push({
              label: column.name,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `${qualifiedName} · ${column.type}`,
              insertText: column.name,
              range,
              sortText: `2_${column.name}_${qualifiedName}`
            })
          }
        }

        return { suggestions }
      }
    })
  ))
}

export { monaco }
