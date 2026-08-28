// Pulls a live restaurant deck from Google Places API (New). Falls back to null (caller
// should use the hardcoded deck) if no API key is configured or the API call fails.

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const FALLBACK_LOCATION = process.env.GOOGLE_PLACES_LOCATION || 'Newmarket, ON';
const BASE = 'https://places.googleapis.com/v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — same reasoning as the TMDB cache
const SEARCH_RADIUS_METERS = 8 * 1000; // 8km
const MIN_REVIEW_COUNT = 10;
const DECK_SIZE = 15; // a ceiling: a search returns at most 20 places, and filtering can leave fewer
const MAX_IMAGES = 3;
const PHOTO_MAX_WIDTH = 800;
const MAX_INCLUDED_TYPES = 50; // Google's per-request cap on includedTypes/excludedPrimaryTypes

// Only the fields the card actually renders. Fields are billed by tier, so adding to
// this list costs money even when the extra data goes unused.
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.photos',
  'places.userRatingCount',
  'places.priceLevel',
  'places.businessStatus',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.currentOpeningHours.openNow',
  'places.location', // Basic Data, no extra billing tier — needed to pick the closest branch of a chain
].join(',');

// A place carries many types but exactly one *primary* type. Searching for the
// `restaurant` type matches anything with a restaurant somewhere in its type list —
// which is how golf courses, hotels and sports clubs with a grill on site end up in a
// dinner deck. These are the venue primary types that most often drag one in.
// Every name here must be a real Table A type: an unknown one makes the API reject the
// whole request. Already at the 50-entry cap — if you need to add one, remove one first.
const EXCLUDED_PRIMARY_TYPES = [
  'golf_course', 'sports_club', 'sports_complex', 'sports_activity_location', 'stadium',
  'gym', 'fitness_center', 'ski_resort', 'ice_skating_rink',
  'hotel', 'motel', 'resort_hotel', 'extended_stay_hotel', 'bed_and_breakfast',
  'guest_house', 'hostel', 'inn', 'campground', 'rv_park',
  'casino', 'night_club', 'bowling_alley', 'movie_theater', 'performing_arts_theater',
  'amusement_park', 'water_park', 'zoo', 'museum', 'tourist_attraction',
  'banquet_hall', 'event_venue', 'wedding_venue', 'community_center', 'convention_center',
  'grocery_store', 'supermarket', 'convenience_store', 'department_store', 'shopping_mall',
  'liquor_store', 'market',
  'airport', 'international_airport', 'train_station',
  'hospital', 'university', 'spa', 'marina', 'park',
];

// Food types that don't fit a single named cuisine — the generic "corner restaurant",
// a deli, a sandwich shop, a cafe. These aren't cuisine categories a host would pick
// between, so they're always in the net regardless of cuisine selection: used both as
// the default (no-selection) allowlist and as the static request type list when a
// selection is too broad to enumerate (see includedTypesForRequest). Every cuisine
// variant that follows the `_restaurant` suffix pattern (sushi_restaurant,
// tonkatsu_restaurant, …) is deliberately NOT listed here — the default path catches
// those via the suffix check in isKeptType, and CUISINE_CATEGORIES below enumerates
// them explicitly for the picker.
const NON_CUISINE_FOOD_TYPES = [
  'restaurant', 'bistro', 'diner', 'steak_house', 'buffet_restaurant', 'food_court', 'cafeteria',
  'pub', 'irish_pub', 'gastropub', 'brewpub', 'bar_and_grill', 'sports_bar',
  'deli', 'noodle_shop', 'sandwich_shop', 'bagel_shop', 'kebab_shop', 'salad_shop',
  'snack_bar', 'hot_dog_stand', 'meal_takeaway', 'meal_delivery', 'pizza_delivery',
  'cafe', 'coffee_shop', 'coffee_roastery', 'coffee_stand', 'tea_house', 'cat_cafe', 'dog_cafe',
  'bakery', 'cake_shop', 'pastry_shop', 'dessert_restaurant', 'dessert_shop',
  'ice_cream_shop', 'donut_shop', 'candy_store', 'chocolate_shop', 'chocolate_factory', 'confectionery',
  'juice_shop', 'acai_shop',
];
const NON_CUISINE_FOOD_TYPES_SET = new Set(NON_CUISINE_FOOD_TYPES);

// What a host can filter the dinner deck to. Every Table A food type is bucketed into
// exactly one of these (see the exhaustive walk-through in the PR/commit that added
// this — cross-check against Google's place-types reference before adding a new Table
// A type here). Deliberately left out entirely: bar, cocktail_bar, wine_bar, winery,
// brewery, beer_garden, hookah_bar, lounge_bar — alcohol-first venues rather than
// dinner options, same call as the businessStatus/openNow filters below.
const CUISINE_CATEGORIES = {
  american: {
    label: 'American',
    emoji: '🍔',
    types: [
      'american_restaurant', 'hamburger_restaurant', 'barbecue_restaurant', 'steak_house', 'diner',
      'southwestern_us_restaurant', 'soul_food_restaurant', 'tex_mex_restaurant', 'cajun_restaurant',
      'hawaiian_restaurant', 'californian_restaurant', 'western_restaurant', 'family_restaurant',
      'fine_dining_restaurant', 'chicken_restaurant', 'chicken_wings_restaurant', 'hot_dog_restaurant',
      'hot_dog_stand', 'fast_food_restaurant',
    ],
  },
  italian: { label: 'Italian & Pizza', emoji: '🍝', types: ['italian_restaurant', 'pizza_restaurant', 'pizza_delivery'] },
  asian: {
    label: 'Asian',
    emoji: '🥢',
    types: [
      'asian_restaurant', 'asian_fusion_restaurant', 'fusion_restaurant', 'chinese_restaurant',
      'chinese_noodle_restaurant', 'cantonese_restaurant', 'dim_sum_restaurant', 'dumpling_restaurant',
      'hot_pot_restaurant', 'japanese_restaurant', 'japanese_curry_restaurant', 'japanese_izakaya_restaurant',
      'sushi_restaurant', 'tonkatsu_restaurant', 'yakiniku_restaurant', 'yakitori_restaurant',
      'ramen_restaurant', 'korean_restaurant', 'korean_barbecue_restaurant', 'thai_restaurant',
      'vietnamese_restaurant', 'indonesian_restaurant', 'malaysian_restaurant', 'filipino_restaurant',
      'taiwanese_restaurant', 'mongolian_barbecue_restaurant', 'cambodian_restaurant', 'burmese_restaurant',
      'tibetan_restaurant', 'noodle_shop', 'soup_restaurant',
    ],
  },
  mexican_latin: {
    label: 'Mexican & Latin American',
    emoji: '🌮',
    types: [
      'mexican_restaurant', 'taco_restaurant', 'burrito_restaurant', 'latin_american_restaurant',
      'south_american_restaurant', 'argentinian_restaurant', 'brazilian_restaurant', 'peruvian_restaurant',
      'colombian_restaurant', 'cuban_restaurant', 'chilean_restaurant', 'caribbean_restaurant',
    ],
  },
  indian_south_asian: {
    label: 'Indian & South Asian',
    emoji: '🍛',
    types: [
      'indian_restaurant', 'north_indian_restaurant', 'south_indian_restaurant', 'pakistani_restaurant',
      'bangladeshi_restaurant', 'sri_lankan_restaurant', 'afghani_restaurant',
    ],
  },
  mediterranean_middle_eastern: {
    label: 'Mediterranean & Middle Eastern',
    emoji: '🥙',
    types: [
      'mediterranean_restaurant', 'middle_eastern_restaurant', 'greek_restaurant', 'turkish_restaurant',
      'lebanese_restaurant', 'israeli_restaurant', 'persian_restaurant', 'moroccan_restaurant',
      'shawarma_restaurant', 'falafel_restaurant', 'kebab_shop', 'gyro_restaurant', 'halal_restaurant',
    ],
  },
  european: {
    label: 'European',
    emoji: '🥐',
    types: [
      'french_restaurant', 'spanish_restaurant', 'tapas_restaurant', 'german_restaurant', 'bavarian_restaurant',
      'british_restaurant', 'irish_restaurant', 'portuguese_restaurant', 'polish_restaurant', 'russian_restaurant',
      'ukrainian_restaurant', 'hungarian_restaurant', 'czech_restaurant', 'austrian_restaurant', 'swiss_restaurant',
      'belgian_restaurant', 'dutch_restaurant', 'scandinavian_restaurant', 'danish_restaurant', 'croatian_restaurant',
      'romanian_restaurant', 'eastern_european_restaurant', 'european_restaurant', 'bistro', 'basque_restaurant',
      'fondue_restaurant', 'australian_restaurant',
    ],
  },
  african: { label: 'African', emoji: '🍲', types: ['african_restaurant', 'ethiopian_restaurant'] },
  seafood: { label: 'Seafood', emoji: '🦐', types: ['seafood_restaurant', 'oyster_bar_restaurant', 'fish_and_chips_restaurant'] },
  pubs_bar_food: {
    label: 'Pub & Bar Food',
    emoji: '🍺',
    types: ['pub', 'irish_pub', 'gastropub', 'brewpub', 'bar_and_grill', 'sports_bar'],
  },
  fast_casual: {
    label: 'Fast Food & Casual',
    emoji: '🥪',
    types: ['sandwich_shop', 'deli', 'salad_shop', 'snack_bar', 'buffet_restaurant', 'cafeteria', 'food_court', 'meal_takeaway', 'meal_delivery'],
  },
  vegetarian_vegan: { label: 'Vegetarian & Vegan', emoji: '🥗', types: ['vegetarian_restaurant', 'vegan_restaurant'] },
  breakfast_brunch: { label: 'Breakfast & Brunch', emoji: '🥞', types: ['breakfast_restaurant', 'brunch_restaurant'] },
  cafes: {
    label: 'Cafés & Coffee',
    emoji: '☕',
    types: ['cafe', 'coffee_shop', 'coffee_roastery', 'coffee_stand', 'tea_house', 'cat_cafe', 'dog_cafe', 'bagel_shop'],
  },
  desserts: {
    label: 'Desserts & Sweets',
    emoji: '🍰',
    types: [
      'bakery', 'cake_shop', 'pastry_shop', 'dessert_restaurant', 'dessert_shop', 'ice_cream_shop',
      'donut_shop', 'candy_store', 'chocolate_shop', 'chocolate_factory', 'confectionery', 'juice_shop', 'acai_shop',
    ],
  },
  other: { label: 'Other', emoji: '🍽️', types: ['restaurant'] },
};

const PRICE_LABELS = {
  PRICE_LEVEL_FREE: '',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
};

// What the client-facing cuisine picker renders — key/label/emoji only. The Google
// type names underneath stay server-side; the client only ever sends keys back.
function getCuisineOptions() {
  return Object.entries(CUISINE_CATEGORIES).map(([key, c]) => ({ key, label: c.label, emoji: c.emoji }));
}

// Keeps only keys the host could actually have picked (guards against a stale/tampered
// client sending an unknown key straight into the Places request). Returns null for
// "no selection" so every step downstream can treat null as one unambiguous case: use
// the full food-type net, no cuisine narrowing.
function validCategoryKeys(cuisineKeys) {
  if (!Array.isArray(cuisineKeys) || !cuisineKeys.length) return null;
  const valid = [...new Set(cuisineKeys)].filter((k) => CUISINE_CATEGORIES[k]);
  return valid.length ? valid : null;
}

// Exported so room bookkeeping (server.js) validates selections exactly the way the
// search path does — one definition of "which keys are real", no drift.
function normalizeCuisineKeys(cuisineKeys) {
  const valid = validCategoryKeys(cuisineKeys);
  return valid ? [...valid].sort() : null;
}

// null keys -> null (no cuisine narrowing, use the default allowlist in isKeptType).
function allowedTypesForKeys(validKeys) {
  return validKeys ? new Set(validKeys.flatMap((k) => CUISINE_CATEGORIES[k].types)) : null;
}

function isKeptType(primaryType, allowedTypes) {
  if (!primaryType) return false; // no primary type means we can't vouch for it
  if (!allowedTypes) return primaryType.endsWith('_restaurant') || NON_CUISINE_FOOD_TYPES_SET.has(primaryType);
  return allowedTypes.has(primaryType);
}

// Haversine distance in meters — good enough for ranking branches of the same chain
// against each other, no need for anything more precise at this scale.
function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Same chain (e.g. multiple McDonald's) shows up as multiple search results with the
// same display name. Collapse each chain down to one card — the branch closest to the
// searcher — so the deck isn't dominated by repeats of the same restaurant. Places
// keeps its first-seen (best search-ranked) branch when there's no coords to measure
// distance from (the text-search fallback path has no geographic center to compare
// against).
function dedupeChains(places, coords) {
  const bestByName = new Map();
  for (const place of places) {
    const name = (place.displayName?.text || '').trim().toLowerCase();
    if (!name) continue;
    const existing = bestByName.get(name);
    if (!existing) {
      bestByName.set(name, place);
      continue;
    }
    if (coords && place.location && existing.location) {
      const existingDist = distanceMeters(coords, existing.location);
      const candidateDist = distanceMeters(coords, place.location);
      if (candidateDist < existingDist) bestByName.set(name, place);
    }
  }
  return [...bestByName.values()];
}

// Nearby/Text Search's includedTypes is capped at 50 entries. A host's selection is
// almost always well under that (one category tops out around 30 types), so send it
// straight through for a tightly-scoped, well-ranked search. Only fall back to the
// static broad net if there's no selection, or an unlikely huge combined selection
// blows the cap — the client-side isKeptType() filter still narrows correctly either
// way, this only affects how relevant the raw search results are.
function includedTypesForRequest(allowedTypes) {
  if (allowedTypes && allowedTypes.size <= MAX_INCLUDED_TYPES) return [...allowedTypes];
  return NON_CUISINE_FOOD_TYPES;
}

// Text Search takes one freeform query, not a type list, so a cuisine selection can
// only steer it through wording — mention the chosen categories by name so Google's
// own relevance ranking favors them. isKeptType() still enforces the selection exactly
// once results come back.
function buildTextQuery(validKeys) {
  if (!validKeys) return `restaurants, cafes and bakeries in ${FALLBACK_LOCATION}`;
  const labels = validKeys.map((k) => CUISINE_CATEGORIES[k].label);
  return `${labels.join(', ')} in ${FALLBACK_LOCATION}`;
}

// Keyed by a location + cuisine-selection signature (see locationKey) since different
// rooms can now search different places and different cuisines.
const cacheByLocation = new Map(); // key -> { items, fetchedAt }

// Rounding to ~2 decimal places (~1km) keeps nearby room creators sharing a cache entry
// instead of each triggering a fresh Places call.
function locationKey(coords, validKeys) {
  const base = coords ? `geo:${coords.latitude.toFixed(2)},${coords.longitude.toFixed(2)}` : `text:${FALLBACK_LOCATION}`;
  return validKeys ? `${base}|c:${[...validKeys].sort().join(',')}` : base;
}

function searchRequest(path, body) {
  return fetch(`${BASE}/places:${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
}

// Nearby Search restricts results to the circle, so the "within 8km" promise actually
// holds. It has no text-location form though, so the no-geolocation fallback goes
// through Text Search instead — both return the same `places[]` shape.
async function fetchPlaces(coords, allowedTypes, validKeys) {
  const res = coords
    ? await searchRequest('searchNearby', {
        locationRestriction: {
          circle: {
            center: { latitude: coords.latitude, longitude: coords.longitude },
            radius: SEARCH_RADIUS_METERS,
          },
        },
        includedTypes: includedTypesForRequest(allowedTypes),
        excludedPrimaryTypes: EXCLUDED_PRIMARY_TYPES,
        maxResultCount: 20,
        rankPreference: 'POPULARITY',
      })
    : await searchRequest('searchText', {
        // No includedType here: Text Search only accepts a single type, which would
        // shut out all but one category. Query wording plus isKeptType() do the
        // filtering on this path instead.
        textQuery: buildTextQuery(validKeys),
        maxResultCount: 20,
      });

  if (!res.ok) throw new Error(`Google Places search failed: ${res.status}`);
  const data = await res.json();
  return data.places || [];
}

// A photo resource `name` is short-lived and must not be cached, so we resolve it to a
// CDN url at deck-build time. skipHttpRedirect returns that url as JSON instead of
// 302-ing to the image. The resolved url carries no key, which is how the client gets
// photos without GOOGLE_PLACES_API_KEY ever reaching the browser.
async function resolvePhotoUrl(photoName) {
  const params = new URLSearchParams({
    maxWidthPx: String(PHOTO_MAX_WIDTH),
    skipHttpRedirect: 'true',
    key: GOOGLE_PLACES_API_KEY,
  });
  const res = await fetch(`${BASE}/${photoName}/media?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.photoUri || null;
}

async function fetchPlaceImages(place) {
  const names = place.photos.slice(0, MAX_IMAGES).map((p) => p.name);
  const urls = await Promise.all(names.map(resolvePhotoUrl));
  return urls.filter(Boolean);
}

async function fetchTopRestaurants(coords, validKeys) {
  const allowedTypes = allowedTypesForKeys(validKeys);
  const filtered = (await fetchPlaces(coords, allowedTypes, validKeys)).filter(
    (p) =>
      isKeptType(p.primaryType, allowedTypes) &&
      p.photos?.length &&
      p.businessStatus === 'OPERATIONAL' &&
      // businessStatus only rules out permanently/temporarily closed businesses, not
      // "closed for the night" — this is what actually matches Google's "Open" badge.
      // A place with no hours data on file also gets no "Open" badge on Google, so
      // it's excluded here too rather than let it through on a false positive.
      p.currentOpeningHours?.openNow === true &&
      (p.userRatingCount || 0) >= MIN_REVIEW_COUNT
  );
  const places = dedupeChains(filtered, coords);

  // The search already ranks the page; take the top DECK_SIZE that survived filtering.
  const top = places.slice(0, DECK_SIZE);
  const imagesByPlace = await Promise.all(top.map(fetchPlaceImages));

  // A place whose photos all failed to resolve would render as a blank card, so drop it.
  return top
    .map((p, i) => ({ place: p, images: imagesByPlace[i] }))
    .filter(({ images }) => images.length)
    .map(({ place, images }) => ({
      id: `gplace-${place.id}`,
      title: place.displayName?.text || 'Restaurant',
      subtitle:
        [place.primaryTypeDisplayName?.text, PRICE_LABELS[place.priceLevel]]
          .filter(Boolean)
          .join(' • ') || 'Restaurant',
      images,
      poster: images[0], // kept for components that only render a single image
      emoji: '🍽️',
    }));
}

// coords: optional { latitude, longitude } of the room creator. Falls back to the
// fixed GOOGLE_PLACES_LOCATION env var when omitted or invalid.
// cuisineKeys: optional array of CUISINE_CATEGORIES keys the host picked. Omitted,
// empty, or entirely invalid means no cuisine narrowing — every food type is eligible.
async function getFoodDeck(coords, cuisineKeys) {
  if (!GOOGLE_PLACES_API_KEY) return null;
  if (!isValidCoords(coords)) coords = null;
  const validKeys = validCategoryKeys(cuisineKeys);

  const key = locationKey(coords, validKeys);
  const cached = cacheByLocation.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.items;

  try {
    const items = await fetchTopRestaurants(coords, validKeys);
    if (items.length) {
      cacheByLocation.set(key, { items, fetchedAt: Date.now() });
      return items;
    }
    return cached?.items || null;
  } catch (err) {
    console.error('Google Places fetch failed, using fallback deck:', err.message);
    return cached?.items || null; // serve stale cache if we have it, else signal fallback
  }
}

function isValidCoords(coords) {
  return (
    coords &&
    typeof coords.latitude === 'number' &&
    typeof coords.longitude === 'number' &&
    Number.isFinite(coords.latitude) &&
    Number.isFinite(coords.longitude)
  );
}

module.exports = { getFoodDeck, getCuisineOptions, normalizeCuisineKeys };
