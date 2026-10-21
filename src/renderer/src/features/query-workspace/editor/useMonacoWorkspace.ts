import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { DatabaseObject } from '../../../../../shared/types'
import { defineLatchThemes, monaco, registerSqlCompletionProviders } from './monaco-config'

interface UseMonacoWorkspaceOptions {
  hostRef: RefObject<HTMLDivElement | null>
  tabId: string
  openTabIds: string[]
  initialQuery: string
  language: string
  theme: string
  ariaLabel: string
  /** True while the active tab's text is loading; anything typed then would be replaced when it arrives. */
  readOnly: boolean
  schema: DatabaseObject[]
  /** `unsaved` is true when the model differs from the text last marked saved. O(1) via version ids. */
  onQueryChange: (tabId: string, query: string, unsaved: boolean) => void
  onRun: () => void
}

interface MonacoModelEntry {
  model: monaco.editor.ITextModel
  subscription: monaco.IDisposable
}

export function useMonacoWorkspace({
  hostRef,
  tabId,
  openTabIds,
  initialQuery,
  language,
  theme,
  ariaLabel,
  readOnly,
  schema,
  onQueryChange,
  onRun
}: UseMonacoWorkspaceOptions) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const activeModelRef = useRef<monaco.editor.ITextModel | null>(null)
  const activeTabIdRef = useRef(tabId)
  const modelsRef = useRef(new Map<string, MonacoModelEntry>())
  const viewStatesRef = useRef(new Map<string, monaco.editor.ICodeEditorViewState>())
  /** Alternative version id of each model at its last open or save; the unsaved baseline. */
  const savedVersionIdsRef = useRef(new Map<string, number>())
  const replacingRef = useRef(false)
  const onRunRef = useRef(onRun)
  const onQueryChangeRef = useRef(onQueryChange)
  const schemaRef = useRef(schema)

  onRunRef.current = onRun
  onQueryChangeRef.current = onQueryChange
  schemaRef.current = schema

  useLayoutEffect(() => {
    if (!hostRef.current) return
    defineLatchThemes()
    const editor = monaco.editor.create(hostRef.current, {
      model: null,
      theme,
      ariaLabel,
      automaticLayout: true,
      fontFamily: '"DM Mono", monospace',
      fontSize: 14,
      lineHeight: 22,
      fontLigatures: false,
      minimap: { enabled: false },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      padding: { top: 12, bottom: 20 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      renderLineHighlight: 'all',
      renderWhitespace: 'selection',
      guides: { indentation: false },
      stickyScroll: { enabled: false },
      bracketPairColorization: { enabled: true },
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'off',
      quickSuggestions: false,
      suggestOnTriggerCharacters: true,
      suggest: { showKeywords: true, showFields: true, showClasses: true },
      scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 }
    })
    editorRef.current = editor
    editor.addAction({
      id: 'latch.run-query',
      label: 'Run query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => onRunRef.current()
    })
    const completionProviders = registerSqlCompletionProviders(() => schemaRef.current)

    return () => {
      completionProviders.forEach((registration) => registration.dispose())
      editor.dispose()
      for (const entry of modelsRef.current.values()) {
        entry.subscription.dispose()
        entry.model.dispose()
      }
      modelsRef.current.clear()
      viewStatesRef.current.clear()
      savedVersionIdsRef.current.clear()
      editorRef.current = null
      activeModelRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const previousTabId = activeTabIdRef.current
    if (activeModelRef.current && previousTabId !== tabId) {
      const viewState = editor.saveViewState()
      if (viewState) viewStatesRef.current.set(previousTabId, viewState)
    }

    let entry = modelsRef.current.get(tabId)
    if (!entry) {
      const uri = monaco.Uri.parse(`inmemory://latch/query/${encodeURIComponent(tabId)}.sql`)
      const model = monaco.editor.createModel(initialQuery, language, uri)
      savedVersionIdsRef.current.set(tabId, model.getAlternativeVersionId())
      const subscription = model.onDidChangeContent(() => {
        if (replacingRef.current) return
        const unsaved = model.getAlternativeVersionId() !== savedVersionIdsRef.current.get(tabId)
        onQueryChangeRef.current(tabId, model.getValue(), unsaved)
      })
      entry = { model, subscription }
      modelsRef.current.set(tabId, entry)
    } else if (entry.model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(entry.model, language)
    }

    activeTabIdRef.current = tabId
    activeModelRef.current = entry.model
    // The view state is restored only on a tab switch. This effect also reruns when the draft changes,
    // and restoring then would move the cursor back to where it was when the tab was last left.
    if (editor.getModel() !== entry.model) {
      editor.setModel(entry.model)
      const viewState = viewStatesRef.current.get(tabId)
      if (viewState) editor.restoreViewState(viewState)
    }
    editor.updateOptions({ ariaLabel })
  }, [ariaLabel, initialQuery, language, tabId])

  // A layout effect, so a loading tab is never editable for a frame after it becomes active.
  useLayoutEffect(() => {
    editorRef.current?.updateOptions({ readOnly, readOnlyMessage: { value: 'This file cannot be edited until its text has loaded.' } })
  }, [readOnly])

  useEffect(() => {
    const openIds = new Set(openTabIds)
    for (const [id, entry] of modelsRef.current) {
      if (openIds.has(id)) continue
      entry.subscription.dispose()
      entry.model.dispose()
      modelsRef.current.delete(id)
      viewStatesRef.current.delete(id)
      savedVersionIdsRef.current.delete(id)
    }
  }, [openTabIds])

  useEffect(() => monaco.editor.setTheme(theme), [theme])

  const focus = useCallback((): void => editorRef.current?.focus(), [])
  const getQuery = useCallback((): string => activeModelRef.current?.getValue() ?? initialQuery, [initialQuery])
  const getSelectedQuery = useCallback((): string => {
    const editor = editorRef.current
    const model = activeModelRef.current
    const selection = editor?.getSelection()
    return model && selection ? model.getValueInRange(selection) : ''
  }, [])

  /** The model's current alternative version id, or null for a tab without a model yet. */
  const getVersionId = useCallback((targetTabId: string): number | null => {
    return modelsRef.current.get(targetTabId)?.model.getAlternativeVersionId() ?? null
  }, [])

  /**
   * Makes a version of the model the unsaved baseline: the given one (captured when a save started,
   * so keystrokes typed during the write stay unsaved) or the current one. No-op without a model.
   */
  const markSaved = useCallback((targetTabId: string, versionId?: number): void => {
    const entry = modelsRef.current.get(targetTabId)
    if (entry) savedVersionIdsRef.current.set(targetTabId, versionId ?? entry.model.getAlternativeVersionId())
  }, [])

  /**
   * Replaces a model's text without reporting a change, then marks it saved.
   * A tab without a model is left alone; its model is created later from the draft.
   */
  const replaceQuery = useCallback((targetTabId: string, query: string): void => {
    const entry = modelsRef.current.get(targetTabId)
    if (!entry) return
    replacingRef.current = true
    try {
      entry.model.setValue(query)
    } finally {
      replacingRef.current = false
    }
    savedVersionIdsRef.current.set(targetTabId, entry.model.getAlternativeVersionId())
  }, [])

  return { focus, getQuery, getSelectedQuery, getVersionId, markSaved, replaceQuery }
}
