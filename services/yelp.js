// Pulls a live restaurant deck from Yelp (Fusion API). Falls back to null (caller
// should use the hardcoded deck) if no API key is configured or the API call fails.

const YELP_API_KEY = process.env.YELP_API_KEY;
const YELP_LOCATION = process.env.YELP_LOCATION || 'New York, NY';
const BASE = 'https://api.yelp.com/v3';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — same reasoning as the TMDB cache

let cache = { items: null, fetchedAt: 0, location: null };

async function fetchBusinessPage(offset) {
  const url = `${BASE}/businesses/search?term=restaurants&location=${encodeURIComponent(
    YELP_LOCATION
  )}&limit=50&offset=${offset}&sort_by=best_match`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${YELP_API_KEY}` } });
  if (!res.ok) throw new Error(`Yelp search fetch failed: ${res.status}`);
  return res.json();
}

async function fetchTopRestaurants() {
  // Two pages gives up to 100 results, enough variety for a swipe deck.
  const pages = await Promise.all([0, 50].map(fetchBusinessPage));

  const seen = new Set();
  const businesses = [];
  for (const page of pages) {
    for (const b of page.businesses || []) {
      if (seen.has(b.id) || !b.image_url || b.is_closed) continue;
      seen.add(b.id);
      businesses.push(b);
    }
  }

  return businesses.map((b) => ({
    id: `yelp-${b.id}`,
    title: b.name,
    subtitle:
      [b.categories?.map((c) => c.title).slice(0, 2).join(' • '), b.price].filter(Boolean).join(' • ') ||
      'Restaurant',
    poster: b.image_url,
    emoji: '🍽️',
  }));
}

async function getFoodDeck() {
  if (!YELP_API_KEY) return null;

  const isFresh = cache.items && cache.location === YELP_LOCATION && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (isFresh) return cache.items;

  try {
    const items = await fetchTopRestaurants();
    if (items.length) {
      cache = { items, fetchedAt: Date.now(), location: YELP_LOCATION };
      return items;
    }
    return cache.items || null;
  } catch (err) {
    console.error('Yelp fetch failed, using fallback deck:', err.message);
    return cache.items || null; // serve stale cache if we have it, else signal fallback
  }
}

module.exports = { getFoodDeck };
