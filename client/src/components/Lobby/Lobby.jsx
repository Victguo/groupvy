import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import './Lobby.scss';

export default function Lobby({ roomCode, deckLabel, participants, onStart }) {
  return (
    <Box component="section" className="screen">
      <Paper className="lobby-box">
        <Typography variant="overline" color="text.secondary">Room code</Typography>
        <Typography className="lobby-code">{roomCode}</Typography>
        <Typography className="lobby-hint" variant="body2" color="text.secondary">
          Share this code with your partner or group so they can join.
        </Typography>
        <Typography className="lobby-deck" variant="body2">Category: {deckLabel}</Typography>
        <Stack
          className="participants-list"
          direction="row"
          flexWrap="wrap"
          justifyContent="center"
          gap={1}
        >
          {participants.map((name, i) => (
            <Chip key={i} label={name} />
          ))}
        </Stack>
        <Button variant="contained" fullWidth onClick={onStart}>Start Swiping</Button>
      </Paper>
    </Box>
  );
}
