import { memo, useDeferredValue, useMemo, useState } from 'react'
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded'
import TerminalRounded from '@mui/icons-material/TerminalRounded'
import {
  Alert,
  Box,
  Button,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import type { CliAccess, Connection } from '../../../shared/types'
import { useCliInstall } from '../features/command-line/useCliInstall'
import { ProviderIcon, providerColor } from './ProviderIcon'

const ACCESS_LABELS: Record<CliAccess, string> = {
  off: 'Off',
  'read-only': 'Read-only',
  'read-write': 'Read & write'
}

/** Rows rendered at once; larger lists ask for a filter instead of rendering every connection. */
const VISIBLE_LIMIT = 100
const FILTER_THRESHOLD = 8

interface CommandLineSettingsProps {
  open: boolean
  connections: Connection[]
  access: ReadonlyMap<string, CliAccess>
  onAccessChange: (connectionId: string, access: CliAccess) => void
}

function connectionTarget(connection: Connection): string {
  return connection.provider === 'sqlite' ? connection.path : `${connection.host}:${connection.port}`
}

const ConnectionAccessRow = memo(function ConnectionAccessRow({ connection, access, onAccessChange }: {
  connection: Connection
  access: CliAccess
  onAccessChange: (connectionId: string, access: CliAccess) => void
}) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, px: 1, py: 0.5, minHeight: 40 }}>
      <ProviderIcon provider={connection.provider} sx={{ fontSize: 16, color: providerColor[connection.provider] }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{connection.name}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">{connectionTarget(connection)}</Typography>
      </Box>
      <Select
        size="small"
        value={access}
        onChange={(event) => onAccessChange(connection.id, event.target.value as CliAccess)}
        inputProps={{ 'aria-label': `Command line access for ${connection.name}` }}
        sx={{ width: 140, fontSize: 13 }}
      >
        {(Object.keys(ACCESS_LABELS) as CliAccess[]).map((level) => (
          <MenuItem key={level} value={level} sx={{ fontSize: 13 }}>{ACCESS_LABELS[level]}</MenuItem>
        ))}
      </Select>
    </Stack>
  )
})

export function CommandLineSettings({ open, connections, access, onAccessChange }: CommandLineSettingsProps) {
  const { status, installing, error, install } = useCliInstall(open)
  const [filter, setFilter] = useState('')
  const deferredFilter = useDeferredValue(filter)
  const matching = useMemo(() => {
    const needle = deferredFilter.trim().toLocaleLowerCase()
    if (!needle) return connections
    return connections.filter((connection) => (
      connection.name.toLocaleLowerCase().includes(needle) || connectionTarget(connection).toLocaleLowerCase().includes(needle)
    ))
  }, [connections, deferredFilter])
  const visible = matching.slice(0, VISIBLE_LIMIT)

  const copy = (text: string): void => { void window.latch.writeClipboard(text) }

  return (
    <Stack sx={{ gap: 1.5 }}>
      <Box>
        <Typography variant="subtitle2">Command line</Typography>
        <Typography variant="caption" color="text.secondary">
          The <code>latch</code> command lets scripts and AI agents (Claude Code, opencode, and others) use these
          connections without seeing their passwords. Run <code>latch help</code> to get started.
        </Typography>
      </Box>

      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <TerminalRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {!status ? 'Checking…' : status.installed ? (status.outdated ? 'latch command needs an update' : 'latch command installed') : 'latch command not installed'}
          </Typography>
          {status && (
            <Typography variant="caption" color="text.secondary" noWrap component="div" title={status.path}>{status.path}</Typography>
          )}
        </Box>
        {status && <Tooltip title="Copy path"><IconButton size="small" onClick={() => copy(status.path)}><ContentCopyRounded sx={{ fontSize: 15 }} /></IconButton></Tooltip>}
        <Button size="small" variant={status?.installed && !status.outdated ? 'outlined' : 'contained'} disabled={!status || installing} onClick={() => { void install() }}>
          {installing ? 'Installing…' : status?.installed ? (status.outdated ? 'Update' : 'Reinstall') : 'Install'}
        </Button>
      </Stack>
      {status?.installed && !status.onPath && (
        <Alert severity="info" sx={{ py: 0 }}>
          Add <code>{status.path.replace(/[\\/][^\\/]+$/, '')}</code> to your PATH, or run the command by its full path.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}

      <Box>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>Connection access</Typography>
        <Typography variant="caption" color="text.secondary">
          Connections are hidden from the command line until you allow them. Read & write connections still run
          queries read-only unless the command passes <code>--write</code>.
        </Typography>
      </Box>
      {connections.length > FILTER_THRESHOLD && (
        <TextField size="small" placeholder="Filter connections" value={filter} onChange={(event) => setFilter(event.target.value)} />
      )}
      <Box sx={{ maxHeight: 280, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        {connections.length === 0 && <Typography variant="caption" color="text.secondary" component="div" sx={{ p: 1.5 }}>Add a connection first.</Typography>}
        {connections.length > 0 && matching.length === 0 && <Typography variant="caption" color="text.secondary" component="div" sx={{ p: 1.5 }}>No matching connections.</Typography>}
        {visible.map((connection) => (
          <ConnectionAccessRow key={connection.id} connection={connection} access={access.get(connection.id) ?? connection.cliAccess ?? 'off'} onAccessChange={onAccessChange} />
        ))}
        {matching.length > visible.length && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ p: 1 }}>
            Showing {visible.length} of {matching.length}. Filter to find others.
          </Typography>
        )}
      </Box>
    </Stack>
  )
}
