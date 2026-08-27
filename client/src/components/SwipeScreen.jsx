import { useRef } from 'react';
import SwipeCard from './SwipeCard.jsx';
import { sendSwipe } from '../socket.js';

export default function SwipeScreen({ roomCode, items, deckIndex, matchCount, waitingText, onAdvance }) {
  const topCardRef = useRef(null);
  const done = deckIndex >= items.length;

  // Next two cards, reversed so the current (top) card renders last / on top.
  const visible = items.slice(deckIndex, deckIndex + 2).reverse();

  function handleCommit(item, liked) {
    sendSwipe(item.id, liked);
    setTimeout(onAdvance, 200);
  }

  return (
    <section className="screen active">
      <header className="swipe-header">
        <div className="room-pill">Room <strong>{roomCode}</strong></div>
        <div className="progress-pill">{matchCount === 1 ? '1 match' : `${matchCount} matches`}</div>
      </header>

      <div className="card-stack">
        {done ? (
          <div className="empty-deck">
            You've swiped through the whole deck.<br />
            Waiting for everyone else to finish…
          </div>
        ) : (
          visible.map((item, i) => {
            const isTop = i === visible.length - 1;
            return (
              <SwipeCard
                key={item.id}
                ref={isTop ? topCardRef : null}
                item={item}
                isTop={isTop}
                dimmed={!isTop}
                onCommit={handleCommit}
              />
            );
          })
        )}
      </div>

      <div className="swipe-controls">
        <button
          className="round-btn skip-btn"
          aria-label="Skip"
          disabled={done}
          onClick={() => topCardRef.current?.swipe(false)}
        >
          ✖
        </button>
        <button
          className="round-btn like-btn"
          aria-label="Like"
          disabled={done}
          onClick={() => topCardRef.current?.swipe(true)}
        >
          ❤
        </button>
      </div>

      <p className="waiting-text">{waitingText}</p>
    </section>
  );
}
