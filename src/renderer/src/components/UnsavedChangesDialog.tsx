import { useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'

interface UnsavedChangesDialogProps {
  open: boolean
  /** Undefined once the prompt is answered; the last name stays shown while the dialog fades out. */
  fileName?: string
  /** True while a Save answer is writing; the dialog cannot be answered again until it finishes. */
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

/** Asked once per unsaved file tab when closing. Closing the dialog any other way counts as Cancel. */
export function UnsavedChangesDialog({ open, fileName, saving, onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  const [shownName, setShownName] = useState(fileName ?? '')
  if (fileName !== undefined && fileName !== shownName) setShownName(fileName)

  return (
    <Dialog open={open} onClose={saving ? undefined : onCancel} maxWidth="xs" fullWidth aria-labelledby="unsaved-changes-title">
      <DialogTitle id="unsaved-changes-title">Save changes to {shownName}?</DialogTitle>
      <DialogContent>
        <DialogContentText>Your changes will be lost if you don&apos;t save them.</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" disabled={saving} onClick={onDiscard}>Don&apos;t Save</Button>
        <Button color="inherit" disabled={saving} onClick={onCancel}>Cancel</Button>
        <Button variant="contained" autoFocus loading={saving} onClick={onSave}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}
