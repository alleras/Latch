import { alpha, createTheme, type PaletteMode } from '@mui/material/styles'
import type { CSSProperties } from 'react'

declare module '@mui/material/styles' {
  interface TypographyVariants {
    sidebarTitle: CSSProperties
    sidebarItem: CSSProperties
    sidebarSection: CSSProperties
    sidebarMeta: CSSProperties
    sidebarBadge: CSSProperties
    sidebarCode: CSSProperties
  }

  interface TypographyVariantsOptions {
    sidebarTitle?: CSSProperties
    sidebarItem?: CSSProperties
    sidebarSection?: CSSProperties
    sidebarMeta?: CSSProperties
    sidebarBadge?: CSSProperties
    sidebarCode?: CSSProperties
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    sidebarTitle: true
    sidebarItem: true
    sidebarSection: true
    sidebarMeta: true
    sidebarBadge: true
    sidebarCode: true
  }
}

export const componentSizes = {
  sidebarPanel: {
    headerHeight: 38,
    filterHeight: 34,
    rowHeight: 30,
    detailRowHeight: 28,
    connectionRowHeight: 44,
    icon: 15,
    detailIcon: 14,
    chevron: 15
  }
} as const

const darkAccent = '#c9f55f'
const lightAccent = '#5f8408'

const colorsByMode = {
  dark: {
    accent: darkAccent,
    secondary: '#80b8ff',
    default: '#0b0d10',
    paper: '#111419',
    text: '#f3f5f0',
    secondaryText: '#8f959e',
    divider: '#242830',
    shell: '#0d1014',
    editor: '#0f1216',
    tabs: '#0e1115',
    activeTab: '#13171c',
    gridHeader: '#181c22',
    gridGutter: '#111419',
    gridMuted: '#777e88',
    gridBorder: '#21252c',
    hover: 'rgba(255,255,255,.025)',
    selected: 'rgba(201,245,95,.075)',
    connectionSelected: '#22262c',
    connectionSelectedHover: '#292e35',
    scrollbar: '#343a43'
  },
  light: {
    accent: lightAccent,
    secondary: '#2468a8',
    default: '#f4f6f8',
    paper: '#ffffff',
    text: '#17202a',
    secondaryText: '#616b78',
    divider: '#d9dee5',
    shell: '#f8f9fb',
    editor: '#fbfcfd',
    tabs: '#eef1f4',
    activeTab: '#ffffff',
    gridHeader: '#eef1f4',
    gridGutter: '#f7f8fa',
    gridMuted: '#727c88',
    gridBorder: '#dfe3e8',
    hover: 'rgba(21,32,43,.04)',
    selected: 'rgba(95,132,8,.10)',
    connectionSelected: '#e7ecd9',
    connectionSelectedHover: '#dfe6cc',
    scrollbar: '#aeb6c0'
  }
} as const

export function createLatchTheme(mode: PaletteMode) {
  const colors = colorsByMode[mode]
  const inputFontSize = 13

  return createTheme({
    cssVariables: true,
    palette: {
      mode,
      primary: { main: colors.accent, contrastText: mode === 'dark' ? '#101407' : '#ffffff' },
      secondary: { main: colors.secondary },
      background: { default: colors.default, paper: colors.paper },
      text: { primary: colors.text, secondary: colors.secondaryText },
      divider: colors.divider,
      error: { main: mode === 'dark' ? '#ff7771' : '#bf3f3a' },
      success: { main: mode === 'dark' ? '#8ddd8a' : '#3d8140' }
    },
    typography: {
      fontSize: 15,
      fontFamily: '"DM Sans", system-ui, sans-serif',
      body1: { fontSize: 15 },
      body2: { fontSize: 14 },
      caption: { fontSize: 12 },
      button: { fontSize: 14, textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
      overline: { fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', lineHeight: 1.6 },
      sidebarTitle: { fontSize: 13, fontWeight: 700, lineHeight: 1.35 },
      sidebarItem: { fontSize: 13, fontWeight: 400, lineHeight: 1.35 },
      sidebarSection: { fontSize: 12, fontWeight: 600, lineHeight: 1.35 },
      sidebarMeta: { fontSize: 11, fontWeight: 400, lineHeight: 1.35 },
      sidebarBadge: { fontSize: 10, fontWeight: 700, lineHeight: 1.35, fontFamily: '"DM Mono", monospace', letterSpacing: '0.02em' },
      sidebarCode: { fontSize: 12, fontWeight: 400, lineHeight: 1.45, fontFamily: '"DM Mono", monospace' }
    },
    shape: { borderRadius: 8 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ':root': {
            colorScheme: mode,
            '--latch-shell': colors.shell,
            '--latch-editor': colors.editor,
            '--latch-tabs': colors.tabs,
            '--latch-active-tab': colors.activeTab,
            '--latch-grid-header': colors.gridHeader,
            '--latch-grid-gutter': colors.gridGutter,
            '--latch-grid-text': colors.text,
            '--latch-grid-muted': colors.gridMuted,
            '--latch-grid-border': colors.gridBorder,
            '--latch-grid-hover': colors.hover,
            '--latch-grid-selected': colors.selected,
            '--latch-connection-selected': colors.connectionSelected,
            '--latch-connection-selected-hover': colors.connectionSelectedHover,
            '--latch-scrollbar': colors.scrollbar,
            '--latch-accent': colors.accent
          },
          body: { backgroundImage: 'none' },
          '::selection': { background: alpha(colors.accent, 0.22) }
        }
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { minHeight: 32, borderRadius: 7 } }
      },
      MuiIconButton: {
        styleOverrides: { root: { borderRadius: 7 } }
      },
      MuiPaper: {
        styleOverrides: { root: { backgroundImage: 'none' } }
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            border: `1px solid ${colors.divider}`,
            boxShadow: mode === 'dark' ? '0 30px 100px rgba(0,0,0,.72)' : '0 30px 100px rgba(30,40,50,.22)',
            backgroundImage: mode === 'dark' ? 'linear-gradient(145deg, rgba(255,255,255,.018), transparent 45%)' : 'none'
          }
        }
      },
      MuiTextField: {
        defaultProps: { size: 'small', variant: 'outlined' }
      },
      MuiInputLabel: {
        styleOverrides: { outlined: { fontSize: inputFontSize } }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            background: colors.editor,
            fontSize: inputFontSize,
            '& fieldset': { borderColor: colors.divider },
            '&:hover fieldset': { borderColor: colors.secondaryText }
          }
        }
      },
      MuiTooltip: {
        defaultProps: { arrow: true, enterDelay: 500 },
        styleOverrides: { tooltip: { background: '#252a31', color: '#f3f5f0', fontSize: 12 } }
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: colors.gridBorder, fontFamily: '"DM Mono", monospace', fontSize: 12, whiteSpace: 'nowrap' },
          head: { background: colors.gridHeader, color: colors.secondaryText, fontWeight: 500 }
        }
      }
    }
  })
}
