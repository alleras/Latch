import { useState } from 'react'
import CloseRounded from '@mui/icons-material/CloseRounded'
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded'
import { IconButton, Snackbar, Stack } from '@mui/material'

export interface Notice {
  id: string
  message: string
  severity: 'info' | 'warning'
}

interface NoticeSnackbarProps {
  /** The oldest undismissed notice, or null. */
  notice: Notice | null
  onDismiss: () => void
}

const INFO_DURATION_MS = 6000

/**
 * Shows notices one at a time. Info notices hide after a few seconds; warnings stay until dismissed.
 * A click elsewhere never dismisses one, so a warning shown at launch survives the first click.
 */
export function NoticeSnackbar({ notice, onDismiss }: NoticeSnackbarProps) {
  // The last notice stays rendered while the snackbar fades out.
  const [shown, setShown] = useState(notice)
  if (notice && notice !== shown) setShown(notice)
  if (!shown) return null

  return (
    <Snackbar
      key={shown.id}
      open={Boolean(notice)}
      autoHideDuration={shown.severity === 'warning' ? null : INFO_DURATION_MS}
      onClose={(_event, reason) => {
        if (reason !== 'clickaway') onDismiss()
      }}
      message={shown.severity === 'warning' ? (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <WarningAmberRounded fontSize="small" color="warning" />
          {shown.message}
        </Stack>
      ) : shown.message}
      action={(
        <IconButton size="small" color="inherit" aria-label="Dismiss" onClick={onDismiss}>
          <CloseRounded fontSize="small" />
        </IconButton>
      )}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    />
  )
}
