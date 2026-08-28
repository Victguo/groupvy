import { io } from 'socket.io-client';

const PLAYER_KEY = 'groupvy.playerId';
const SESSION_KEY = 'groupvy.session';

// sessionStorage throws outright in some privacy modes, so every access is guarded — a
// browser that won't store anything should still be able to play, just without resume.
function read(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* resume is a convenience, not a requirement */
  }
}

// Who the server thinks we are, independent of any one connection. sessionStorage rather
// than localStorage deliberately: it survives a refresh and a tab restore, but a second
// tab on the same machine gets its own id, so two windows are genuinely two players.
function ensurePlayerId() {
  const existing = read(PLAYER_KEY);
  if (existing) return existing;
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  write(PLAYER_KEY, id);
  return id;
}

export const playerId = ensurePlayerId();

// The room this tab was last in, so a reload knows what to reclaim.
export function saveSession(session) {
  write(SESSION_KEY, JSON.stringify(session));
}

export function loadSession() {
  try {
    return JSON.parse(read(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
}

// Singleton connection — same origin that served the page (Vite proxies
// /socket.io to the Express server in dev; same server serves both in prod).
// The player id rides in the handshake so every socket carries it, including the ones
// socket.io makes on its own when the network drops.
export const socket = io({ auth: { playerId } });

export function createRoom(deckKey, name, coords) {
  return new Promise((resolve) => socket.emit('create-room', { deckKey, name, coords }, resolve));
}

export function joinRoom(code, name) {
  return new Promise((resolve) => socket.emit('join-room', { code, name }, resolve));
}

// Reclaims this tab's seat in a room it was already in, with its swipes, deck position
// and phase answer intact. Resolves with { error } if the room has ended, which is the
// signal to forget the stored session and go back to the home screen.
export function resumeSession(code) {
  return new Promise((resolve) => socket.emit('resume-session', { code }, resolve));
}

// Creator-only: begins the round for everyone. Resolves with { error } if the server
// rejects it (not the host, or not enough people yet).
export function startGame() {
  return new Promise((resolve) => socket.emit('start-game', {}, resolve));
}

// This participant's answer to the open selection phase. `value` is an array of genre
// ids, runtime keys or cuisine keys; empty means no preference. The phase name goes along
// so the server can reject an answer to a phase the room has already moved past.
export function submitPicks(phase, value) {
  return new Promise((resolve) => socket.emit('submit-picks', { phase, value }, resolve));
}

// Creator-only: closes the open phase without waiting on whoever hasn't answered.
export function advancePhase() {
  return new Promise((resolve) => socket.emit('advance-phase', {}, resolve));
}

export function sendSwipe(itemId, liked) {
  socket.emit('swipe', { itemId, liked });
}
