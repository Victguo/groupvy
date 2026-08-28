import { Box, Paper, Slide, Snackbar, Typography } from '@mui/material';
import './MatchToast.scss';

export default function MatchToast({ item }) {
  return (
    <Snackbar
      open={Boolean(item)}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      TransitionComponent={Slide}
      TransitionProps={{ direction: 'down' }}
      sx={{ top: '20px !important' }}
    >
      <Paper className="match-toast">
        <Box className="match-toast-emoji">{item?.emoji ?? '🎉'}</Box>
        <Box>
          <Typography className="match-toast-title">{`It's a match!`}</Typography>
          <Typography className="match-toast-item">{item?.title ?? ''}</Typography>
        </Box>
      </Paper>
    </Snackbar>
  );
}
