const BASE = "https://api.trakt.tv";
const CLIENT_ID = process.env.TRAKT_CLIENT_ID!;
const CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET!;
const REDIRECT_URI = process.env.TRAKT_REDIRECT_URI || "http://localhost:3000/api/auth/trakt/callback";

const HEADERS = {
  "Content-Type": "application/json",
  "trakt-api-version": "2",
  "trakt-api-key": CLIENT_ID,
  "User-Agent": "ReleaseRadar/2.0",
};

export function getTraktAuthUrl(state: string): string {
  const p = new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state });
  return `https://trakt.tv/oauth/authorize?${p}`;
}

export async function exchangeTraktCode(code: string) {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
  });
  if (!res.ok) { const b = await res.text(); throw new Error(`Trakt token exchange failed: ${res.status} ${b}`); }
  return res.json();
}

export async function refreshTraktToken(refreshToken: string) {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Trakt refresh failed: ${res.status}`);
  return res.json();
}

async function traktGet(endpoint: string, accessToken: string) {
  const res = await fetch(`${BASE}${endpoint}`, {
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Trakt API error: ${res.status} ${endpoint}`);
  return res.json();
}

// ── Public (catalog) API — client-id auth only, no user token ─────
// Summary/search endpoints are public; extended=full carries runtime,
// certification, rating+votes, tagline, status, country, network, trailer.

export function traktConfigured(): boolean {
  return !!CLIENT_ID;
}

async function traktGetPublic(endpoint: string) {
  const res = await fetch(`${BASE}${endpoint}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Trakt API error: ${res.status} ${endpoint}`);
  return res.json();
}

// idOrSlug accepts a numeric trakt id or a slug.
export async function getTraktMovieSummary(idOrSlug: string): Promise<any | null> {
  try { return await traktGetPublic(`/movies/${idOrSlug}?extended=full`); }
  catch { return null; }
}

export async function getTraktShowSummary(idOrSlug: string): Promise<any | null> {
  try { return await traktGetPublic(`/shows/${idOrSlug}?extended=full`); }
  catch { return null; }
}

export async function searchTraktPublic(query: string, type: "movie" | "show", limit = 5): Promise<any[]> {
  try {
    return (await traktGetPublic(`/search/${type}?query=${encodeURIComponent(query)}&limit=${limit}&extended=full`)) ?? [];
  } catch { return []; }
}

// Most-anticipated unreleased titles (public; client-id only). Each entry is
// `{ list_count, movie|show: {...} }`; extended=full carries genres, language,
// rating/votes, overview, released/first_aired and ids (including tmdb — which
// the discover feed needs to render + dedupe against TMDB). This is Trakt's
// unique contribution: a crowd-anticipation ranking TMDB's popularity sort lacks.
export async function getTraktAnticipatedMovies(limit = 60, page = 1): Promise<any[]> {
  try { return (await traktGetPublic(`/movies/anticipated?extended=full&limit=${limit}&page=${page}`)) ?? []; }
  catch { return []; }
}

export async function getTraktAnticipatedShows(limit = 60, page = 1): Promise<any[]> {
  try { return (await traktGetPublic(`/shows/anticipated?extended=full&limit=${limit}&page=${page}`)) ?? []; }
  catch { return []; }
}

export async function getTraktUserInfo(accessToken: string) {
  return traktGet("/users/me", accessToken);
}

function getStartDate(daysPast: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysPast);
  return d.toISOString().split("T")[0];
}

export async function getTraktWatchlistMovies(accessToken: string) {
  try {
    // Use /sync/watchlist/movies – returns the actual watchlist, not the calendar
    const results = await traktGet("/sync/watchlist/movies?extended=full", accessToken);
    return results ?? [];
  } catch { return []; }
}

export async function getTraktWatchlistShows(accessToken: string) {
  try {
    const results = await traktGet("/sync/watchlist/shows?extended=full", accessToken);
    return results ?? [];
  } catch { return []; }
}

// ── Watched + ratings (for the Library / history page) ────────────

// extended=full so stored raw_data carries overview/released/genres/trailer —
// without it Trakt returns bare {title, year, ids} and the merge gets nothing.
export async function getTraktWatchedMovies(accessToken: string) {
  try { return (await traktGet("/sync/watched/movies?extended=full", accessToken)) ?? []; }
  catch { return []; }
}

export async function getTraktWatchedShows(accessToken: string) {
  try { return (await traktGet("/sync/watched/shows?extended=full", accessToken)) ?? []; }
  catch { return []; }
}

export async function getTraktRatingsMovies(accessToken: string) {
  try { return (await traktGet("/sync/ratings/movies?extended=full", accessToken)) ?? []; }
  catch { return []; }
}

export async function getTraktRatingsShows(accessToken: string) {
  try { return (await traktGet("/sync/ratings/shows?extended=full", accessToken)) ?? []; }
  catch { return []; }
}

// Calendar endpoint – used separately for episode-level data
export async function getTraktCalendarMovies(accessToken: string, daysPast = 365, daysFuture = 365) {
  const start = getStartDate(daysPast);
  const total = daysPast + daysFuture;
  try {
    return await traktGet(`/calendars/my/movies/${start}/${total}`, accessToken);
  } catch { return []; }
}

export async function getTraktCalendarShows(accessToken: string, daysPast = 365, daysFuture = 365) {
  const start = getStartDate(daysPast);
  const total = daysPast + daysFuture;
  try {
    return await traktGet(`/calendars/my/shows/${start}/${total}`, accessToken);
  } catch { return []; }
}

// Write-back: add movie to Trakt watchlist
export async function addMovieToTraktWatchlist(accessToken: string, traktId: number) {
  const res = await fetch(`${BASE}/sync/watchlist`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ movies: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to add to Trakt watchlist: ${res.status} ${body}`);
  }
}

export async function removeMovieFromTraktWatchlist(accessToken: string, traktId: number) {
  const res = await fetch(`${BASE}/sync/watchlist/remove`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ movies: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to remove from Trakt watchlist: ${res.status} ${body}`);
  }
}

export async function removeShowFromTraktWatchlist(accessToken: string, traktId: number) {
  const res = await fetch(`${BASE}/sync/watchlist/remove`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ shows: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to remove show from Trakt watchlist: ${res.status} ${body}`);
  }
}

export async function addShowToTraktWatchlist(accessToken: string, traktId: number) {
  const res = await fetch(`${BASE}/sync/watchlist`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ shows: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to add show to Trakt watchlist: ${res.status} ${body}`);
  }
}

// Look up Trakt ID by TMDB ID
export async function getTraktIdByTmdb(tmdbId: number, type: "movie" | "show", accessToken: string): Promise<number | null> {
  try {
    const endpoint = type === "movie" ? `/search/tmdb/${tmdbId}?type=movie` : `/search/tmdb/${tmdbId}?type=show`;
    const results = await traktGet(endpoint, accessToken);
    const item = results?.[0];
    if (!item) return null;
    return type === "movie" ? item.movie?.ids?.trakt : item.show?.ids?.trakt;
  } catch {
    return null;
  }
}

// Search Trakt for movies or shows
export async function searchTrakt(query: string, type: "movie" | "show", accessToken: string): Promise<any[]> {
  try {
    const results = await traktGet(`/search/${type}?query=${encodeURIComponent(query)}&limit=8`, accessToken);
    return results ?? [];
  } catch {
    return [];
  }
}

// ── Write-back: rate + mark watched ───────────────────────────────

// POST rating (1-10) to Trakt /sync/ratings
export async function rateTraktItem(
  accessToken: string,
  type: "movie" | "show",
  traktId: number,
  rating: number  // 1-10 integer
): Promise<void> {
  const key = type === "movie" ? "movies" : "shows";
  const res = await fetch(`${BASE}/sync/ratings`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ [key]: [{ rating, ids: { trakt: traktId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trakt rate failed: ${res.status} ${body}`);
  }
}

// POST to Trakt /sync/history to mark a movie/show as watched
export async function markTraktWatched(
  accessToken: string,
  type: "movie" | "show",
  traktId: number,
  watchedAt?: string  // ISO timestamp; defaults to now
): Promise<void> {
  const key = type === "movie" ? "movies" : "shows";
  const item: Record<string, any> = { ids: { trakt: traktId } };
  if (watchedAt) item.watched_at = watchedAt;
  const res = await fetch(`${BASE}/sync/history`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ [key]: [item] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("Trakt mark watched failed: " + res.status + " " + body);
  }
}

// Remove a rating from Trakt (/sync/ratings/remove). Used when the user clears
// a rating / removes an item from their library, so a later resync doesn't
// re-pull the stale rating.
export async function removeTraktRating(
  accessToken: string,
  type: "movie" | "show",
  traktId: number
): Promise<void> {
  const key = type === "movie" ? "movies" : "shows";
  const res = await fetch(`${BASE}/sync/ratings/remove`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ [key]: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trakt remove rating failed: ${res.status} ${body}`);
  }
}

// Remove watched-history entries for an item from Trakt (/sync/history/remove),
// so removing it from the library also un-marks it as watched.
export async function removeTraktFromHistory(
  accessToken: string,
  type: "movie" | "show",
  traktId: number
): Promise<void> {
  const key = type === "movie" ? "movies" : "shows";
  const res = await fetch(`${BASE}/sync/history/remove`, {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ [key]: [{ ids: { trakt: traktId } }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trakt remove history failed: ${res.status} ${body}`);
  }
}
