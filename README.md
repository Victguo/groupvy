# groupvy

Swipe with your partner or group to find something you all agree on — dinner, a movie, a TV show, or weekend plans.

## How it works

1. One person creates a room, picks a category (dinner / movie / TV show / weekend activity), and gets a 4-letter room code.
2. Everyone else joins with that code from their own phone/laptop.
3. For movie, TV and dinner, the group first goes through a quick selection round together — genres and length for movies, genres for TV, cuisines for dinner — and the deck is built from everyone's answers combined.
4. Everyone swipes right (like) or left (skip) on the same deck of cards, independently and in parallel.
5. The moment **everyone in the room** has liked the same card, it's an instant match — shown live to the whole group.
6. Once everyone finishes the deck, a results screen lists everything the group matched on.

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

## Movie & TV decks: live data from TMDB

The movie and TV categories pull real, popular titles from the last 3 years (with
posters) from [The Movie Database](https://www.themoviedb.org/):

1. Create a free account and grab a v3 API key at https://www.themoviedb.org/settings/api
2. Copy `.env.example` to `.env` and set `TMDB_API_KEY=your-key`
3. Restart the server

Decks are cached in memory for 6 hours, keyed by media type *and* the selection behind
them (see below), so rooms asking for the same thing don't refetch. If the key is
missing or the API call fails, the app silently falls back to the small hardcoded
movie/TV lists in `data/decks.js` — the app always works, key or not.

### Selection phases before swiping

None of the four categories go straight from the lobby to the cards. When the host
starts a room, the whole group answers a short selection round first, each question on
its own screen:

| Category | Phases |
| --- | --- |
| Movie | 1. **Genres** → 2. **Length** — Short (under 90 min), Standard (90–120), or Long (over 2 hours) |
| TV | 1. **Genres** only |
| Dinner | 1. **Cuisines** only — see [Dinner deck](#dinner-deck-live-data-from-google-places) below |
| Weekend activity | *(no phases — deck is fixed, goes straight to swiping)* |

TV skips the length phase deliberately: a series' runtime is per-episode, so "under 90
minutes" says nothing useful about the commitment a show actually is. Each deck's
genre list is the real TMDB one *for that media type* — and they genuinely differ (TV
has Reality, Soap and Talk; movies have Horror, Romance and Thriller), so `GET
/api/deck-options?deck=movie|tv` serves whichever lists that deck's own phases use and
nothing else.

Phases all work the same way: pick as many chips as you like, or none at all for "no
preference", then lock in. The room moves on only once **everyone** has
answered — the picker shows who's locked in and who's still deciding. Anyone joining
mid-phase lands straight on the picker and is added to the list of people being waited
on. If someone goes idle, the host gets a **Skip ahead** button that closes the phase
and treats the missing answers as no preference; someone disconnecting has the same
effect, so a room can't get stuck on a person who left.

Answers are **unioned**: if one person picks Horror and another picks Comedy, the deck
holds both rather than the (usually empty) set of horror-comedies. "No preference"
contributes nothing rather than reopening the filter — if one person cares and one
doesn't, the deck follows the one who cares; if nobody picks anything, that phase simply
doesn't filter. Every phase in the app works this way, dinner's cuisines phase included.

Unlike every other category, a phased room's deck doesn't exist until its phases close
— it's fetched from the combined answers at that point, then broadcast as `deck-update`
immediately before `game-started`. Under the hood:

- Genres go to TMDB as `with_genres` with `|` (OR) separators.
- Runtime (movies only) is trickier: TMDB's `with_runtime` is a single range per
  request, so "short or long" can't be expressed in one call without dragging in
  everything between them.
  Each selected bucket gets its own request and the results are interleaved round-robin,
  so a group that asked for both meets both early instead of swiping through every
  short film first. Picking all three buckets covers the whole runtime axis, so it's
  collapsed back to no filter and a single request.
- A narrow pick can legitimately return nothing. Rather than drop to the hardcoded
  fallback deck of genre *names*, the server retries unfiltered first — real current
  titles beat placeholder cards.

`DECK_PHASES` in `server.js` is the single place that makes a deck phased (`{ movie:
['genres', 'length'], tv: ['genres'], dinner: ['cuisines'] }`) — the picker screen, the
options endpoint and the lobby's start button all read their wording and behaviour off
it, so changing a deck's phases is a one-line edit. Weekend-activity is the only category
with no phases at all, so it's the one room that still goes lobby → swipe with its (fixed,
hardcoded) deck ready from creation.

## Dinner deck: live data from Google Places

The dinner category pulls real, current restaurants (with photos) from the
[Places API (New)](https://developers.google.com/maps/documentation/places/web-service/overview):

1. Enable **Places API (New)** on a Google Cloud project — note this is the new API,
   not the legacy "Places API", which is a separate product and won't work here
2. Create an API key at https://console.cloud.google.com/google/maps-apis/credentials
3. Copy `.env.example` to `.env` and set `GOOGLE_PLACES_API_KEY=your-key`
4. Optionally set `GOOGLE_PLACES_LOCATION` as a fallback city (e.g. `San Francisco, CA`) — defaults to `Newmarket, ON`
5. Restart the server

When someone creates a dinner room, the browser asks for their location and runs a
Nearby Search around them. If they deny the permission or their browser doesn't
support it, the room falls back to a text search for `GOOGLE_PLACES_LOCATION`. The
deck is up to 15 of the most popular restaurants within 8km that have at least 10
ratings and are showing as **open right now** on Google, each with up to 3 photos you
can tap through on the card (like Tinder). A search returns at most 20 places and some
get filtered out, so a deck is often slightly shorter than 15.

"Open right now" is evaluated once, when the deck is built — not live per swipe. Since
a deck is cached for 6 hours (see below), a room created just before closing time can
still show a place that's since closed by the time someone swipes on it later in that
window.

Places are kept only if their *primary* type is a food type. Google tags a golf club
or hotel that happens to have a grill with the `restaurant` type too, so without that
check they show up as dinner suggestions. `NON_CUISINE_FOOD_TYPES` in
`services/googlePlaces.js` is the default allowlist (generic restaurants, cafés,
delis, bakeries, …); alcohol-first venues (wine bars, breweries, pubs that are really
bars) never count as dinner regardless of what the group picks. Results are cached in
memory for 6 hours per location and cuisine selection (see below) so repeat rooms
don't refetch. If the key is missing or the API call fails, the app silently falls
back to the small hardcoded dinner list in `data/decks.js` — the app always works,
key or not.

The API key stays server-side: photo links are resolved to their CDN urls when the
deck is built, so the browser only ever receives key-free image urls.

### Picking cuisines

Like movie and TV, dinner is a **phased deck**: the group answers a cuisines round
together before any swiping, instead of the host picking alone at creation. `DECK_PHASES`
in `server.js` lists it as `{ dinner: ['cuisines'] }`, so the picker screen, `/api/deck-
options?deck=dinner`, and the lobby's start button all read their wording and behaviour
off the same one-line config that drives movie and TV.

Everyone taps cuisine chips (Italian, Asian, Mediterranean, Desserts & Sweets, …) or locks
in with none selected for "no preference." The full list comes from the `cuisines` field
of `/api/deck-options`, backed by `CUISINE_CATEGORIES` in `services/googlePlaces.js` —
every Table A food type Google defines is bucketed into exactly one of 16 categories there
(cross-checked against Google's
[place types reference](https://developers.google.com/maps/documentation/places/web-service/place-types)
when this was built). Answers are **unioned**, matching how genres work: the host's
Seafood pick plus a joiner's Desserts pick becomes one deck holding both, and "no
preference" contributes nothing rather than reopening the filter — if one person cares and
one doesn't, the deck follows the one who cares.

The union changes the actual Google request, not just a post-filter: if the combined
cuisine types fit under Google's 50-type request cap (true for any real selection short of
picking nearly every category), they're sent directly as `includedTypes` for a
tightly-scoped, well-ranked search. Only an oversized selection, or nobody expressing a
preference, falls back to the same broad net dinner always had.

Desserts (`ice_cream_shop`, `bakery`, `donut_shop`, …) are just another category here, not
a special case — selectable on their own for a dessert-only round, or left out of
everyone's picks for the default broad mix.

The deck itself doesn't exist until the phase closes — same as movie and TV — fetched in
one shot from the room's location (captured from the host's browser at creation, since
that's the tab that can ask for it) and the group's combined cuisines. Being a single-step
phase, the picker skips the "Step 1 of 2" framing multi-phase decks show.

## Refreshing, dropping out, and coming back

A refresh, a locked phone or a wifi handoff doesn't cost anyone their place. Identity is a
`playerId` uuid the browser tab keeps in `sessionStorage` and sends in the Socket.IO
handshake — not the socket id, which changes every time the connection does. Everything
about a person on the server (name, likes, position in the deck, phase answer, whether
they're the host) is keyed by it, so the socket can be thrown away and replaced without
touching the seat.

On page load the client re-claims its seat with `resume-session` and lands straight back on
whatever screen the room is on, at the card it left off on — the deck position comes from
the server's own count of what that person has swiped, so it can't drift. Mid-selection,
someone who had already locked in comes back to the waiting screen rather than being asked
the same question twice. The same path runs after a transient drop, since Socket.IO
reconnects on its own and the client resumes on every `connect`.

**The room carries on without you while you're away.** Matches, the "waiting on" list and
the results screen count only people who are actually connected, so one dead phone can't
stall a round. An absent person still shows on the lobby roster, greyed out and marked
reconnecting, and their likes count again the moment they're back. That headcount rule also
means a departed player's likes can't fabricate a match — the check is that every connected
person liked the card, not that the like count reached some number.

Two consequences worth knowing:

- **`sessionStorage`, not `localStorage`, is deliberate.** A seat belongs to a browser tab,
  so two windows on one machine are genuinely two players (which is how you test this), and
  closing the tab really does end that session.
- **A room outlives the last person leaving by 60 seconds** (`EMPTY_ROOM_TTL_MS` in
  `server.js`). Without that grace a host reloading their own empty lobby would find the
  room deleted a millisecond before their new socket arrived. After it, the room is gone and
  a returning client falls back to the home screen.

## Notes on the current MVP

- The weekend-activity deck is still hardcoded in `data/decks.js` — same pattern as movies/dinner could be applied later.
- State is in-memory only; restarting the server clears all rooms.
- Matching requires 2+ participants in the room, so the creator can't start a round
  until a second person joins — otherwise they'd swipe the whole deck with no match
  ever possible and never reach the results screen. Only the creator starts, and it
  starts for everyone at once. If the creator leaves, the room is handed to someone
  still in it.
- If people drop below 2 *after* a round starts, matching and the results screen stall
  the same way — the guard covers the start only.
