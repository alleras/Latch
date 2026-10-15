import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
import type { PaletteMode } from '@mui/material/styles'
import App from './App'
import { APP_SETTINGS_STORAGE_KEY, readAppSettings, serializeAppSettings, type AppSettings } from './settings'
import { createLatchTheme } from './theme'
import './styles.css'

function LatchRoot() {
  const [settings, setSettings] = useState(() => readAppSettings(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)))
  const [systemMode, setSystemMode] = useState<PaletteMode>(() => (
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  ))

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemMode = (event: MediaQueryListEvent): void => setSystemMode(event.matches ? 'dark' : 'light')
    media.addEventListener('change', updateSystemMode)
    return () => media.removeEventListener('change', updateSystemMode)
  }, [])

  const updateSettings = useCallback((nextSettings: AppSettings): void => {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, serializeAppSettings(nextSettings))
    setSettings(nextSettings)
  }, [])
  const mode = settings.theme === 'system' ? systemMode : settings.theme
  const theme = useMemo(() => createLatchTheme(mode), [mode])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App settings={settings} onSettingsChange={updateSettings} />
    </ThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LatchRoot />
  </React.StrictMode>
)

