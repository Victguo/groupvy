import { useEffect, useRef, useState } from 'react';
import Home from './components/Home.jsx';
import Lobby from './components/Lobby.jsx';
import SwipeScreen from './components/SwipeScreen.jsx';
import ResultsScreen from './components/ResultsScreen.jsx';
import MatchToast from './components/MatchToast.jsx';
import { socket } from './socket.js';

export default function App() {
  const [screen, setScreen] = useState('home');
  const [roomCode, setRoomCode] = useState('');
  const [deckLabel, setDeckLabel] = useState('');
  const [items, setItems] = useState([]);
  const [deckIndex, setDeckIndex] = useState(0);
  const [matches, setMatches] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [waitingText, setWaitingText] = useState('');
  const [toastItem, setToastItem] = useState(null);

  // Mirrored in refs so the socket listeners (subscribed once) always see current values.
  const itemsRef = useRef(items);
  const deckIndexRef = useRef(deckIndex);
  const toastTimeoutRef = useRef(null);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { deckIndexRef.current = deckIndex; }, [deckIndex]);

  useEffect(() => {
    function onRoomUpdate(summary) {
      setParticipants(summary.participants);
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

    socket.on('room-update', onRoomUpdate);
    socket.on('match', onMatch);
    socket.on('progress-update', onProgress);
    return () => {
      socket.off('room-update', onRoomUpdate);
      socket.off('match', onMatch);
      socket.off('progress-update', onProgress);
      clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  function handleJoined(res) {
    setRoomCode(res.code);
    setDeckLabel(res.deckLabel);
    setItems(res.items);
    setDeckIndex(0);
    setMatches(res.matches || []);
    setWaitingText('');
    setScreen('lobby');
  }

  function handleAdvance() {
    setDeckIndex((i) => i + 1);
  }

  return (
    <div id="app">
      {screen === 'home' && <Home onJoined={handleJoined} />}
      {screen === 'lobby' && (
        <Lobby
          roomCode={roomCode}
          deckLabel={deckLabel}
          participants={participants}
          onStart={() => setScreen('swipe')}
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
        <ResultsScreen matches={matches} onRestart={() => window.location.reload()} />
      )}
      <MatchToast item={toastItem} />
    </div>
  );
}
