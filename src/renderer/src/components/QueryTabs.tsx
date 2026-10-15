import { memo, useState, type MouseEvent } from 'react'
import AddRounded from '@mui/icons-material/AddRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { Box, Divider, IconButton, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material'
import type { Connection } from '../../../shared/types'
import type { CloseTabScope, QueryTabState } from '../query-tabs'

interface QueryTabsProps {
  tabs: QueryTabState[]
  connections: Connection[]
  activeTabId: string | null
  onSelect: (tabId: string) => void
  onClose: (tabId: string, scope?: CloseTabScope) => void
  onAdd: () => void
}

export const QueryTabs = memo(function QueryTabs({ tabs, connections, activeTabId, onSelect, onClose, onAdd }: QueryTabsProps) {
  const [contextMenu, setContextMenu] = useState<{ tabId: string; mouseX: number; mouseY: number } | null>(null)

  const tabLabel = (tab: QueryTabState): string => {
    const connection = connections.find((item) => item.id === tab.connectionId)
    const context = connection
      ? `${connection.name}${tab.database ? ` / ${tab.database}` : ''}`
      : 'Missing connection'
    return `${tab.title} — ${context}`
  }

  const openContextMenu = (event: MouseEvent<HTMLElement>, tabId: string): void => {
    event.preventDefault()
    setContextMenu({ tabId, mouseX: event.clientX + 2, mouseY: event.clientY - 6 })
  }

  const closeFromMenu = (scope: CloseTabScope): void => {
    if (!contextMenu) return
    onClose(contextMenu.tabId, scope)
    setContextMenu(null)
  }

  const contextIndex = contextMenu ? tabs.findIndex((tab) => tab.id === contextMenu.tabId) : -1

  return (
    <Stack direction="row" sx={{ height: 38, flex: '0 0 auto', alignItems: 'stretch', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'var(--latch-tabs)', overflow: 'hidden' }}>
      <Stack direction="row" sx={{ minWidth: 0, flex: 1, overflowX: 'auto', overflowY: 'hidden' }}>
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          const label = tabLabel(tab)
          return (
            <Stack
              component="button"
              type="button"
              direction="row"
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              onContextMenu={(event) => openContextMenu(event, tab.id)}
              title={label}
              sx={{
                width: 240,
                minWidth: 170,
                maxWidth: 320,
                alignItems: 'center',
                gap: 0.75,
                px: 1.25,
                border: 0,
                borderRight: '1px solid',
                borderColor: 'divider',
                borderRadius: 0,
                color: active ? 'text.primary' : 'text.secondary',
                bgcolor: active ? 'var(--latch-active-tab)' : 'transparent',
                boxShadow: active ? 'inset 0 2px var(--latch-accent)' : 'none',
                cursor: 'default',
                font: 'inherit',
                '&:hover': { bgcolor: active ? 'var(--latch-active-tab)' : 'var(--latch-grid-hover)' },
                '& .close-tab': { opacity: active ? 0.75 : 0 },
                '&:hover .close-tab': { opacity: 0.75 }
              }}
            >
              <Box sx={{ width: 6, height: 6, flex: '0 0 auto', borderRadius: '50%', border: '1px solid', borderColor: tab.error ? 'error.main' : tab.running ? 'warning.main' : 'primary.main' }} />
              <Typography variant="caption" noWrap sx={{ flex: 1, textAlign: 'left', fontWeight: active ? 600 : 500 }}>{label}</Typography>
              <IconButton
                className="close-tab"
                component="span"
                size="small"
                aria-label={`Close ${label}`}
                onClick={(event) => { event.stopPropagation(); onClose(tab.id) }}
                sx={{ width: 20, height: 20 }}
              >
                <CloseRounded sx={{ fontSize: 13 }} />
              </IconButton>
            </Stack>
          )
        })}
      </Stack>
      <Tooltip title="New query"><IconButton size="small" onClick={onAdd} sx={{ ml: 0.5, flex: '0 0 auto' }}><AddRounded sx={{ fontSize: 16 }} /></IconButton></Tooltip>
      <Menu
        open={Boolean(contextMenu)}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
        slotProps={{ list: { dense: true }, paper: { sx: { minWidth: 190 } } }}
      >
        <MenuItem onClick={() => closeFromMenu('tab')}>Close<Box sx={{ flex: 1 }} /><Typography variant="caption" color="text.disabled">⌘W</Typography></MenuItem>
        <MenuItem disabled={tabs.length <= 1} onClick={() => closeFromMenu('others')}>Close others</MenuItem>
        <MenuItem disabled={contextIndex < 0 || contextIndex === tabs.length - 1} onClick={() => closeFromMenu('right')}>Close tabs to the right</MenuItem>
        <Divider />
        <MenuItem onClick={() => closeFromMenu('all')}>Close all</MenuItem>
      </Menu>
    </Stack>
  )
})
