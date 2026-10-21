import { useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'

export interface ConfirmationRequest {
  title: string
  message: string
  confirmLabel: string
}

interface ConfirmDialogProps {
  /** Null when nothing is being asked; the last request stays shown while the dialog fades out. */
  request: ConfirmationRequest | null
  onConfirm: () => void
  onCancel: () => void
}

/** Asks before an action that loses work. Cancel has focus, and closing the dialog any other way counts as Cancel. */
export function ConfirmDialog({ request, onConfirm, onCancel }: ConfirmDialogProps) {
  const [shown, setShown] = useState(request)
  if (request && request !== shown) setShown(request)

  return (
    <Dialog open={Boolean(request)} onClose={onCancel} maxWidth="xs" fullWidth aria-labelledby="confirm-dialog-title">
      <DialogTitle id="confirm-dialog-title">{shown?.title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{shown?.message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" autoFocus onClick={onCancel}>Cancel</Button>
        <Button variant="contained" color="error" onClick={onConfirm}>{shown?.confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  )
}
