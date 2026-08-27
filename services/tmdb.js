// Pulls a live movie deck from TMDB (themoviedb.org). Falls back to null (caller
// should use the hardcoded deck) if no API key is configured or the API call fails.

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w500';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — popular movies don't change fast enough to refetch every room

let genreMapPromise = null;
let cache = { items: null, fetchedAt: 0 };

function getGenreMap() {
  if (!genreMapPromise) {
    genreMapPromise = fetch(`${BASE}/genre/movie/list?api_key=${TMDB_API_KEY}&language=en-US`)
      .then((res) => {
        if (!res.ok) throw new Error(`TMDB genre fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) => Object.fromEntries(data.genres.map((g) => [g.id, g.name])))
      .catch((err) => {
        genreMapPromise = null; // allow retry on next call
        throw err;
      });
  }
  return genreMapPromise;
}

async function fetchPopularMovies() {
  const genres = await getGenreMap();

  // A couple of pages gives ~40 movies, enough variety for a swipe deck.
  const pages = await Promise.all(
    [1, 2].map((page) =>
      fetch(`${BASE}/movie/popular?api_key=${TMDB_API_KEY}&language=en-US&page=${page}`).then((res) => {
        if (!res.ok) throw new Error(`TMDB popular fetch failed: ${res.status}`);
        return res.json();
      })
    )
  );

  const seen = new Set();
  const movies = [];
  for (const page of pages) {
    for (const m of page.results) {
      if (seen.has(m.id) || !m.poster_path) continue;
      seen.add(m.id);
      movies.push(m);
    }
  }

  return movies.map((m) => ({
    id: `tmdb-${m.id}`,
    title: m.title,
    subtitle: m.genre_ids.map((id) => genres[id]).filter(Boolean).slice(0, 2).join(' • ') || 'Movie',
    poster: `${IMG_BASE}${m.poster_path}`,
    emoji: '🎬',
  }));
}

async function getMovieDeck() {
  if (!TMDB_API_KEY) return null;

  const isFresh = cache.items && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (isFresh) return cache.items;

  try {
    const items = await fetchPopularMovies();
    if (items.length) {
      cache = { items, fetchedAt: Date.now() };
      return items;
    }
    return cache.items || null;
  } catch (err) {
    console.error('TMDB fetch failed, using fallback deck:', err.message);
    return cache.items || null; // serve stale cache if we have it, else signal fallback
  }
}

module.exports = { getMovieDeck };
