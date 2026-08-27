# groupvy

Swipe with your partner or group to find something you all agree on — dinner, a movie, or weekend plans.

## How it works

1. One person creates a room, picks a category (dinner / movie / weekend activity), and gets a 4-letter room code.
2. Everyone else joins with that code from their own phone/laptop.
3. Everyone swipes right (like) or left (skip) on the same deck of cards, independently and in parallel.
4. The moment **everyone in the room** has liked the same card, it's an instant match — shown live to the whole group.
5. Once everyone finishes the deck, a results screen lists everything the group matched on.

No accounts, no database — rooms live in memory for the length of the session.

## Stack

- **Server**: Node + Express + Socket.IO (`server.js`) — owns room state, matching logic, and the TMDB integration.
- **Frontend**: React + Vite (`client/`) — talks to the server over the same Socket.IO connection and a small `/api/decks` REST endpoint.

## Run it

**Development** (hot reload on both sides):

```
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` and `/socket.io` to the Express server on port 3000, so both need to be running — `npm run dev` starts both together:

- Edit anything in `client/` → Vite hot-reloads the React app in the browser (no manual refresh).
- Edit `server.js`, `services/`, `data/`, or `.env` → `nodemon` restarts the Express/Socket.IO server automatically (see `nodemon.json`). Any connected browser tab will need to reconnect its socket, which happens automatically.

**Production** (single server, built assets):

```
npm install
npm run build
npm start
```

Then open `http://localhost:3000` (share your local network IP so others on the same wifi can join, or deploy it somewhere public).

## Movie deck: live data from TMDB

The movie category pulls real, current popular movies (with posters) from
[The Movie Database](https://www.themoviedb.org/):

1. Create a free account and grab a v3 API key at https://www.themoviedb.org/settings/api
2. Copy `.env.example` to `.env` and set `TMDB_API_KEY=your-key`
3. Restart the server

Results are cached in memory for 6 hours so rooms don't refetch on every creation.
If the key is missing or the API call fails, the app silently falls back to the
small hardcoded movie list in `data/decks.js` — the app always works, key or not.

## Dinner deck: live data from Yelp

The dinner category pulls real, current restaurants (with photos) from the
[Yelp Fusion API](https://www.yelp.com/developers/v3/manage_app):

1. Create a free account and grab an API key at https://www.yelp.com/developers/v3/manage_app
2. Copy `.env.example` to `.env` and set `YELP_API_KEY=your-key`
3. Optionally set `YELP_LOCATION` to your city (e.g. `San Francisco, CA`) — defaults to `New York, NY`
4. Restart the server

Results are cached in memory for 6 hours per location so rooms don't refetch on every
creation. If the key is missing or the API call fails, the app silently falls back to
the small hardcoded dinner list in `data/decks.js` — the app always works, key or not.

## Notes on the current MVP

- The weekend-activity deck is still hardcoded in `data/decks.js` — same pattern as movies/dinner could be applied later.
- Yelp search location is a single global setting (`YELP_LOCATION`), not per-room — every room gets restaurants from the same city.
- State is in-memory only; restarting the server clears all rooms.
- Matching requires 2+ participants in the room.
- No reconnect/resume support if a participant refreshes mid-round.
