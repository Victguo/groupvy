require('dotenv').config();

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const decks = require('./data/decks');
const { getMovieDeck } = require('./services/tmdb');
const { getFoodDeck } = require('./services/yelp');

const liveDeckFetchers = {
  movie: getMovieDeck,
  dinner: getFoodDeck,
};

async function getDeckItems(deckKey) {
  const fetchLive = liveDeckFetchers[deckKey];
  if (fetchLive) {
    const liveItems = await fetchLive();
    if (liveItems && liveItems.length) return liveItems;
  }
  return decks[deckKey].items; // static fallback deck
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'dist')));

app.get('/api/decks', (req, res) => {
  res.json(
    Object.entries(decks).map(([key, d]) => ({ key, label: d.label, emoji: d.emoji, count: d.items.length }))
  );
});

// In-memory room store. Rooms disappear when the process restarts — fine for an MVP.
// rooms[code] = {
//   deckKey, items,
//   participants: { socketId: { name } },
//   swipes: { itemId: Set<socketId> of people who liked it },
//   seenCount: { socketId: number } // how many cards that person has gotten through
//   matches: Set<itemId>
// }
const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function roomSummary(room) {
  return {
    deckKey: room.deckKey,
    deckLabel: decks[room.deckKey].label,
    participants: Object.values(room.participants).map((p) => p.name),
    matchCount: room.matches.size,
  };
}

io.on('connection', (socket) => {
  socket.on('create-room', async ({ deckKey, name }, cb) => {
    if (!decks[deckKey]) return cb({ error: 'Unknown deck' });
    const code = generateRoomCode();
    rooms[code] = {
      deckKey,
      items: await getDeckItems(deckKey),
      participants: {},
      swipes: {},
      seenCount: {},
      matches: new Set(),
    };
    joinRoom(socket, code, name, cb);
  });

  socket.on('join-room', ({ code, name }, cb) => {
    code = (code || '').toUpperCase().trim();
    if (!rooms[code]) return cb({ error: 'Room not found. Double-check the code.' });
    joinRoom(socket, code, name, cb);
  });

  function joinRoom(socket, code, name, cb) {
    const room = rooms[code];
    socket.join(code);
    socket.data.code = code;
    socket.data.name = (name || 'Player').trim().slice(0, 20) || 'Player';
    room.participants[socket.id] = { name: socket.data.name };
    room.seenCount[socket.id] = 0;

    cb({
      code,
      deckLabel: decks[room.deckKey].label,
      items: room.items,
      matches: [...room.matches].map((id) => room.items.find((i) => i.id === id)),
    });

    io.to(code).emit('room-update', roomSummary(room));
  }

  socket.on('swipe', ({ itemId, liked }) => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room) return;

    room.seenCount[socket.id] = (room.seenCount[socket.id] || 0) + 1;

    if (liked) {
      if (!room.swipes[itemId]) room.swipes[itemId] = new Set();
      room.swipes[itemId].add(socket.id);

      const totalParticipants = Object.keys(room.participants).length;
      const likedBy = room.swipes[itemId];

      if (totalParticipants >= 2 && likedBy.size === totalParticipants && !room.matches.has(itemId)) {
        room.matches.add(itemId);
        const item = room.items.find((i) => i.id === itemId);
        io.to(code).emit('match', item);
      }
    }

    const totalParticipants = Object.keys(room.participants).length;
    const totalItems = room.items.length;
    const everyoneDone = Object.values(room.seenCount).every((n) => n >= totalItems) && totalParticipants >= 2;

    io.to(code).emit('progress-update', {
      progress: Object.fromEntries(
        Object.entries(room.seenCount).map(([id, n]) => [room.participants[id]?.name, n])
      ),
      totalItems,
      everyoneDone,
    });
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room) return;
    delete room.participants[socket.id];
    delete room.seenCount[socket.id];
    if (Object.keys(room.participants).length === 0) {
      delete rooms[code];
    } else {
      io.to(code).emit('room-update', roomSummary(room));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`groupvy running at http://localhost:${PORT}`);
});
