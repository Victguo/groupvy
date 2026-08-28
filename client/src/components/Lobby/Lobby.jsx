import { useState } from 'react';
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import './Lobby.scss';

export default function Lobby({
  roomCode, deckLabel, participants,
  isHost, hostName, minParticipants = 2, phases = [], onStart,
}) {
  const [startError, setStartError] = useState('');

  // Only people actually connected count towards starting — someone whose seat is being
  // held while they reconnect can't swipe, so they can't make a round viable either.
  const activeCount = participants.filter((p) => p.connected).length;
  const needed = Math.max(0, minParticipants - activeCount);
  const canStart = needed === 0;

  async function handleStart() {
    setStartError('');
    const res = await onStart();
    // The server re-checks host and headcount, so surface a rejection rather than
    // assuming the disabled button was the only guard.
    if (res?.error) setStartError(res.error);
  }

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
          {/* Someone who's dropped off keeps their place in the room, so they keep their
              chip too — outlined and labelled, rather than vanishing and reappearing. */}
          {participants.map((p, i) => (
            <Chip
              key={i}
              className={p.connected ? undefined : 'participant-away'}
              variant={p.connected ? 'filled' : 'outlined'}
              label={p.connected ? p.name : `${p.name} · reconnecting…`}
            />
          ))}
        </Stack>

        {isHost ? (
          <>
            <Button variant="contained" fullWidth disabled={!canStart} onClick={handleStart}>
              {/* A phased deck doesn't start swiping here — it opens the group's
                  selection round first, and the button shouldn't promise otherwise. */}
              {phases.length
                ? `Next: ${phases.length} quick ${phases.length === 1 ? 'pick' : 'picks'}`
                : 'Start Swiping'}
            </Button>
            {!canStart && (
              <Typography className="lobby-wait" variant="body2" color="text.secondary">
                Waiting for {needed} more {needed === 1 ? 'person' : 'people'} to join…
              </Typography>
            )}
          </>
        ) : (
          <Typography className="lobby-wait" variant="body2" color="text.secondary">
            {canStart
              ? `Waiting for ${hostName || 'the host'} to start…`
              : `Waiting for ${needed} more ${needed === 1 ? 'person' : 'people'} to join…`}
          </Typography>
        )}
        {startError && (
          <Typography className="lobby-wait" variant="body2" color="error">{startError}</Typography>
        )}
      </Paper>
    </Box>
  );
}
