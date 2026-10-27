import { memo, useDeferredValue, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import CheckRounded from '@mui/icons-material/CheckRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import { Box, Button, InputAdornment, Menu, MenuItem, TextField, Typography } from '@mui/material'
import type { Connection } from '../../../shared/types'
import { ProviderIcon, providerColor } from './ProviderIcon'

const ROW_HEIGHT = 36
const LIST_HEIGHT = 288
const OVERSCAN = 3

interface DatabasePickerProps {
  connection: Connection
  database?: string
  databases: string[]
  onDatabaseChange: (database: string) => void
}

export const DatabasePicker = memo(function DatabasePicker({ connection, database, databases, onDatabaseChange }: DatabasePickerProps) {
  const id = useId()
  const listId = `${id}-options`
  const color = providerColor[connection.provider]
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [filter, setFilter] = useState('')
  const deferredFilter = useDeferredValue(filter)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [scrollTop, setScrollTop] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const indexedDatabases = useMemo(() => databases.map((name) => ({ name, search: name.toLocaleLowerCase() })), [databases])
  const options = useMemo(() => {
    const needle = deferredFilter.trim().toLocaleLowerCase()
    return needle ? indexedDatabases.filter((item) => item.search.includes(needle)) : indexedDatabases
  }, [deferredFilter, indexedDatabases])
  // Reset navigation with the collection so an index never points to a different
  // option after filtering or refreshing the database list.
  const [previousOptions, setPreviousOptions] = useState(options)
  if (previousOptions !== options) {
    setPreviousOptions(options)
    setActiveIndex(-1)
    setScrollTop(0)
  }
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [options])

  const close = (): void => {
    setAnchor(null)
    setFilter('')
    setActiveIndex(-1)
    setScrollTop(0)
  }
  const select = (name: string): void => {
    onDatabaseChange(name)
    close()
  }
  const onSearchKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === 'Tab') return
    // Keep MenuList typeahead and focus movement out of the search input.
    event.stopPropagation()
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (options.length === 0 || filter !== deferredFilter) return
      const next = event.key === 'ArrowDown'
        ? (activeIndex + 1) % options.length
        : (activeIndex <= 0 ? options.length : activeIndex) - 1
      setActiveIndex(next)
      const list = listRef.current
      if (list) {
        const top = next * ROW_HEIGHT
        if (top < list.scrollTop) list.scrollTop = top
        else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW_HEIGHT - list.clientHeight
        setScrollTop(list.scrollTop)
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (filter === deferredFilter && options[activeIndex]) select(options[activeIndex].name)
    }
  }

  const start = Math.max(0, Math.min(Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN, options.length - 1))
  const end = Math.min(options.length, start + LIST_HEIGHT / ROW_HEIGHT + OVERSCAN * 2)

  return (
    <>
      <Button
        aria-controls={anchor ? listId : undefined}
        aria-expanded={Boolean(anchor)}
        aria-haspopup="listbox"
        onClick={(event) => setAnchor(event.currentTarget)}
        size="small"
        variant="outlined"
        startIcon={<ProviderIcon provider={connection.provider} />}
        endIcon={<ExpandMoreRounded />}
        sx={{
          height: 27, maxWidth: 360, px: 1, color, borderColor: `${color}40`, borderRadius: 999,
          bgcolor: `${color}08`, fontWeight: 500, textTransform: 'none',
          '& .MuiButton-startIcon': { color }, '& .MuiButton-endIcon': { ml: 0.5 },
          '&:hover': { borderColor: `${color}70`, bgcolor: `${color}12` }
        }}
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {connection.name}{database ? ` / ${database}` : ''}
        </Box>
      </Button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        autoFocus={false}
        disableAutoFocusItem
        slotProps={{
          paper: { sx: { width: 340, maxWidth: 'calc(100vw - 32px)', mt: 0.5 } },
          list: { role: 'presentation', sx: { pt: 0, pb: 0.5 } },
          transition: {
            onEntering: () => filterRef.current?.focus(),
            onEntered: () => filterRef.current?.focus()
          }
        }}
      >
        <Box sx={{ p: 0.75, mb: 0.25, borderBottom: '1px solid', borderColor: 'divider' }}>
          <TextField
            autoFocus
            inputRef={filterRef}
            fullWidth
            size="small"
            placeholder={`Filter ${databases.length} databases`}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value)
              setActiveIndex(-1)
              setScrollTop(0)
              if (listRef.current) listRef.current.scrollTop = 0
            }}
            onKeyDown={onSearchKeyDown}
            slotProps={{
              htmlInput: {
                role: 'combobox', 'aria-label': 'Filter databases', 'aria-autocomplete': 'list',
                'aria-controls': listId, 'aria-expanded': Boolean(anchor),
                'aria-activedescendant': activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
              },
              input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }
            }}
          />
        </Box>
        <Box
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Databases"
          aria-busy={filter !== deferredFilter}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          sx={{ maxHeight: LIST_HEIGHT, overflowY: 'auto' }}
        >
          <Box role="presentation" sx={{ height: options.length * ROW_HEIGHT, position: 'relative' }}>
            {options.slice(start, end).map(({ name }, offset) => {
              const index = start + offset
              return (
                <MenuItem
                  key={name}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-setsize={options.length}
                  aria-posinset={index + 1}
                  tabIndex={-1}
                  selected={activeIndex === -1 ? name === database : index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(name)}
                  sx={{ position: 'absolute', top: index * ROW_HEIGHT, width: '100%', height: ROW_HEIGHT, minHeight: ROW_HEIGHT, py: 0.5, px: 1.5, gap: 1, fontSize: 14 }}
                >
                  <Box component="span" title={name} sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</Box>
                  {name === database && <CheckRounded color="primary" sx={{ fontSize: 16 }} />}
                </MenuItem>
              )
            })}
          </Box>
          {options.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 2, textAlign: 'center' }}>
              No matching databases
            </Typography>
          )}
        </Box>
      </Menu>
    </>
  )
})
