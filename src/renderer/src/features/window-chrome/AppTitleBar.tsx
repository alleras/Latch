import { memo, useEffect } from 'react'
import { Box, Stack, Typography, useTheme } from '@mui/material'
import { LatchMark } from '../../components/LatchMark'
import { ApplicationMenuBar } from './ApplicationMenuBar'

export const AppTitleBar = memo(function AppTitleBar({ connectionName }: { connectionName?: string }) {
  const theme = useTheme()
  const isWindows = window.latch.platform === 'win32'
  const isMac = window.latch.platform === 'darwin'

  useEffect(() => {
    if (!isWindows) return
    const background = getComputedStyle(document.documentElement).getPropertyValue('--latch-shell').trim()
    void window.latch.setTitleBarColors(background, theme.palette.text.primary).catch(console.error)
  }, [isWindows, theme.palette.mode, theme.palette.text.primary])

  return (
    <Box component="header" className={isWindows ? 'latch-titlebar latch-titlebar-windows' : 'latch-titlebar'} sx={{ gridColumn: '1 / -1', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'var(--latch-shell)', WebkitAppRegion: 'drag', userSelect: 'none' }}>
      <Stack className="latch-titlebar-content" direction="row" sx={{ height: '100%', minWidth: 0, alignItems: 'center', px: 1.25, pl: isMac ? 9.5 : 1.25, gap: 1 }}>
        <LatchMark size={20} />
        {isWindows ? <ApplicationMenuBar /> : <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: '.15em' }}>LATCH</Typography>}
        {!isWindows && <Box sx={{ height: 16, mx: 0.25, borderLeft: '1px solid', borderColor: 'divider' }} />}
        <Typography noWrap variant="caption" color="text.secondary" sx={{ minWidth: 0, flex: 1, textAlign: isWindows ? 'center' : 'left', px: 1 }}>
          {connectionName ?? 'SQL workspace'}{isWindows ? ' — Latch' : ''}
        </Typography>
      </Stack>
    </Box>
  )
})
