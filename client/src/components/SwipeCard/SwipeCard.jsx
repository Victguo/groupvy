import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import './SwipeCard.scss';

// Two-layer structure: the outer .card-slot owns the dimmed<->top promotion animation
// (scale/opacity/z-index, plain CSS transition), and the inner .swipe-card (cardRef) is
// the drag target, carrying only the drag/fly-off transform. Keeping them on separate
// elements means starting a drag never has to interrupt or fight the promotion
// animation — cardRef's own transform is always identity at rest, so disabling its
// transition on mousedown has nothing to snap.
//
// Drag/fly-off animation is done via direct style mutation (not React state) so
// dragging stays at native pointer-move speed instead of re-rendering every pixel.
const SwipeCard = forwardRef(function SwipeCard({ item, isTop, dimmed, onCommit }, ref) {
  const cardRef = useRef(null);
  const likeRef = useRef(null);
  const skipRef = useRef(null);
  // True once the current pointer gesture has moved past the tap threshold — lets the
  // photo-zone click handler tell "tap to change photo" apart from "drag to swipe".
  const draggedRef = useRef(false);

  const images = item.images?.length ? item.images : item.poster ? [item.poster] : [];
  const [photoIndex, setPhotoIndex] = useState(0);

  function showNextPhoto(delta) {
    if (draggedRef.current || images.length <= 1) return;
    setPhotoIndex((i) => Math.max(0, Math.min(images.length - 1, i + delta)));
  }

  const fly = useCallback(
    (liked) => {
      const card = cardRef.current;
      if (!card) return;
      card.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
      const flyX = liked ? 600 : -600;
      card.style.transform = `translate(${flyX}px, -40px) rotate(${liked ? 30 : -30}deg)`;
      card.style.opacity = '0';
      onCommit(item, liked);
    },
    [item, onCommit]
  );

  useImperativeHandle(ref, () => ({ swipe: fly }), [fly]);

  useEffect(() => {
    if (!isTop) return undefined;
    const card = cardRef.current;
    let dragging = false;
    let startX = 0, startY = 0, dx = 0, dy = 0;

    function onDown(e) {
      dragging = true;
      draggedRef.current = false;
      card.style.transition = 'none';
      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX;
      startY = p.clientY;
    }
    function onMove(e) {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      dx = p.clientX - startX;
      dy = p.clientY - startY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) draggedRef.current = true;
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 12}deg)`;
      likeRef.current.style.opacity = Math.max(0, Math.min(1, dx / 80));
      skipRef.current.style.opacity = Math.max(0, Math.min(1, -dx / 80));
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      card.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
      if (dx > 100) {
        fly(true);
      } else if (dx < -100) {
        fly(false);
      } else {
        card.style.transform = '';
        likeRef.current.style.opacity = 0;
        skipRef.current.style.opacity = 0;
      }
      dx = 0;
      dy = 0;
    }

    card.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    card.addEventListener('touchstart', onDown, { passive: true });
    card.addEventListener('touchmove', onMove, { passive: true });
    card.addEventListener('touchend', onUp);

    return () => {
      card.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      card.removeEventListener('touchstart', onDown);
      card.removeEventListener('touchmove', onMove);
      card.removeEventListener('touchend', onUp);
    };
  }, [isTop, fly]);

  // Dimmed and top are the same size/position — the dimmed card sits fully hidden
  // directly behind the top one, so promoting it never changes its geometry and
  // there's nothing to visually "pop" or jump.
  //
  // The "dim" look is a dark scrim drawn ON TOP of the card's own (always fully
  // opaque) content, not the card's own opacity. If we faded the card's real opacity
  // instead, it would be genuinely semi-transparent for that ~250ms, letting whatever
  // is stacked directly behind it — the next card, freshly mounted at that exact
  // moment — show through underneath. The scrim fades instead, so the card itself
  // never lets anything behind it bleed through.
  const slotStyle = { zIndex: dimmed ? 0 : 1 };

  const hasImages = images.length > 0;
  const cardClassName = 'swipe-card' + (hasImages ? ' has-poster' : '');
  const cardStyle = hasImages ? { backgroundImage: `url("${images[photoIndex]}")` } : undefined;

  return (
    <Box className="card-slot" style={slotStyle}>
      <Paper ref={cardRef} className={cardClassName} style={cardStyle}>
        {isTop && images.length > 1 && (
          <Box className="photo-progress">
            {images.map((_, i) => (
              <Box key={i} className={'photo-segment' + (i <= photoIndex ? ' filled' : '')} />
            ))}
          </Box>
        )}
        {isTop && images.length > 1 && (
          <>
            <Box className="photo-zone photo-zone-left" onClick={() => showNextPhoto(-1)} />
            <Box className="photo-zone photo-zone-right" onClick={() => showNextPhoto(1)} />
          </>
        )}
        <Box ref={likeRef} className="stamp stamp-like">Like</Box>
        <Box ref={skipRef} className="stamp stamp-skip">Skip</Box>
        {hasImages ? (
          <Box className="poster-overlay">
            <Typography className="card-title" component="h2">{item.title}</Typography>
            <Typography className="card-subtitle">{item.subtitle}</Typography>
            {item.synopsis && <Typography className="card-synopsis">{item.synopsis}</Typography>}
          </Box>
        ) : (
          <>
            <Box className="card-emoji">{item.emoji}</Box>
            <Typography className="card-title" component="h2">{item.title}</Typography>
            <Typography className="card-subtitle">{item.subtitle}</Typography>
          </>
        )}
        <Box className="dim-scrim" style={{ opacity: dimmed ? 1 : 0 }} />
      </Paper>
    </Box>
  );
});

export default SwipeCard;
