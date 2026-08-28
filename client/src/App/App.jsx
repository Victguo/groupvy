import { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import Home from '../components/Home/Home.jsx';
import Lobby from '../components/Lobby/Lobby.jsx';
import PhasePicker from '../components/PhasePicker/PhasePicker.jsx';
import SwipeScreen from '../components/SwipeScreen/SwipeScreen.jsx';
import ResultsScreen from '../components/ResultsScreen/ResultsScreen.jsx';
import MatchToast from '../components/MatchToast/MatchToast.jsx';
import {
  clearSession,
  loadSession,
  playerId,
  resumeSession,
  saveSession,
  socket,
  startGame,
} from '../socket.js';
import './App.scss';

// What this tab was doing before it reloaded, read once so the first render already knows
// whether to show the home screen or a "reconnecting" splash.
const storedSession = loadSession();

export default function App() {
  const [screen, setScreen] = useState(storedSession ? 'booting' : 'home');
  const [roomCode, setRoomCode] = useState('');
  const [deckKey, setDeckKey] = useState('');
  const [deckLabel, setDeckLabel] = useState('');
  const [items, setItems] = useState([]);
  const [deckIndex, setDeckIndex] = useState(0);
  const [matches, setMatches] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [isHost, setIsHost] = useState(false);
  const [hostName, setHostName] = useState('');
  // Which selection phases this deck runs before swiping — [] for decks that go
  // straight from the lobby to the cards.
  const [phases, setPhases] = useState([]);
  // The open phase and who the room is waiting on; null outside a selection round.
  const [phaseState, setPhaseState] = useState(null);
  // Whether this player has already locked in an answer to the open phase. Only ever true
  // after a resume — the picker owns this state for a phase it saw open.
  const [phaseAnswered, setPhaseAnswered] = useState(false);
  const [minParticipants, setMinParticipants] = useState(2);
  const [waitingText, setWaitingText] = useState('');
  const [toastItem, setToastItem] = useState(null);

  // Mirrored in refs so the socket listeners (subscribed once) always see current values.
  const itemsRef = useRef(items);
  const deckIndexRef = useRef(deckIndex);
  const toastTimeoutRef = useRef(null);
  // The room to reclaim if the connection drops and comes back. Kept in a ref because the
  // 'connect' listener is subscribed once and would otherwise close over a stale code.
  const roomCodeRef = useRef(storedSession?.code || '');
  const screenRef = useRef(screen);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { deckIndexRef.current = deckIndex; }, [deckIndex]);
  useEffect(() => { screenRef.current = screen; }, [screen]);

  useEffect(() => {
    // The one path back into a room, used for both a page load and a dropped connection —
    // socket.io fires 'connect' for each, and the room code is the only thing that differs
    // between "we were in a room" and "we weren't".
    async function onConnect() {
      const code = roomCodeRef.current;
      if (!code) return;
      const res = await resumeSession(code);
      if (res?.error) {
        clearSession();
        roomCodeRef.current = '';
        setScreen('home');
        return;
      }
      handleJoined(res);
    }

    function onRoomUpdate(summary) {
      setParticipants(summary.participants);
      // Recomputed on every update rather than latched at join, so a promotion after
      // the original host disconnects reaches the new host's UI.
      setIsHost(summary.hostId === playerId);
      setHostName(summary.hostName || '');
      if (summary.minParticipants) setMinParticipants(summary.minParticipants);
      if (summary.phases) setPhases(summary.phases);
    }
    // A phase opening (or the next one starting) moves everyone onto the picker at the
    // same moment, the same way game-started moves everyone onto the cards.
    function onPhaseChanged(state) {
      setPhaseState(state);
      setPhaseAnswered(false); // a new phase is a fresh question, not one we've answered
      setScreen('phase');
    }
    // Someone locked in or joined mid-phase — same phase, new roster.
    function onPhaseUpdate(state) {
      setPhaseState(state);
    }
    // The one path to the swipe screen — the host takes it too, via the server's
    // broadcast, so everyone transitions on the same event rather than the creator
    // short-circuiting locally.
    function onGameStarted() {
      setPhaseState(null);
      setScreen('swipe');
    }
    // The deck arriving once the last selection phase closes — sent just before
    // game-started so the swipe screen never renders a frame with no cards.
    function onDeckUpdate({ items: nextItems }) {
      setItems(nextItems);
    }
    function onMatch(item) {
      setMatches((prev) => [...prev, item]);
      setToastItem(item);
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => setToastItem(null), 2200);
    }
    function onProgress({ progress, everyoneDone }) {
      if (everyoneDone) {
        setScreen('results');
        return;
      }
      if (deckIndexRef.current >= itemsRef.current.length) {
        const waiting = Object.entries(progress)
          .filter(([, n]) => n < itemsRef.current.length)
          .map(([n]) => n);
        setWaitingText(waiting.length ? `Waiting on: ${waiting.join(', ')}` : '');
      }
    }

    socket.on('connect', onConnect);
    // Already connected by the time this effect runs (a fast handshake, or React's
    // dev-mode remount) — 'connect' won't fire again, so the resume has to be kicked off
    // here or a reload would sit on the splash forever.
    if (socket.connected) onConnect();
    socket.on('room-update', onRoomUpdate);
    socket.on('deck-update', onDeckUpdate);
    socket.on('phase-changed', onPhaseChanged);
    socket.on('phase-update', onPhaseUpdate);
    socket.on('game-started', onGameStarted);
    socket.on('match', onMatch);
    socket.on('progress-update', onProgress);
    return () => {
      socket.off('connect', onConnect);
      socket.off('room-update', onRoomUpdate);
      socket.off('deck-update', onDeckUpdate);
      socket.off('phase-changed', onPhaseChanged);
      socket.off('phase-update', onPhaseUpdate);
      socket.off('game-started', onGameStarted);
      socket.off('match', onMatch);
      socket.off('progress-update', onProgress);
      clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  // Applies a create, join or resume ack — the server sends the same shape for all three,
  // so coming back from a refresh takes exactly the code path a fresh join does.
  function handleJoined(res) {
    setRoomCode(res.code);
    roomCodeRef.current = res.code;
    // Remembered so the next page load knows there's something to come back to. Cleared
    // when the round is over, so a restart doesn't drop us into a finished room.
    saveSession({ code: res.code, name: res.name });
    setDeckKey(res.deckKey || '');
    setDeckLabel(res.deckLabel);
    setItems(res.items);
    // The server's count of what this player has already swiped through — 0 on a fresh
    // join, and on a resume the card they were looking at when they dropped.
    setDeckIndex(res.deckIndex || 0);
    setMatches(res.matches || []);
    setWaitingText('');
    setIsHost(!!res.isHost);
    setPhaseState(res.phaseState || null);
    setPhaseAnswered(!!res.phaseAnswered);
    if (res.minParticipants) setMinParticipants(res.minParticipants);
    // Joining something already in progress: skip the lobby, since the broadcast that
    // would have moved us on (game-started, or phase-changed) has already been sent.
    // A reconnect that lands while we're reading the results stays put — the round is
    // over for us, and the server has no separate "finished" state to report.
    if (screenRef.current === 'results') return;
    if (res.started) setScreen('swipe');
    else if (res.phaseState) setScreen('phase');
    else setScreen('lobby');
  }

  function handleAdvance() {
    setDeckIndex((i) => i + 1);
  }

  return (
    <div className="app-shell">
      {/* Reclaiming a seat after a reload. Brief — one round trip — but without it the
          app would flash the home screen before dropping you back into your room. */}
      {screen === 'booting' && (
        <Box component="section" className="screen booting-screen">
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">Reconnecting…</Typography>
        </Box>
      )}
      {screen === 'home' && <Home onJoined={handleJoined} initialName={storedSession?.name || ''} />}
      {screen === 'lobby' && (
        <Lobby
          roomCode={roomCode}
          deckLabel={deckLabel}
          participants={participants}
          isHost={isHost}
          hostName={hostName}
          minParticipants={minParticipants}
          phases={phases}
          onStart={startGame}
        />
      )}
      {screen === 'phase' && phaseState && (
        <PhasePicker
          roomCode={roomCode}
          deckKey={deckKey}
          deckLabel={deckLabel}
          phaseState={phaseState}
          alreadyAnswered={phaseAnswered}
          isHost={isHost}
        />
      )}
      {screen === 'swipe' && (
        <SwipeScreen
          roomCode={roomCode}
          items={items}
          deckIndex={deckIndex}
          matchCount={matches.length}
          waitingText={waitingText}
          onAdvance={handleAdvance}
        />
      )}
      {screen === 'results' && (
        // Forget the room before reloading, or the resume on the way back up would drop
        // us straight into the round we just finished instead of the home screen.
        <ResultsScreen
          matches={matches}
          onRestart={() => {
            clearSession();
            window.location.reload();
          }}
        />
      )}
      <MatchToast item={toastItem} />
    </div>
  );
}
