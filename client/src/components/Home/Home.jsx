import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { createRoom, joinRoom } from '../../socket.js';
import './Home.scss';

export default function Home({ onJoined }) {
  const [decksList, setDecksList] = useState([]);
  const [selectedDeck, setSelectedDeck] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/decks')
      .then((r) => r.json())
      .then((list) => {
        setDecksList(list);
        if (list.length) setSelectedDeck(list[0].key);
      });
  }, []);

  async function handleCreate() {
    if (!selectedDeck || busy) return;
    setError('');
    setBusy(true);
    const res = await createRoom(selectedDeck, name.trim() || 'Player');
    setBusy(false);
    if (res.error) return setError(res.error);
    onJoined(res);
  }

  async function handleJoin() {
    if (busy) return;
    setError('');
    if (!code.trim()) {
      setError('Enter a room code.');
      return;
    }
    setBusy(true);
    const res = await joinRoom(code.trim(), name.trim() || 'Player');
    setBusy(false);
    if (res.error) return setError(res.error);
    onJoined(res);
  }

  return (
    <Box component="section" className="screen">
      <Box className="brand">
        <Box className="brand-mark">💘</Box>
        <Typography
          component="h1"
          sx={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.5px', margin: '4px 0' }}
        >
          Groupvy
        </Typography>
        <Typography className="tagline">
          Swipe with your people. Find what you all agree on.
        </Typography>
      </Box>

      <Paper className="home-panel" sx={{ p: 2.75 }}>
        <TextField
          className="home-field"
          label="Your name"
          placeholder="e.g. Sam"
          inputProps={{ maxLength: 20 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <Divider textAlign="center" sx={{ my: 2.5 }}>Start a new room</Divider>

        <Typography variant="overline" color="text.secondary" component="label">
          Pick a category
        </Typography>
        <List className="deck-options">
          {decksList.map((d) => (
            <ListItemButton
              key={d.key}
              className="deck-option"
              selected={selectedDeck === d.key}
              onClick={() => setSelectedDeck(d.key)}
            >
              <span className="deck-emoji">{d.emoji}</span>
              <ListItemText className="deck-name" primary={d.label} />
            </ListItemButton>
          ))}
        </List>
        <Button
          variant="contained"
          fullWidth
          onClick={handleCreate}
          disabled={busy}
        >
          Create Room
        </Button>

        <Divider textAlign="center" sx={{ my: 2.5 }}>or join one</Divider>
        <TextField
          id="code-input"
          className="home-field"
          label="Room code"
          placeholder="e.g. 7XQK"
          inputProps={{ maxLength: 4, autoCapitalize: 'characters' }}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <Button
          variant="outlined"
          color="secondary"
          fullWidth
          onClick={handleJoin}
          disabled={busy}
        >
          Join Room
        </Button>

        <Typography className="error-text" color="error" variant="body2">
          {error}
        </Typography>
      </Paper>
    </Box>
  );
}
