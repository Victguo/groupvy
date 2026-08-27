import { useEffect, useState } from 'react';
import { createRoom, joinRoom } from '../socket.js';

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
    <section className="screen active">
      <div className="brand">
        <div className="brand-mark">💘</div>
        <h1>Groupvy</h1>
        <p className="tagline">Swipe with your people. Find what you all agree on.</p>
      </div>

      <div className="card panel">
        <label className="field-label">Your name</label>
        <input
          type="text"
          placeholder="e.g. Sam"
          maxLength={20}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="divider"><span>Start a new room</span></div>
        <label className="field-label">Pick a category</label>
        <div className="deck-options">
          {decksList.map((d) => (
            <div
              key={d.key}
              className={'deck-option' + (selectedDeck === d.key ? ' selected' : '')}
              onClick={() => setSelectedDeck(d.key)}
            >
              <span className="deck-emoji">{d.emoji}</span>
              <span className="deck-name">{d.label}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={handleCreate} disabled={busy}>
          Create Room
        </button>

        <div className="divider"><span>or join one</span></div>
        <input
          type="text"
          placeholder="Room code (e.g. 7XQK)"
          maxLength={4}
          autoCapitalize="characters"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="btn btn-secondary" onClick={handleJoin} disabled={busy}>
          Join Room
        </button>

        <p className="error-text">{error}</p>
      </div>
    </section>
  );
}
