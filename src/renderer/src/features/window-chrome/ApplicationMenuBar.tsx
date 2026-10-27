import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import { Box, ButtonBase, ClickAwayListener, Divider, MenuItem, MenuList, Paper, Popper, Snackbar, Typography } from '@mui/material'
import type { ApplicationMenuItem } from '../../../../shared/types'

function shortcutLabel(accelerator: string): string {
  return accelerator.replace(/CmdOrCtrl|CommandOrControl|Control/g, 'Ctrl').replace(/\+Plus$/, '++')
}

export function ApplicationMenuBar() {
  const [menus, setMenus] = useState<ApplicationMenuItem[]>([])
  const [path, setPath] = useState<number[]>([])
  const [focusedMenu, setFocusedMenu] = useState<number | null>(null)
  const [error, setError] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<number, HTMLButtonElement>())
  const previousFocus = useRef<HTMLElement | null>(null)
  const activeMenu = menus.find((menu) => menu.id === path[0])
  let currentMenu = activeMenu
  for (const id of path.slice(1)) currentMenu = currentMenu?.submenu?.find((item) => item.id === id)

  const captureFocus = (): void => {
    const element = document.activeElement
    if (element instanceof HTMLElement && !rootRef.current?.contains(element) && !paperRef.current?.contains(element)) {
      previousFocus.current = element
    }
  }

  const close = (restoreFocus = true): void => {
    if (path.length === 0 && previousFocus.current === null) return
    setPath([])
    const target = previousFocus.current
    previousFocus.current = null
    if (restoreFocus && target?.isConnected) target.focus({ preventScroll: true })
  }

  const open = (id: number): void => {
    if (path.length === 0) captureFocus()
    setFocusedMenu(id)
    setPath([id])
    // Refresh native enabled/checked state each time the menu is opened.
    void window.latch.getApplicationMenu().then(setMenus).catch(() => setError(true))
  }

  useEffect(() => {
    let disposed = false
    void window.latch.getApplicationMenu().then((items) => {
      if (!disposed) setMenus(items)
    }).catch(() => { if (!disposed) setError(true) })
    return () => { disposed = true }
  }, [])

  useEffect(() => window.latch.onMenuBarFocus((label) => {
    if (label) {
      const menu = menus.find((item) => item.label === label)
      if (menu) open(menu.id)
    } else if (path.length > 0 || rootRef.current?.contains(document.activeElement)) {
      close()
    } else if (menus[0]) {
      captureFocus()
      setFocusedMenu(menus[0].id)
      buttons.current.get(menus[0].id)?.focus()
    }
  }), [menus, path])

  const move = (direction: number, expand: boolean): void => {
    const index = menus.findIndex((menu) => menu.id === (path[0] ?? focusedMenu))
    const next = menus[(index + direction + menus.length) % menus.length]
    if (!next) return
    setFocusedMenu(next.id)
    if (expand) setPath([next.id])
    else buttons.current.get(next.id)?.focus()
  }

  const handleMenuKeys = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'ArrowLeft' && path.length > 1) setPath(path.slice(0, -1))
      else if (event.key === 'ArrowRight') {
        const focused = currentMenu?.submenu?.find((item) => String(item.id) === (event.target as HTMLElement).closest('[data-menu-id]')?.getAttribute('data-menu-id'))
        if (focused?.submenu) setPath([...path, focused.id])
        else move(1, true)
      } else move(-1, true)
    }
  }

  const activate = (item: ApplicationMenuItem): void => {
    if (item.submenu) {
      setPath([...path, item.id])
      return
    }
    // Restore the editor/input before Electron runs native edit roles such as Copy and Paste.
    close()
    void window.latch.executeMenuItem(item.id).catch(() => setError(true))
  }

  return (
    <>
      <ClickAwayListener onClickAway={() => close(false)}>
        <Box ref={rootRef} role="menubar" aria-label="Application menu" sx={{ display: 'flex', alignItems: 'center', alignSelf: 'stretch', WebkitAppRegion: 'no-drag' }}>
          {menus.map((menu, index) => (
            <ButtonBase
              key={menu.id}
              ref={(node: HTMLButtonElement | null) => { if (node) buttons.current.set(menu.id, node); else buttons.current.delete(menu.id) }}
              id={`application-menu-${menu.id}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={activeMenu?.id === menu.id}
              aria-controls={activeMenu?.id === menu.id ? 'application-menu-popup' : undefined}
              aria-keyshortcuts={`Alt+${menu.label[0]?.toLowerCase()}`}
              tabIndex={focusedMenu === menu.id || (focusedMenu === null && index === 0) ? 0 : -1}
              disabled={!menu.enabled}
              onMouseDown={(event) => { captureFocus(); event.preventDefault() }}
              onFocus={(event) => {
                if (event.relatedTarget instanceof HTMLElement && !rootRef.current?.contains(event.relatedTarget) && !paperRef.current?.contains(event.relatedTarget)) previousFocus.current = event.relatedTarget
                setFocusedMenu(menu.id)
              }}
              onClick={() => activeMenu?.id === menu.id ? close() : open(menu.id)}
              onPointerEnter={() => { if (activeMenu && activeMenu.id !== menu.id) setPath([menu.id]) }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault()
                  move(event.key === 'ArrowRight' ? 1 : -1, false)
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  open(menu.id)
                  if (event.key === 'ArrowUp') requestAnimationFrame(() => {
                    const items = paperRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')
                    items?.[items.length - 1]?.focus()
                  })
                } else if (event.key === 'Escape') close()
              }}
              sx={{ px: 1, height: 28, borderRadius: 1, fontSize: 12, color: 'text.primary', bgcolor: activeMenu?.id === menu.id ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}
            >
              {menu.label}
            </ButtonBase>
          ))}
          <Popper open={Boolean(activeMenu)} anchorEl={activeMenu ? buttons.current.get(activeMenu.id) : null} placement="bottom-start" modifiers={[{ name: 'offset', options: { offset: [0, 5] } }]} sx={{ zIndex: (theme) => theme.zIndex.modal + 1, WebkitAppRegion: 'no-drag' }}>
            <Paper ref={paperRef} elevation={12} sx={{ minWidth: 260, maxHeight: 'calc(100vh - 64px)', overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1.25 }}>
              <MenuList key={path.join('-')} id="application-menu-popup" aria-labelledby={activeMenu ? `application-menu-${activeMenu.id}` : undefined} autoFocusItem variant="menu" onKeyDown={handleMenuKeys} dense sx={{ py: 0.5 }}>
                {path.length > 1 && <MenuItem onClick={() => setPath(path.slice(0, -1))}><ArrowBackRounded sx={{ mr: 1, fontSize: 16 }} />{currentMenu?.label}</MenuItem>}
                {currentMenu?.submenu?.map((item) => item.type === 'separator'
                  ? <Divider key={item.id} sx={{ my: 0.5 }} />
                  : (
                    <MenuItem key={item.id} data-menu-id={item.id} disabled={!item.enabled} onClick={() => activate(item)} role={item.type === 'radio' ? 'menuitemradio' : item.type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'} aria-checked={item.type === 'checkbox' || item.type === 'radio' ? item.checked : undefined} sx={{ minHeight: 30, px: 1.25, gap: 1.5, fontSize: 13 }}>
                      <Box sx={{ width: 16, height: 16, flexShrink: 0 }}>{item.checked && <CheckRounded sx={{ fontSize: 16 }} />}</Box>
                      <Box component="span" sx={{ flex: 1 }}>{item.label}</Box>
                      {item.accelerator && <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary', ml: 2 }}>{shortcutLabel(item.accelerator)}</Typography>}
                      {item.submenu && <ChevronRightRounded sx={{ fontSize: 16 }} />}
                    </MenuItem>
                  ))}
              </MenuList>
            </Paper>
          </Popper>
        </Box>
      </ClickAwayListener>
      <Snackbar open={error} autoHideDuration={5000} onClose={() => setError(false)} message="Unable to use the application menu. Please try again." />
    </>
  )
}
