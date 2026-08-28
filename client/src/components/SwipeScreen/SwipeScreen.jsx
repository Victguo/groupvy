import { useRef } from 'react';
import { Box, Chip, Fab, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FavoriteIcon from '@mui/icons-material/Favorite';
import SwipeCard from '../SwipeCard/SwipeCard.jsx';
import { sendSwipe } from '../../socket.js';
import './SwipeScreen.scss';

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
    <Box component="section" className="screen">
      <Box component="header" className="swipe-header">
        <Chip label={<>Room <strong>{roomCode}</strong></>} />
        <Chip
          className="progress-pill"
          label={matchCount === 1 ? '1 match' : `${matchCount} matches`}
        />
      </Box>

      <Box className="card-stack">
        {done ? (
          <Box className="empty-deck">
            <Typography color="text.secondary">
              {`You've swiped through the whole deck.`}<br />
              {`Waiting for everyone else to finish…`}
            </Typography>
          </Box>
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
      </Box>

      <Box className="swipe-controls">
        <Fab
          className="skip-btn"
          size="large"
          aria-label="Skip"
          disabled={done}
          onClick={() => topCardRef.current?.swipe(false)}
        >
          <CloseIcon />
        </Fab>
        <Fab
          className="like-btn"
          size="large"
          aria-label="Like"
          disabled={done}
          onClick={() => topCardRef.current?.swipe(true)}
        >
          <FavoriteIcon />
        </Fab>
      </Box>

      <Typography className="waiting-text" variant="body2" color="text.secondary">
        {waitingText}
      </Typography>
    </Box>
  );
}
