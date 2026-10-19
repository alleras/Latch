import { useEffect, useMemo, useState } from 'react'
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import CreateNewFolderRounded from '@mui/icons-material/CreateNewFolderRounded'
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded'
import LockRounded from '@mui/icons-material/LockRounded'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material'
import type { ProviderDefinition, ProviderId, ServerConnectionInput, ServerProviderId } from '../../../shared/types'
import { ProviderIcon, providerColor } from './ProviderIcon'

interface ConnectionDialogProps {
  open: boolean
  providers: ProviderDefinition[]
  busy: boolean
  error: string | null
  onClose: () => void
  onOpenSqlite: () => void
  onCreateSqlite: () => void
  onConnect: (input: ServerConnectionInput) => void
}

const EMPTY_FORM: ServerConnectionInput = {
  provider: 'postgresql',
  name: '',
  host: '',
  port: 5432,
  username: '',
  password: '',
  initialDatabase: 'postgres',
  ssl: false,
  trustServerCertificate: false
}

export function ConnectionDialog({ open, providers, busy, error, onClose, onOpenSqlite, onCreateSqlite, onConnect }: ConnectionDialogProps) {
  const [selectedId, setSelectedId] = useState<ProviderId | null>(null)
  const [form, setForm] = useState<ServerConnectionInput>(EMPTY_FORM)
  const selected = useMemo(() => providers.find((provider) => provider.id === selectedId), [providers, selectedId])

  useEffect(() => {
    if (!open) return
    setSelectedId(null)
    setForm(EMPTY_FORM)
  }, [open])

  const selectProvider = (provider: ProviderDefinition): void => {
    setSelectedId(provider.id)
    if (provider.mode === 'server') {
      setForm({
        provider: provider.id as ServerProviderId,
        name: '',
        host: '',
        port: provider.defaultPort ?? 0,
        username: '',
        password: '',
        initialDatabase: provider.defaultDatabase,
        ssl: provider.defaultSsl,
        trustServerCertificate: false
      })
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ px: 3, pt: 2.5, pb: 1 }}>
        <Stack direction="row" sx={{ alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline" color="primary.main">New connection</Typography>
            <Typography variant="h5" sx={{ mt: 0.25, fontWeight: 600, letterSpacing: '-0.025em' }}>Choose a provider</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Connect to the engine where your data lives.</Typography>
          </Box>
          <IconButton size="small" onClick={onClose} disabled={busy}><CloseRounded fontSize="small" /></IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pb: 1 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, mt: 1.5 }}>
          {providers.map((provider) => {
            const active = provider.id === selectedId
            const color = providerColor[provider.id]
            return (
              <ButtonBase
                key={provider.id}
                onClick={() => selectProvider(provider)}
                sx={{
                  minHeight: 70,
                  justifyContent: 'flex-start',
                  gap: 1.25,
                  p: 1.25,
                  border: '1px solid',
                  borderColor: active ? color : 'divider',
                  borderRadius: 1.5,
                  bgcolor: active ? `${color}10` : 'action.hover',
                  textAlign: 'left',
                  transition: '120ms ease',
                  '&:hover': { bgcolor: `${color}0d`, borderColor: `${color}88` }
                }}
              >
                <Box sx={{ width: 38, height: 38, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 1.25, color, bgcolor: `${color}14`, border: `1px solid ${color}33` }}>
                  <ProviderIcon provider={provider.id} fontSize="small" />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{provider.label}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>{provider.description}</Typography>
                </Box>
                {active && <Chip label="Selected" size="small" sx={{ height: 21, fontSize: 10, bgcolor: `${color}18`, color }} />}
              </ButtonBase>
            )
          })}
        </Box>

        {selected?.mode === 'file' && (
          <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'action.hover' }}>
            <Typography variant="subtitle2">Choose a SQLite file</Typography>
            <Typography variant="caption" color="text.secondary">Open an existing database or create a new local file.</Typography>
            <Stack direction="row" sx={{ gap: 1, mt: 1.5 }}>
              <Button variant="contained" startIcon={<FolderOpenRounded />} onClick={onOpenSqlite}>Open database</Button>
              <Button variant="outlined" startIcon={<CreateNewFolderRounded />} onClick={onCreateSqlite}>Create new</Button>
            </Stack>
          </Box>
        )}

        {selected?.mode === 'server' && (
          <Box component="form" id="server-connection-form" onSubmit={(event) => { event.preventDefault(); onConnect(form) }} sx={{ mt: 2 }}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5 }}>
              <Typography variant="overline" color="text.secondary">Connection details</Typography>
              <Box sx={{ height: 1, flex: 1, bgcolor: 'divider' }} />
              {form.ssl && <Chip icon={<LockRounded />} label="TLS" size="small" color="primary" variant="outlined" sx={{ height: 23, fontSize: 10 }} />}
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 112px', gap: 1.25 }}>
              <TextField label="Connection name" placeholder="Production analytics" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} sx={{ gridColumn: '1 / -1' }} />
              <TextField required label="Host" placeholder={selected.id === 'azuresql' ? 'myserver.database.windows.net' : 'localhost'} value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} />
              <TextField required label="Port" type="number" slotProps={{ htmlInput: { min: 1, max: 65535 } }} value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} />
              <TextField required label="Username" autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
              <TextField required label="Password" type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
              <TextField label="Initial database" helperText="Optional; used to discover databases" placeholder={selected.defaultDatabase ?? 'Provider default'} value={form.initialDatabase ?? ''} onChange={(event) => setForm({ ...form, initialDatabase: event.target.value })} sx={{ gridColumn: '1 / -1' }} />
            </Box>
            <Stack sx={{ mt: 1 }}>
              <FormControlLabel control={<Switch size="small" checked={form.ssl} onChange={(event) => setForm({ ...form, ssl: event.target.checked })} />} label={<Typography variant="body2">Use TLS <Typography component="span" variant="caption" color="text.secondary">· {selected.id === 'azuresql' ? 'required by Azure SQL' : 'recommended remotely'}</Typography></Typography>} />
              {form.ssl && <FormControlLabel control={<Switch size="small" checked={form.trustServerCertificate} onChange={(event) => setForm({ ...form, trustServerCertificate: event.target.checked })} />} label={<Typography variant="body2">Trust server certificate <Typography component="span" variant="caption" color="warning.main">· local development only</Typography></Typography>} />}
            </Stack>
            {error && <Alert severity="error" variant="outlined" sx={{ mt: 1.5, py: 0.25, fontSize: 12 }}>{error}</Alert>}
          </Box>
        )}
      </DialogContent>

      {selected?.mode === 'server' && (
        <DialogActions sx={{ px: 3, py: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button color="inherit" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="server-connection-form" variant="contained" endIcon={<ArrowForwardRounded />} loading={busy}>Test & connect</Button>
        </DialogActions>
      )}
    </Dialog>
  )
}
