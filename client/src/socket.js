import { io } from 'socket.io-client';

// Singleton connection — same origin that served the page (Vite proxies
// /socket.io to the Express server in dev; same server serves both in prod).
export const socket = io();

export function createRoom(deckKey, name) {
  return new Promise((resolve) => socket.emit('create-room', { deckKey, name }, resolve));
}

export function joinRoom(code, name) {
  return new Promise((resolve) => socket.emit('join-room', { code, name }, resolve));
}

export function sendSwipe(itemId, liked) {
  socket.emit('swipe', { itemId, liked });
}
