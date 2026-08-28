import { useEffect, useState } from 'react';
import { Box, Button, Chip, CircularProgress, LinearProgress, Paper, Typography } from '@mui/material';
import { advancePhase, submitPicks } from '../../socket.js';
import './PhasePicker.scss';

// The selection round the whole room goes through before any swiping. Both phases are
// the same interaction — pick zero or more chips, lock in, wait for everyone else — so
// they share one screen and differ only in wording and where the options come from.
const PHASE_COPY = {
  genres: {
    title: 'Pick your genres',
    blurb: "Everyone's picks are combined, so choose what you'd actually watch. No pick means no preference.",
    empty: 'Genres are unavailable right now — carry on and the deck will cover everything.',
    anyLabel: 'No preference',
  },
  length: {
    title: 'How long tonight?',
    blurb: 'Same again: every length anyone picks makes it into the deck.',
    empty: '',
    anyLabel: 'Any length',
  },
  cuisines: {
    title: 'What are you in the mood for?',
    blurb: "Everyone's picks are combined, so choose anything you'd happily eat. No pick means no preference.",
    empty: 'Cuisines are unavailable right now — carry on and the deck will cover everything.',
    anyLabel: 'All cuisines',
  },
};

export default function PhasePicker({ roomCode, deckKey, deckLabel, phaseState, alreadyAnswered, isHost }) {
  const [options, setOptions] = useState({ genres: [], lengths: [], cuisines: [] });
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [picked, setPicked] = useState([]);
  const [submitted, setSubmitted] = useState(!!alreadyAnswered);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { phase, step, stepCount, lockedIn = [], pending = [] } = phaseState;
  const copy = PHASE_COPY[phase] || PHASE_COPY.genres;

  // Every phase's options arrive together, so a multi-phase run survives the phase
  // change and the later steps render with no fetch and no flicker. The server sends
  // only the lists this deck's phases actually use — a TV room gets genres and no
  // runtimes, since it has no length phase.
  useEffect(() => {
    fetch(`/api/deck-options?deck=${encodeURIComponent(deckKey)}`)
      .then((r) => r.json())
      .then((o) => setOptions({ genres: o.genres || [], lengths: o.lengths || [], cuisines: o.cuisines || [] }))
      .catch(() => setOptions({ genres: [], lengths: [], cuisines: [] })) // the round still works, unfiltered
      .finally(() => setLoadingOptions(false));
  }, [deckKey]);

  // A new phase is a fresh question: drop the previous answer rather than carry a
  // stale selection (or a stale "you're locked in") into it. The exception is someone
  // who's just reconnected — the server already has their answer to this phase, so they
  // land on the waiting message instead of being asked it a second time. Their chips
  // aren't restored, since the answer is in and no longer editable.
  useEffect(() => {
    setPicked([]);
    setSubmitted(!!alreadyAnswered);
    setError('');
  }, [phase, alreadyAnswered]);

  // Each phase's options arrive in their own shape, so each gets its own mapping to the
  // one { key, label, hint } the chips render from.
  const CHOICES = {
    genres: () => options.genres.map((g) => ({ key: g.id, label: g.name })),
    length: () => options.lengths.map((l) => ({ key: l.key, label: `${l.emoji} ${l.label}`, hint: l.hint })),
    cuisines: () => options.cuisines.map((c) => ({ key: c.key, label: `${c.emoji} ${c.label}` })),
  };
  const choices = (CHOICES[phase] || CHOICES.genres)();

  function toggle(key) {
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function handleLockIn() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await submitPicks(phase, picked);
      // The server rejects an answer to a phase that has already closed; showing that
      // rather than a silent no-op keeps a slow tap from looking like a lost click.
      if (res?.error) return setError(res.error);
      setSubmitted(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleSkip() {
    const res = await advancePhase();
    if (res?.error) setError(res.error);
  }

  return (
    <Box component="section" className="screen phase-screen">
      <Paper className="phase-box">
        <Typography variant="overline" color="text.secondary">
          {deckLabel} · Room {roomCode}
        </Typography>
        {/* A one-phase deck (TV) has no sequence to track — "Step 1 of 1" and a bar
            that starts full are noise, so both only appear for a real multi-step run. */}
        {stepCount > 1 && (
          <>
            <Typography className="phase-step" variant="body2" color="text.secondary">
              Step {step} of {stepCount}
            </Typography>
            <LinearProgress
              className="phase-progress"
              variant="determinate"
              value={(step / stepCount) * 100}
            />
          </>
        )}

        <Typography component="h2" className="phase-title">{copy.title}</Typography>
        <Typography className="phase-blurb" variant="body2" color="text.secondary">
          {copy.blurb}
        </Typography>

        {loadingOptions ? (
          <Box className="phase-loading"><CircularProgress size={22} /></Box>
        ) : choices.length ? (
          <Box className="phase-chips">
            <Chip
              label={copy.anyLabel}
              clickable
              disabled={submitted}
              color={picked.length === 0 ? 'primary' : 'default'}
              variant={picked.length === 0 ? 'filled' : 'outlined'}
              onClick={() => setPicked([])}
            />
            {choices.map((c) => (
              <Chip
                key={c.key}
                label={c.hint ? `${c.label} · ${c.hint}` : c.label}
                clickable
                disabled={submitted}
                color={picked.includes(c.key) ? 'primary' : 'default'}
                variant={picked.includes(c.key) ? 'filled' : 'outlined'}
                onClick={() => toggle(c.key)}
              />
            ))}
          </Box>
        ) : (
          <Typography className="phase-blurb" variant="body2" color="text.secondary">
            {copy.empty}
          </Typography>
        )}

        {submitted ? (
          <Typography className="phase-wait" variant="body2" color="text.secondary">
            {pending.length ? `Waiting on: ${pending.join(', ')}` : 'Everyone is in — building the deck…'}
          </Typography>
        ) : (
          <Button
            variant="contained"
            fullWidth
            disabled={busy}
            onClick={handleLockIn}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {picked.length ? `Lock in ${picked.length}` : 'Lock in — no preference'}
          </Button>
        )}

        {lockedIn.length > 0 && (
          <Typography className="phase-locked" variant="caption" color="text.secondary">
            Locked in: {lockedIn.join(', ')}
          </Typography>
        )}

        {isHost && pending.length > 0 && (
          <Button className="phase-skip" size="small" color="secondary" onClick={handleSkip}>
            Skip ahead without {pending.join(', ')}
          </Button>
        )}

        {error && (
          <Typography className="phase-wait" variant="body2" color="error">{error}</Typography>
        )}
      </Paper>
    </Box>
  );
}
