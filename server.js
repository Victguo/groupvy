require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const decks = require('./data/decks');
const {
  getMovieDeck,
  getTVDeck,
  getGenreOptions,
  getRuntimeOptions,
  normalizeGenreIds,
  normalizeRuntimeKeys,
} = require('./services/tmdb');
const { getFoodDeck, getCuisineOptions, normalizeCuisineKeys } = require('./services/googlePlaces');

// A round can't do anything useful below this: both the match check and `everyoneDone`
// require 2+ participants, so someone starting alone would swipe the whole deck and
// never reach the results screen.
const MIN_PARTICIPANTS = 2;

// How long a room with nobody connected sticks around before it's binned. A seat itself
// is held for the whole life of the room, but the room has to outlive a refresh for that
// to mean anything — otherwise a host reloading their own empty lobby would find the room
// deleted out from under them a millisecond earlier.
const EMPTY_ROOM_TTL_MS = 60 * 1000;

// Every fetcher takes the same options bag and picks out what it needs, so callers
// never have to know which deck cares about location, cuisines, or filters.
const liveDeckFetchers = {
  movie: ({ filters }) => getMovieDeck(filters),
  tv: ({ filters }) => getTVDeck(filters),
  dinner: ({ coords, cuisines }) => getFoodDeck(coords, cuisines),
};

async function getDeckItems(deckKey, options = {}) {
  const fetchLive = liveDeckFetchers[deckKey];
  if (fetchLive) {
    const liveItems = await fetchLive(options);
    if (liveItems && liveItems.length) return liveItems;
  }
  return decks[deckKey].items; // static fallback deck
}

// Decks that put the whole group through a selection round before any swiping, in this
// order. The deck for these is fetched only once every phase is answered, from everyone's
// answers combined.
//
// TV skips the length phase: a series' runtime is per-episode, so "under 90 minutes"
// says nothing useful about the commitment a show actually is.
const DECK_PHASES = {
  movie: ['genres', 'length'],
  tv: ['genres'],
  dinner: ['cuisines'],
};

function phasesFor(deckKey) {
  return DECK_PHASES[deckKey] || [];
}

// Each phase's answers are normalized by the same function the deck fetcher validates
// with, so a room can never record a selection the search would quietly ignore.
const PHASE_NORMALIZERS = {
  genres: normalizeGenreIds,
  length: normalizeRuntimeKeys,
  cuisines: normalizeCuisineKeys,
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'dist')));

app.get('/api/decks', (req, res) => {
  res.json(
    Object.entries(decks).map(([key, d]) => ({ key, label: d.label, emoji: d.emoji, count: d.items.length }))
  );
});

// Powers every selection phase a deck runs, in one round trip — the picker screen
// needs the next phase's options ready before the current one closes. A deck only ever
// gets the lists its own phases use, so the movie picker isn't offered TV genres and
// the TV picker isn't offered runtimes it has no phase for.
//
// `genres` comes back empty if TMDB is unconfigured or unreachable — the phase still
// runs, it just has nothing to offer, and the round falls back to the static deck as
// it always did. Cuisines are a static catalogue, so they're always there.
app.get('/api/deck-options', async (req, res) => {
  const deckKey = req.query.deck;
  if (!decks[deckKey]) return res.status(400).json({ error: 'Unknown deck' });
  const phases = phasesFor(deckKey);
  res.json({
    // Only movie and tv have TMDB phases, and both are TMDB media types, so the deck
    // key doubles as the media type here.
    genres: phases.includes('genres') ? await getGenreOptions(deckKey) : [],
    lengths: phases.includes('length') ? getRuntimeOptions() : [],
    cuisines: phases.includes('cuisines') ? getCuisineOptions() : [],
  });
});

// In-memory room store. Rooms disappear when the process restarts — fine for an MVP.
//
// Everything about a person is keyed by their `playerId` — a uuid their browser tab keeps
// in sessionStorage and sends in the socket handshake — never by socket.id. That's what
// makes a refresh survivable: the socket is thrown away and replaced, the seat isn't.
//
// rooms[code] = {
//   deckKey, items,
//   hostId,   // playerId of the creator — the only participant allowed to start the round
//   started,  // true once the round has begun; late joiners skip the lobby
//   phase,    // null outside a selection round, else the phase name everyone is answering
//   picks,    // { [phase]: { playerId: normalized answer | null } } — null means no preference
//   filters,  // { genres, lengths, cuisines } — each phase's answers unioned, once it closes
//   coords,   // room creator's location, so the restaurant search runs where they are
//   participants: { playerId: { name, connected, socketId } },
//             // a disconnected participant stays here with connected: false, holding
//             // their name, swipes, position and phase answer until they come back
//   swipes: { itemId: Set<playerId> of people who liked it },
//   seenCount: { playerId: number } // how many cards that person has gotten through
//   matches: Set<itemId>,
//   reaperTimer, // set while nobody is connected; cleared the moment someone (re)joins
// }
const rooms = {};

// Who the room actually counts. A participant who has dropped off keeps their seat, but
// the room carries on without them: they don't hold up a match, a phase, or the results
// screen, and nobody is left staring at "waiting on" a name that isn't coming back.
function activeIds(room) {
  return Object.keys(room.participants).filter((id) => room.participants[id].connected);
}

// A room with nobody in it isn't deleted on the spot — that would make a solo host's
// refresh unsurvivable, since their reload lands after their old socket has closed.
function scheduleReap(code) {
  const room = rooms[code];
  if (!room || activeIds(room).length) return;
  clearTimeout(room.reaperTimer);
  room.reaperTimer = setTimeout(() => {
    if (rooms[code] && !activeIds(rooms[code]).length) delete rooms[code];
  }, EMPTY_ROOM_TTL_MS);
}

function cancelReap(room) {
  clearTimeout(room.reaperTimer);
  room.reaperTimer = null;
}

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
    // Objects rather than bare names: the lobby marks who has dropped off, and the
    // headcount that gates the start button has to ignore them.
    participants: Object.values(room.participants).map((p) => ({ name: p.name, connected: p.connected })),
    matchCount: room.matches.size,
    // Each client derives `isHost` by comparing hostId against its own playerId, so a
    // host promotion after a disconnect needs no special-case event — it just arrives
    // with the next room-update.
    hostId: room.hostId,
    hostName: room.participants[room.hostId]?.name || '',
    minParticipants: MIN_PARTICIPANTS, // one source of truth; avoids a drifting client copy
    phases: phasesFor(room.deckKey), // lets the lobby word its start button honestly
  };
}

// What the picker screen renders: which phase is open, where it sits in the run, and
// who the room is still waiting on. Names rather than ids — the client has no use for
// ids and no business seeing them. Only people who are actually connected: a room should
// never say it's waiting on someone whose phone went to sleep.
function phaseState(room) {
  const phases = phasesFor(room.deckKey);
  const picks = room.picks[room.phase] || {};
  const ids = activeIds(room);
  const namesOf = (list) => list.map((id) => room.participants[id].name);
  return {
    phase: room.phase,
    step: phases.indexOf(room.phase) + 1,
    stepCount: phases.length,
    lockedIn: namesOf(ids.filter((id) => id in picks)),
    pending: namesOf(ids.filter((id) => !(id in picks))),
  };
}

function everyoneAnswered(room) {
  const picks = room.picks[room.phase] || {};
  const ids = activeIds(room);
  return ids.length > 0 && ids.every((id) => id in picks);
}

// Union, not intersection: two people picking Horror and Comedy should get a deck with
// both, not the empty set. An answer of "no preference" (null) contributes nothing
// rather than wildcarding the phase open again — if one person cares and one doesn't,
// the deck follows the one who cares. Nobody caring at all leaves the phase unfiltered.
function unionPicks(picks) {
  const merged = [...new Set(Object.values(picks).flatMap((v) => v || []))];
  return merged.length ? merged : null;
}

// Closes the open phase and moves to the next, or starts the round if that was the
// last one. Both paths write room.phase before their first await, so a second caller
// (two people locking in at once, or a host skip racing the final answer) finds the
// phase already gone and does nothing.
async function advancePhase(code) {
  const room = rooms[code];
  if (!room || !room.phase) return;

  const phases = phasesFor(room.deckKey);
  const closing = room.phase;
  const answers = unionPicks(room.picks[closing] || {});
  if (closing === 'genres') room.filters.genres = answers;
  if (closing === 'length') room.filters.lengths = answers;
  if (closing === 'cuisines') room.filters.cuisines = answers;

  const next = phases[phases.indexOf(closing) + 1];
  if (next) {
    room.phase = next;
    io.to(code).emit('phase-changed', phaseState(room));
    return;
  }

  room.phase = null;
  room.started = true;
  try {
    room.items = await getDeckItems(room.deckKey, {
      coords: room.coords,
      // null when nobody expressed a preference, which is exactly what the food search
      // reads as "no cuisine narrowing" — the same contract every other phase answer has.
      cuisines: room.filters.cuisines,
      filters: room.filters,
    });
  } catch (err) {
    console.error('Deck fetch failed after selection, using fallback deck:', err.message);
    room.items = decks[room.deckKey].items;
  }
  if (!rooms[code]) return; // everyone left while the deck was being fetched

  // Deck first: a client that acts on game-started before it has cards would render an
  // empty swipe screen for a frame.
  io.to(code).emit('deck-update', { items: room.items });
  io.to(code).emit('game-started');
}

// Checks one card for a fresh match among the people actually here. Split out of the
// swipe handler so a departure — which can complete a card without anyone swiping it —
// can run the same check.
function checkMatch(code, itemId) {
  const room = rooms[code];
  const likedBy = room.swipes[itemId];
  if (!likedBy) return;
  const active = activeIds(room);
  // Checking that every active person is in the set, rather than comparing its size
  // against the headcount: a departed player's id can linger in an older swipe set, so
  // the size could exceed the number of people present and fire a match nobody agreed on.
  if (active.length >= MIN_PARTICIPANTS && active.every((id) => likedBy.has(id)) && !room.matches.has(itemId)) {
    room.matches.add(itemId);
    io.to(code).emit('match', room.items.find((i) => i.id === itemId));
  }
}

// Someone leaving can complete a card the rest of the room had already liked, with no
// swipe left to notice — so a departure re-checks every card, not just the one a swipe
// would have touched.
function recheckMatches(code) {
  const room = rooms[code];
  for (const itemId of Object.keys(room.swipes)) checkMatch(code, itemId);
}

// Tells the room how far everyone active has gotten, and whether the deck is done for all
// of them. Split out of the swipe handler so a departure — which can be what finishes the
// deck for everyone still here — can trigger the same broadcast.
function broadcastProgress(code) {
  const room = rooms[code];
  // Only the people actually here decide the end of the round. Someone who dropped off
  // keeps their progress — it counts again the moment they're back — but the room
  // doesn't stall waiting on them.
  const active = activeIds(room);
  const totalItems = room.items.length;
  const everyoneDone =
    active.length >= MIN_PARTICIPANTS && active.every((id) => (room.seenCount[id] || 0) >= totalItems);

  io.to(code).emit('progress-update', {
    progress: Object.fromEntries(active.map((id) => [room.participants[id].name, room.seenCount[id] || 0])),
    totalItems,
    everyoneDone,
  });
}

// Everything that has to happen once someone stops counting, whether they dropped off or
// walked out for good. The fate of the seat itself is the caller's business — this is
// only the fan-out: reaping an empty room, handing off the host, and letting the rest of
// the room know.
function afterDeparture(code, pid) {
  const room = rooms[code];
  if (!room) return;

  const remaining = activeIds(room);
  if (remaining.length === 0) {
    // Nobody left to tell, and no host to hand anything to — hold the room open long
    // enough for a refresh to land, then bin it.
    scheduleReap(code);
    return;
  }

  // Hand the room to someone still in it, otherwise a creator who leaves leaves a room
  // nobody is allowed to start. The promotion rides along on the room-update below, which
  // is how the new host's client learns about it. Only when someone else is actually
  // here: a host alone in their lobby keeps the room on refresh, since there's nobody to
  // promote in their place.
  if (pid === room.hostId) room.hostId = remaining[0];
  io.to(code).emit('room-update', roomSummary(room));
  // The person the room was waiting on may have been the one who just left, so a
  // departure can be what completes a phase.
  if (room.phase && everyoneAnswered(room)) {
    advancePhase(code).catch((err) => console.error('Phase advance failed:', err));
  } else if (room.phase) {
    io.to(code).emit('phase-update', phaseState(room));
  }
}

// Everything a client needs to render the room from scratch, whether it's arriving for
// the first time or coming back from a refresh. One function so the create, join and
// resume acks can't drift apart.
function sessionPayload(room, code, pid) {
  return {
    code,
    deckKey: room.deckKey,
    deckLabel: decks[room.deckKey].label,
    name: room.participants[pid].name, // a resumed client never re-prompts for it
    items: room.items,
    matches: [...room.matches].map((id) => room.items.find((i) => i.id === id)),
    // How many cards this person has already gotten through. Zero for a fresh join; on a
    // resume it's what puts them back on the card they were looking at rather than the
    // top of the deck.
    deckIndex: room.seenCount[pid] || 0,
    // Whether they've already answered the open phase. The picker's "locked in" state is
    // otherwise purely local, so without this a refresh mid-phase would ask them the same
    // question twice.
    phaseAnswered: room.phase ? pid in (room.picks[room.phase] || {}) : false,
    // Sent here as well as in room-update so the first render is already correct.
    // `started` matters most: a late joiner must skip the lobby, since the
    // game-started broadcast they'd be waiting on has already fired.
    started: room.started,
    // Non-null when the room is mid-selection: the joiner lands straight on the
    // picker instead of a lobby whose start button everyone has already pressed.
    phaseState: room.phase ? phaseState(room) : null,
    isHost: pid === room.hostId,
    minParticipants: MIN_PARTICIPANTS,
  };
}

io.on('connection', (socket) => {
  // Identity comes from the browser tab, not the connection: a reconnect is a brand new
  // socket, and everything worth keeping is keyed by this instead. A client that sends
  // nothing usable still works — it just can't be resumed, which is the old behaviour.
  const claimed = socket.handshake.auth?.playerId;
  socket.data.playerId =
    typeof claimed === 'string' && claimed.length > 0 && claimed.length <= 64
      ? claimed
      : crypto.randomUUID();

  socket.on('create-room', async ({ deckKey, name, coords }, cb) => {
    if (!decks[deckKey]) return cb({ error: 'Unknown deck' });
    const code = generateRoomCode();
    const phases = phasesFor(deckKey);
    rooms[code] = {
      deckKey,
      hostId: socket.data.playerId, // the creator; reassigned on disconnect so a room can't be orphaned
      started: false,
      phase: null,
      picks: Object.fromEntries(phases.map((p) => [p, {}])),
      filters: { genres: null, lengths: null, cuisines: null },
      // Where to search for restaurants. Captured at creation because it's the host's
      // browser that can ask for it, not the room's — the cuisine phase comes later.
      coords: coords || null,
      // A phased deck can't be fetched yet — the group hasn't chosen what goes in it.
      // advancePhase fills this in once the last phase closes.
      items: phases.length ? [] : await getDeckItems(deckKey, { coords }),
      participants: {},
      swipes: {},
      seenCount: {},
      matches: new Set(),
      reaperTimer: null,
    };
    joinRoom(socket, code, name, cb);
  });

  socket.on('join-room', ({ code, name }, cb) => {
    code = (code || '').toUpperCase().trim();
    if (!rooms[code]) return cb({ error: 'Room not found. Double-check the code.' });
    // Someone typing the code of a room they're already in — a second tab that lost its
    // stored session, say. That's a return, not a second person: giving them a fresh seat
    // would orphan their swipes and inflate the headcount everyone else is matched against.
    if (rooms[code].participants[socket.data.playerId]) return resumeSession(socket, code, cb);
    joinRoom(socket, code, name, cb);
  });

  // Reclaims an existing seat with everything still attached — name, swipes, deck
  // position, phase answer. The client asks for this on page load and after any transient
  // drop; failure just means the room is gone, and it falls back to the home screen.
  socket.on('resume-session', ({ code }, cb = () => {}) => {
    resumeSession(socket, (code || '').toUpperCase().trim(), cb);
  });

  function resumeSession(socket, code, cb) {
    const room = rooms[code];
    const pid = socket.data.playerId;
    if (!room || !room.participants[pid]) return cb({ error: 'That room has ended.' });

    cancelReap(room);
    socket.join(code);
    socket.data.code = code;
    // socketId is what tells a lingering old socket's disconnect handler that it's stale.
    Object.assign(room.participants[pid], { connected: true, socketId: socket.id });

    cb(sessionPayload(room, code, pid));
    io.to(code).emit('room-update', roomSummary(room));
    // Their name goes back on the "waiting on" list (or the "locked in" one), so
    // everyone's picker needs the new roster.
    if (room.phase) io.to(code).emit('phase-update', phaseState(room));
  }

  function joinRoom(socket, code, name, cb) {
    const room = rooms[code];
    const pid = socket.data.playerId;
    cancelReap(room);
    socket.join(code);
    socket.data.code = code;
    const displayName = (name || 'Player').trim().slice(0, 20) || 'Player';
    room.participants[pid] = { name: displayName, connected: true, socketId: socket.id };
    room.seenCount[pid] = 0;

    // The room can be hostless if whoever held it left for good before this join landed.
    // First one back in takes it, otherwise nobody could ever start the round.
    if (!room.participants[room.hostId]) room.hostId = pid;

    cb(sessionPayload(room, code, pid));

    io.to(code).emit('room-update', roomSummary(room));
    // A newcomer mid-phase is someone new to wait on, so everyone's roster needs it.
    if (room.phase) io.to(code).emit('phase-update', phaseState(room));
  }

  // Begins the round for everyone at once. Both rules are enforced here rather than
  // trusting the lobby's disabled button — a client can emit this at any time.
  socket.on('start-game', (_payload, cb = () => {}) => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room) return cb({ error: 'Room not found.' });
    if (socket.data.playerId !== room.hostId) return cb({ error: 'Only the room creator can start.' });
    if (activeIds(room).length < MIN_PARTICIPANTS) {
      return cb({ error: 'Wait for at least one more person to join.' });
    }
    if (room.started || room.phase) return cb({ ok: true }); // idempotent — a double tap is harmless

    // A phased deck doesn't go straight to swiping: the group answers each selection
    // phase first, and the deck is fetched from those answers (see advancePhase).
    const phases = phasesFor(room.deckKey);
    if (phases.length) {
      room.phase = phases[0];
      io.to(code).emit('phase-changed', phaseState(room));
      return cb({ ok: true });
    }

    room.started = true;
    io.to(code).emit('game-started');
    cb({ ok: true });
  });

  // One participant's answer to the open phase. Everyone answers before the room moves
  // on; an empty selection is a valid answer meaning "no preference".
  socket.on('submit-picks', ({ phase, value }, cb = () => {}) => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room) return cb({ error: 'Room not found.' });
    if (!room.participants[socket.data.playerId]) return cb({ error: 'You are not in this room.' });
    if (!room.phase) return cb({ error: 'There is nothing to pick right now.' });
    // A stale client answering the phase before this one would otherwise overwrite the
    // wrong bucket — and count as an answer to a question it never showed.
    if (phase !== room.phase) return cb({ error: 'That round has already moved on.' });

    room.picks[room.phase][socket.data.playerId] = PHASE_NORMALIZERS[room.phase](value);
    cb({ ok: true });

    if (everyoneAnswered(room)) advancePhase(code).catch((err) => console.error('Phase advance failed:', err));
    else io.to(code).emit('phase-update', phaseState(room));
  });

  // Host-only escape hatch: one idle person would otherwise hold the whole room in a
  // phase forever. Whoever hasn't answered is treated as having no preference.
  socket.on('advance-phase', (_payload, cb = () => {}) => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room) return cb({ error: 'Room not found.' });
    if (socket.data.playerId !== room.hostId) return cb({ error: 'Only the room creator can skip ahead.' });
    if (!room.phase) return cb({ ok: true }); // already moved on — a double tap is harmless
    advancePhase(code).catch((err) => console.error('Phase advance failed:', err));
    cb({ ok: true });
  });

  socket.on('swipe', ({ itemId, liked }) => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room) return;
    const pid = socket.data.playerId;

    room.seenCount[pid] = (room.seenCount[pid] || 0) + 1;

    if (liked) {
      if (!room.swipes[itemId]) room.swipes[itemId] = new Set();
      room.swipes[itemId].add(pid);
    }
    checkMatch(code, itemId);
    broadcastProgress(code);
  });

  // A hard departure, unlike a drop: the seat itself goes, and so does everything keyed
  // to it — their likes stop counting, their phase answer stops shaping the deck, and the
  // room shrinks around them rather than holding a place open for a resume that isn't
  // coming.
  socket.on('leave-room', (_payload, cb = () => {}) => {
    const code = socket.data.code;
    const room = rooms[code];
    socket.data.code = null; // before anything else, so a lingering disconnect is a no-op
    if (!room) return cb({ ok: true }); // already gone — a double tap is harmless
    const pid = socket.data.playerId;

    delete room.participants[pid];
    delete room.seenCount[pid];
    for (const likedBy of Object.values(room.swipes)) likedBy.delete(pid);
    for (const answers of Object.values(room.picks)) delete answers[pid];

    socket.leave(code);
    // Removing this person can complete a card the rest of the room had already liked,
    // or finish the deck for everyone still here — neither has a swipe left to notice it.
    if (room.started && !room.phase) {
      recheckMatches(code);
      broadcastProgress(code);
    }
    afterDeparture(code, pid);
    cb({ ok: true });
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room) return;
    const pid = socket.data.playerId;

    // A resumed player's old socket closes *after* the new one has bound, so without this
    // the dying socket would immediately mark someone offline who is sitting right there.
    if (room.participants[pid]?.socketId !== socket.id) return;

    // The seat stays: name, swipes, deck position and phase answer are all what a resume
    // hands back. Only the liveness flag changes.
    room.participants[pid].connected = false;
    room.participants[pid].socketId = null;

    afterDeparture(code, pid);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`groupvy running at http://localhost:${PORT}`);
});
