import { useCallback, useEffect, useState } from 'react'
import BrightnessAutoRounded from '@mui/icons-material/BrightnessAutoRounded'
import DarkModeRounded from '@mui/icons-material/DarkModeRounded'
import LightModeRounded from '@mui/icons-material/LightModeRounded'
import {
  Box,
  Button,
  Dialog,
  Divider,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import type { CliAccess, Connection } from '../../../shared/types'
import type { AppSettings, ThemePreference } from '../settings'
import { readableErrorMessage } from '../errors'
import { CommandLineSettings } from './CommandLineSettings'

interface SettingsDialogProps {
  open: boolean
  settings: AppSettings
  connections: Connection[]
  onClose: () => void
  onSave: (settings: AppSettings) => void
  /** Persists changed command line access levels, keyed by connection id. */
  onSaveCliAccess: (changes: ReadonlyMap<string, CliAccess>) => Promise<void>
}

const themeOptions: Array<{
  value: ThemePreference
  label: string
  description: string
  icon: typeof LightModeRounded
}> = [
  { value: 'light', label: 'Light', description: 'Always use the light theme', icon: LightModeRounded },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme', icon: DarkModeRounded },
  { value: 'system', label: 'System', description: 'Follow your operating system', icon: BrightnessAutoRounded }
]

export function SettingsDialog({ open, settings, connections, onClose, onSave, onSaveCliAccess }: SettingsDialogProps) {
  const [theme, setTheme] = useState<ThemePreference>(settings.theme)
  const [cliAccess, setCliAccess] = useState<ReadonlyMap<string, CliAccess>>(new Map())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setTheme(settings.theme)
  }, [open, settings.theme])

  useEffect(() => {
    if (!open) return
    setCliAccess(new Map())
    setSaveError(null)
  }, [open])

  const changeCliAccess = useCallback((connectionId: string, access: CliAccess): void => {
    setCliAccess((current) => new Map(current).set(connectionId, access))
  }, [])

  const save = async (): Promise<void> => {
    const changed = new Map([...cliAccess].filter(([id, access]) => {
      const connection = connections.find((candidate) => candidate.id === id)
      return connection && (connection.cliAccess ?? 'off') !== access
    }))
    setSaving(true)
    setSaveError(null)
    try {
      if (changed.size > 0) await onSaveCliAccess(changed)
      onSave({ ...settings, theme })
      onClose()
    } catch (error) {
      setSaveError(readableErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Settings</DialogTitle>
      <DialogContent dividers>
        <Stack sx={{ gap: 1.5 }}>
          <Box>
            <Typography variant="subtitle2">Appearance</Typography>
            <Typography variant="caption" color="text.secondary">Choose how Latch looks. System mode updates automatically.</Typography>
          </Box>
          <ToggleButtonGroup
            exclusive
            fullWidth
            value={theme}
            onChange={(_event, value: ThemePreference | null) => { if (value) setTheme(value) }}
            aria-label="Theme"
          >
            {themeOptions.map((option) => {
              const Icon = option.icon
              return (
                <ToggleButton
                  key={option.value}
                  value={option.value}
                  aria-label={option.label}
                  sx={{ alignItems: 'flex-start', gap: 1, px: 1.5, py: 1.25, textAlign: 'left', textTransform: 'none' }}
                >
                  <Icon sx={{ mt: 0.15, fontSize: 18 }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{option.label}</Typography>
                    <Typography component="div" variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>{option.description}</Typography>
                  </Box>
                </ToggleButton>
              )
            })}
          </ToggleButtonGroup>
          <Divider sx={{ my: 1 }} />
          <CommandLineSettings open={open} connections={connections} access={cliAccess} onAccessChange={changeCliAccess} />
        </Stack>
      </DialogContent>
      <DialogActions>
        {saveError && <Typography variant="caption" color="error" sx={{ mr: 'auto', pl: 1 }}>{saveError}</Typography>}
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving} onClick={() => { void save() }}>Save settings</Button>
      </DialogActions>
    </Dialog>
  )
}
