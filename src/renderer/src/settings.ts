export type ThemePreference = 'light' | 'dark' | 'system'

export interface AppSettings {
  theme: ThemePreference
}

export const APP_SETTINGS_STORAGE_KEY = 'latch:settings:v1'
export const DEFAULT_APP_SETTINGS: AppSettings = { theme: 'system' }

export function readAppSettings(value: string | null): AppSettings {
  if (!value) return DEFAULT_APP_SETTINGS

  try {
    const candidate = JSON.parse(value) as Record<string, unknown>
    const theme = candidate.theme
    if (theme === 'light' || theme === 'dark' || theme === 'system') return { theme }
  } catch {
    // Ignore malformed settings and use defaults.
  }

  return DEFAULT_APP_SETTINGS
}

export function serializeAppSettings(settings: AppSettings): string {
  return JSON.stringify({ version: 1, ...settings })
}
