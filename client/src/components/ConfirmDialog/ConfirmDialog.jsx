import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import './ConfirmDialog.scss';

// A generic yes/no prompt — first Dialog in the app. Content renders in a Paper, so it
// picks up the same MuiPaper/MuiButton overrides every other screen uses for free.
export default function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', onConfirm, onCancel }) {
  return (
    <Dialog open={open} onClose={onCancel} className="confirm-dialog">
      <DialogTitle>{title}</DialogTitle>
      {body && (
        <DialogContent>
          <Typography color="text.secondary">{body}</Typography>
        </DialogContent>
      )}
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" color="error" onClick={onConfirm}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
