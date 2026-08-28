// Pulls live movie/TV decks from TMDB (themoviedb.org). Falls back to null (caller
// should use the hardcoded deck) if no API key is configured or the API call fails.

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w500';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — the latest-releases list doesn't shift fast enough to refetch every room
const DECK_SIZE = 20;
const YEARS_BACK = 3;
const MAX_PAGES = 5;
const MAX_GENRES = 20; // TMDB has ~19 movie genres; a longer list is a malformed client

// Movies and TV shows use the same discover/genre shape on TMDB's API, just with
// different endpoints and field names (title vs name, release date vs air date).
const MEDIA = {
  movie: {
    discoverPath: 'discover/movie',
    genrePath: 'genre/movie/list',
    dateGteParam: 'primary_release_date.gte',
    dateLteParam: 'primary_release_date.lte',
    titleField: 'title',
    fallbackLabel: 'Movie',
    emoji: '🎬',
  },
  tv: {
    discoverPath: 'discover/tv',
    genrePath: 'genre/tv/list',
    dateGteParam: 'first_air_date.gte',
    dateLteParam: 'first_air_date.lte',
    titleField: 'name',
    fallbackLabel: 'TV Show',
    emoji: '📺',
  },
};

// What the length phase offers. The ranges are inclusive minutes and deliberately
// contiguous — every runtime lands in exactly one bucket, which is what lets
// normalizeRuntimeKeys treat "all three picked" as no filter at all.
const RUNTIME_BUCKETS = {
  short: { label: 'Short', hint: 'Under 90 min', emoji: '⚡', lte: 89 },
  standard: { label: 'Standard', hint: '90–120 min', emoji: '🎬', gte: 90, lte: 120 },
  long: { label: 'Long', hint: 'Over 2 hours', emoji: '🍿', gte: 121 },
};
const RUNTIME_BUCKET_COUNT = Object.keys(RUNTIME_BUCKETS).length;

const genreMapPromises = {}; // mediaType -> Promise<{ [genreId]: name }>

// Keyed by media type plus the filter signature, since two rooms can now ask for very
// different decks of the same media type (see deckCacheKey).
const cacheByFilters = new Map(); // key -> { items, fetchedAt }

function getGenreMap(mediaType) {
  if (!genreMapPromises[mediaType]) {
    genreMapPromises[mediaType] = fetch(`${BASE}/${MEDIA[mediaType].genrePath}?api_key=${TMDB_API_KEY}&language=en-US`)
      .then((res) => {
        if (!res.ok) throw new Error(`TMDB genre fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) => Object.fromEntries(data.genres.map((g) => [g.id, g.name])))
      .catch((err) => {
        genreMapPromises[mediaType] = null; // allow retry on next call
        throw err;
      });
  }
  return genreMapPromises[mediaType];
}

// What the client-facing genre picker renders. Returns [] rather than throwing when
// TMDB is unreachable or unconfigured: the selection phase still runs, it just has
// nothing to offer, and the deck falls back the same way it always has.
async function getGenreOptions(mediaType = 'movie') {
  if (!TMDB_API_KEY) return [];
  try {
    const map = await getGenreMap(mediaType);
    return Object.entries(map)
      .map(([id, name]) => ({ id: Number(id), name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error('TMDB genre list unavailable:', err.message);
    return [];
  }
}

function getRuntimeOptions() {
  return Object.entries(RUNTIME_BUCKETS).map(([key, b]) => ({
    key,
    label: b.label,
    hint: b.hint,
    emoji: b.emoji,
  }));
}

// null means "no narrowing" for both normalizers, so every step downstream has one
// unambiguous shape to branch on. Exported so room bookkeeping (server.js) records
// exactly what the search path will honour, with no second definition to drift.
function normalizeGenreIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return null;
  const valid = [...new Set(ids.map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
    .slice(0, MAX_GENRES);
  return valid.length ? valid : null;
}

function normalizeRuntimeKeys(keys) {
  if (!Array.isArray(keys) || !keys.length) return null;
  const valid = [...new Set(keys)].filter((k) => RUNTIME_BUCKETS[k]).sort();
  // Picking every bucket covers the whole runtime axis, so drop the filter entirely
  // rather than fan out into one request per bucket for the same set of results.
  if (!valid.length || valid.length === RUNTIME_BUCKET_COUNT) return null;
  return valid;
}

function deckCacheKey(mediaType, genreIds, runtimeKeys) {
  return `${mediaType}|g:${genreIds ? genreIds.join(',') : 'any'}|r:${runtimeKeys ? runtimeKeys.join(',') : 'any'}`;
}

// One discover query. `bucket` narrows runtime to a single contiguous range — TMDB's
// with_runtime is one range per request, which is why callers wanting several buckets
// have to make several calls.
async function fetchPopularRecent(mediaType, { genreIds = null, bucket = null, limit = DECK_SIZE } = {}) {
  const config = MEDIA[mediaType];
  const genres = await getGenreMap(mediaType);

  const today = new Date();
  const yearsAgo = new Date(today);
  yearsAgo.setFullYear(yearsAgo.getFullYear() - YEARS_BACK);

  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'en-US',
    sort_by: 'popularity.desc',
    [config.dateGteParam]: yearsAgo.toISOString().slice(0, 10),
    [config.dateLteParam]: today.toISOString().slice(0, 10),
    // Popularity alone can spike on a single-day news event for a title with
    // barely any ratings; this floor keeps the deck to titles enough people
    // have actually seen and rated.
    'vote_count.gte': '50',
    include_adult: 'false',
  });
  // `|` is TMDB's OR separator: the group's genres are unioned, so a deck built for
  // someone who wants horror and someone who wants comedy holds both, not the (usually
  // empty) set of horror-comedies.
  if (genreIds) params.set('with_genres', genreIds.join('|'));
  if (bucket?.gte) params.set('with_runtime.gte', String(bucket.gte));
  if (bucket?.lte) params.set('with_runtime.lte', String(bucket.lte));

  const seen = new Set();
  const results = [];
  let page = 1;
  while (results.length < limit && page <= MAX_PAGES) {
    const res = await fetch(`${BASE}/${config.discoverPath}?${params}&page=${page}`);
    if (!res.ok) throw new Error(`TMDB discover fetch failed: ${res.status}`);
    const data = await res.json();
    if (!data.results?.length) break;

    for (const r of data.results) {
      if (seen.has(r.id) || !r.poster_path) continue;
      seen.add(r.id);
      results.push(r);
      if (results.length >= limit) break;
    }
    page += 1;
  }

  return results.map((r) => ({
    id: `tmdb-${mediaType}-${r.id}`,
    title: r[config.titleField],
    subtitle: r.genre_ids.map((id) => genres[id]).filter(Boolean).slice(0, 2).join(' • ') || config.fallbackLabel,
    synopsis: r.overview || '',
    poster: `${IMG_BASE}${r.poster_path}`,
    emoji: config.emoji,
  }));
}

// Round-robin so a multi-bucket deck alternates lengths instead of front-loading one
// bucket — a group that asked for "short or long" should meet both early, not swipe
// through every short film before seeing a long one.
function interleave(lists) {
  const out = [];
  const seen = new Set();
  const longest = lists.reduce((n, l) => Math.max(n, l.length), 0);
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      const item = list[i];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function fetchDeckItems(mediaType, genreIds, runtimeKeys) {
  if (!runtimeKeys) return fetchPopularRecent(mediaType, { genreIds });

  const buckets = runtimeKeys.map((k) => RUNTIME_BUCKETS[k]);
  const perBucket = Math.ceil(DECK_SIZE / buckets.length);
  return Promise.all(buckets.map((bucket) => fetchPopularRecent(mediaType, { genreIds, bucket, limit: perBucket })))
    .then((lists) => interleave(lists).slice(0, DECK_SIZE));
}

// filters: { genres: [tmdbGenreId], lengths: [runtimeBucketKey] } — both optional, and
// both meaning "no narrowing" when absent or empty.
async function getDeck(mediaType, filters = {}) {
  if (!TMDB_API_KEY) return null;

  const genreIds = normalizeGenreIds(filters.genres);
  const runtimeKeys = normalizeRuntimeKeys(filters.lengths);
  const key = deckCacheKey(mediaType, genreIds, runtimeKeys);
  const cached = cacheByFilters.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.items;

  try {
    let items = await fetchDeckItems(mediaType, genreIds, runtimeKeys);
    // A narrow pick (a rare genre, or one crossed with a runtime bucket) can come back
    // empty. An unfiltered deck of real, current titles beats the hardcoded fallback
    // deck of genre names, so try that before giving up. It gets cached under the
    // filtered key — a selection with nothing behind it shouldn't re-run five requests
    // for every room that repeats it within the TTL.
    if (!items.length && (genreIds || runtimeKeys)) items = await fetchDeckItems(mediaType, null, null);
    if (items.length) {
      cacheByFilters.set(key, { items, fetchedAt: Date.now() });
      return items;
    }
    return cached?.items || null;
  } catch (err) {
    console.error(`TMDB ${mediaType} fetch failed, using fallback deck:`, err.message);
    return cached?.items || null; // serve stale cache if we have it, else signal fallback
  }
}

const getMovieDeck = (filters) => getDeck('movie', filters);
// TV has no length phase — a series' runtime is per-episode, so a runtime range says
// nothing useful about it. Dropping the field here rather than trusting it to be unset
// means a tampered client can't narrow a TV deck by a question nobody was asked.
const getTVDeck = (filters = {}) => getDeck('tv', { genres: filters?.genres });

module.exports = {
  getMovieDeck,
  getTVDeck,
  getGenreOptions,
  getRuntimeOptions,
  normalizeGenreIds,
  normalizeRuntimeKeys,
};
