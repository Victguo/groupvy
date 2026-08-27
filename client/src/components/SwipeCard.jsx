import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

// Drag/fly-off animation is done via direct style mutation (not React state) so
// dragging stays at native pointer-move speed instead of re-rendering every pixel.
const SwipeCard = forwardRef(function SwipeCard({ item, isTop, dimmed, onCommit }, ref) {
  const cardRef = useRef(null);
  const likeRef = useRef(null);
  const skipRef = useRef(null);

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

  const wrapperStyle = dimmed
    ? { transform: 'scale(0.95) translateY(10px)', opacity: 0.6, zIndex: 0 }
    : { zIndex: 1 };

  if (item.poster) {
    return (
      <div
        ref={cardRef}
        className="swipe-card has-poster"
        style={{ ...wrapperStyle, backgroundImage: `url("${item.poster}")` }}
      >
        <div ref={likeRef} className="stamp stamp-like">Like</div>
        <div ref={skipRef} className="stamp stamp-skip">Skip</div>
        <div className="poster-overlay">
          <h2 className="card-title">{item.title}</h2>
          <p className="card-subtitle">{item.subtitle}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={cardRef} className="swipe-card" style={wrapperStyle}>
      <div ref={likeRef} className="stamp stamp-like">Like</div>
      <div ref={skipRef} className="stamp stamp-skip">Skip</div>
      <div className="card-emoji">{item.emoji}</div>
      <h2 className="card-title">{item.title}</h2>
      <p className="card-subtitle">{item.subtitle}</p>
    </div>
  );
});

export default SwipeCard;
