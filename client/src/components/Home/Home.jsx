import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
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

// Resolves to { latitude, longitude } or null — denial, timeout, or an unsupported
// browser should never block room creation, they just mean the dinner deck falls
// back to the server's default location.
function getCurrentCoords() {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 5 * 60 * 1000 }
    );
  });
}

// `initialName` is whatever this tab last played as — set when a resume failed because the
// room had ended, so someone starting over doesn't have to type their name again.
export default function Home({ onJoined, initialName = '' }) {
  const [decksList, setDecksList] = useState([]);
  const [selectedDeck, setSelectedDeck] = useState(null);
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Which button is currently mid-request, and what it's doing — the dinner deck's
  // extra geolocation + Google Places round trip is slow enough to need its own status text.
  const [activeAction, setActiveAction] = useState(null); // 'create' | 'join' | null
  const [statusText, setStatusText] = useState('');

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
    setActiveAction('create');
    try {
      // Only the dinner deck uses location (to find nearby restaurants), so we only
      // prompt for it then — other decks don't need it. It's captured now rather than
      // during the cuisine phase because it's the host's browser that has to be asked,
      // and by then the room is everyone's.
      let coords = null;
      if (selectedDeck === 'dinner') {
        setStatusText('Finding your location…');
        coords = await getCurrentCoords();
      }
      setStatusText('Creating room…');
      const res = await createRoom(selectedDeck, name.trim() || 'Player', coords);
      if (res.error) return setError(res.error);
      onJoined(res);
    } finally {
      setBusy(false);
      setActiveAction(null);
      setStatusText('');
    }
  }

  async function handleJoin() {
    if (busy) return;
    setError('');
    if (!code.trim()) {
      setError('Enter a room code.');
      return;
    }
    setBusy(true);
    setActiveAction('join');
    setStatusText('Joining room…');
    try {
      const res = await joinRoom(code.trim(), name.trim() || 'Player');
      if (res.error) return setError(res.error);
      onJoined(res);
    } finally {
      setBusy(false);
      setActiveAction(null);
      setStatusText('');
    }
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
              disabled={busy}
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
          startIcon={activeAction === 'create' ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {activeAction === 'create' ? statusText : 'Create Room'}
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
          startIcon={activeAction === 'join' ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {activeAction === 'join' ? statusText : 'Join Room'}
        </Button>

        <Typography className="error-text" color="error" variant="body2">
          {error}
        </Typography>
      </Paper>
    </Box>
  );
}
