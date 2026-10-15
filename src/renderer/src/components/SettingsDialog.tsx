import { useEffect, useState } from 'react'
import BrightnessAutoRounded from '@mui/icons-material/BrightnessAutoRounded'
import DarkModeRounded from '@mui/icons-material/DarkModeRounded'
import LightModeRounded from '@mui/icons-material/LightModeRounded'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import type { AppSettings, ThemePreference } from '../settings'

interface SettingsDialogProps {
  open: boolean
  settings: AppSettings
  onClose: () => void
  onSave: (settings: AppSettings) => void
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

export function SettingsDialog({ open, settings, onClose, onSave }: SettingsDialogProps) {
  const [theme, setTheme] = useState<ThemePreference>(settings.theme)

  useEffect(() => {
    if (open) setTheme(settings.theme)
  }, [open, settings.theme])

  const save = (): void => {
    onSave({ ...settings, theme })
    onClose()
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
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>Save settings</Button>
      </DialogActions>
    </Dialog>
  )
}
