import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'

interface UnsavedChangesDialogProps {
  open: boolean
  fileName: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

/** Asked once per unsaved file tab when closing. Closing the dialog any other way counts as Cancel. */
export function UnsavedChangesDialog({ open, fileName, onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth aria-labelledby="unsaved-changes-title">
      <DialogTitle id="unsaved-changes-title">Save changes to {fileName}?</DialogTitle>
      <DialogContent>
        <DialogContentText>Your changes will be lost if you don&apos;t save them.</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onDiscard}>Don&apos;t Save</Button>
        <Button color="inherit" onClick={onCancel}>Cancel</Button>
        <Button variant="contained" autoFocus onClick={onSave}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}
