import { useDeferredValue, useEffect, useRef, useState, type RefObject } from 'react'
import CloseRounded from '@mui/icons-material/CloseRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import { IconButton, InputAdornment, TextField, Tooltip } from '@mui/material'
import { componentSizes } from '../theme'

/** Route Find to the hovered panel, or the focused panel when neither is hovered. */
export function usePanelFilter() {
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [needle, setNeedle] = useState('')

  const toggle = (): void => {
    if (open) {
      setNeedle('')
      panelRef.current?.focus({ preventScroll: true })
    }
    setOpen(!open)
  }

  useEffect(() => {
    if (open) inputRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      const panel = panelRef.current
      const hovered = document.querySelector('[data-filter-panel-hovered="true"]')
      const focused = document.activeElement?.closest('[data-filter-panel]')
      const find = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f'
      const escape = event.key === 'Escape' && open && panel?.contains(event.target as Node)
      if (!panel || (!escape && (!find || (hovered ?? focused) !== panel))) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (open) {
        setNeedle('')
        panel.focus({ preventScroll: true })
      }
      setOpen(!open)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  return {
    open, needle, setNeedle, toggle, inputRef,
    panelProps: {
      ref: panelRef,
      tabIndex: -1,
      'data-filter-panel': true,
      onPointerEnter: () => panelRef.current?.setAttribute('data-filter-panel-hovered', 'true'),
      onPointerLeave: () => panelRef.current?.removeAttribute('data-filter-panel-hovered')
    }
  }
}

export function PanelFilterToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <Tooltip title={`${open ? 'Hide' : 'Show'} ${label.toLowerCase()} filter (Cmd/Ctrl+F)`}>
      <IconButton size="small" aria-label={`Toggle ${label.toLowerCase()} filter`} aria-expanded={open} onClick={onToggle} color={open ? 'primary' : 'default'}>
        {open ? <CloseRounded sx={{ fontSize: componentSizes.sidebarPanel.icon }} /> : <SearchRounded sx={{ fontSize: componentSizes.sidebarPanel.icon }} />}
      </IconButton>
    </Tooltip>
  )
}

export function PanelFilterField({ label, inputRef, onFilterChange }: {
  label: string
  inputRef: RefObject<HTMLInputElement | null>
  onFilterChange: (value: string) => void
}) {
  const [value, setValue] = useState('')
  const deferredValue = useDeferredValue(value)
  useEffect(() => { onFilterChange(deferredValue.trim().toLocaleLowerCase()) }, [deferredValue, onFilterChange])
  return (
    <TextField
      autoFocus
      inputRef={inputRef}
      placeholder={label}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      slotProps={{
        htmlInput: { 'aria-label': label },
        input: { startAdornment: <InputAdornment position="start"><SearchRounded sx={{ fontSize: componentSizes.sidebarPanel.icon }} /></InputAdornment> }
      }}
      sx={{ mx: 0.75, mb: 0.5, flexShrink: 0, '& .MuiInputBase-root': { height: componentSizes.sidebarPanel.filterHeight } }}
    />
  )
}
