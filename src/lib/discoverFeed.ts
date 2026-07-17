// Live "upcoming" candidate fetchers — the raw material for the discover browse.
// One place that talks to the TMDB `discover` + RAWG `games` LIST endpoints and
// maps each result into a FeedCandidate: the client item shape PLUS the extra
// fields the personalized feed needs to taste-score a list item before deciding
// whether to hydrate it (genre names, original language, crowd-vote data).
//
// Shared by `api/discover/route.ts` (cold-start + section pagination) and
// `liveDiscover.ts` (wide multi-page pull → re-rank).

import { MediaType, Source } from "@/types";
import { httpFetch } from "@/lib/http";
import { tmdbGenreNames } from "@/lib/tmdbGenres";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { discoverIgdbUpcoming, igdbConfigured, igdbImageUrl, igdbReleaseDate } from "@/lib/sources/igdb";
import { getTraktAnticipatedMovies, getTraktAnticipatedShows, traktConfigured } from "@/lib/sources/trakt";

const TMDB_KEY = process.env.TMDB_API_KEY!;
const RAWG_KEY = process.env.RAWG_API_KEY!;

// Browse window: ~18 months forward for upcoming, ~18 months back for past.
const DAYS_WINDOW = 550;
const todayISO = () => new Date().toISOString().split("T")[0];
const offsetISO = (days: number) => new Date(Date.now() + days * 86400000).toISOString().split("T")[0];

export type Direction = "future" | "past";

// Date range for a direction. Past = [today-window, today]; future = [today, today+window].
export function dateWindow(direction: Direction): { gte: string; lte: string } {
  return direction === "past"
    ? { gte: offsetISO(-DAYS_WINDOW), lte: todayISO() }
    : { gte: todayISO(), lte: offsetISO(DAYS_WINDOW) };
}

// A live discover item, enriched with scoring inputs. The first block matches
// what the client already consumes; the trailing block is feed-internal and
// harmless if it reaches the client.
// H2b — the provider payload a candidate was built from, tagged with the source
// it actually CAME FROM. That tag is not redundant with `FeedCandidate.source`:
// a Trakt "anticipated" entry is labelled `source: "tmdb"` (it's keyed by its
// TMDB id so it dedupes against the TMDB pool), but the payload in hand is
// Trakt-shaped. Storing it as TMDB would run it through the TMDB projector and
// normalizer — wrong fields, no cross-ids, a corrupt link. So the payload says
// what it is, and `source`/`ids` stay the feed's business.
export interface RawPayload {
  source: Source;
  sourceId: string;
  data: any;
}

export interface FeedCandidate {
  id: string;
  rawId: number;
  source: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  platforms?: string[];
  overview?: string;
  ids: Record<string, number>;
  /** The list payload to persist (H2b). Null when we hold none worth storing. */
  raw?: RawPayload | null;
  // ── scoring inputs (used by liveDiscover, ignored by the client) ──
  genreNames: string[];          // genre/tag names for the cheap pre-score
  originalLanguage: string | null;
  voteCount: number;             // crowd-vote sample size (community floor)
  voteAverage: number | null;    // 0–10 normalized crowd score
}

export async function fetchGamePage(page = 1, direction: Direction = "future"): Promise<FeedCandidate[]> {
  // Order by popularity (`-added`) within the window so notable games surface
  // first; the personalized feed re-ranks, the client date-sorts for display.
  const { gte, lte } = dateWindow(direction);
  const res = await httpFetch(
    `https://api.rawg.io/api/games?key=${RAWG_KEY}` +
      `&dates=${gte},${lte}&ordering=-added&page_size=40&page=${page}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((g: any): FeedCandidate => ({
    id: `rawg-${g.id}`, rawId: g.id, source: "rawg", type: "game",
    title: g.name, releaseDate: g.released ?? null,
    posterUrl: g.background_image ?? null,
    platforms: (g.platforms ?? []).slice(0, 3).map((p: any) => p.platform.name),
    ids: { rawg: g.id },
    raw: { source: "rawg", sourceId: String(g.id), data: g },
    genreNames: [
      ...(g.genres ?? []).map((x: any) => x?.name),
      ...(g.tags ?? []).slice(0, 8).map((x: any) => x?.name),
    ].filter((n): n is string => typeof n === "string"),
    originalLanguage: null, // RAWG list carries no language; not language-relevant for games
    voteCount: g.ratings_count ?? 0,
    voteAverage: typeof g.rating === "number" && g.rating > 0 ? g.rating * 2 : null, // 0–5 → 0–10
  }));
}

export async function fetchMoviePage(page = 1, direction: Direction = "future", region = DEFAULT_COUNTRY): Promise<FeedCandidate[]> {
  // `discover` with a release-date window sorted by popularity. With `region` set,
  // TMDB filters by + returns that country's release date (T22).
  const { gte, lte } = dateWindow(direction);
  const res = await httpFetch(
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}` +
      `&sort_by=popularity.desc&include_adult=false&with_release_type=2|3&region=${region}` +
      `&release_date.gte=${gte}&release_date.lte=${lte}&page=${page}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((m: any): FeedCandidate => ({
    id: `tmdb-movie-${m.id}`, rawId: m.id, source: "tmdb", type: "movie",
    title: m.title, releaseDate: m.release_date ?? null,
    posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
    overview: m.overview, ids: { tmdb: m.id },
    raw: { source: "tmdb", sourceId: String(m.id), data: m },
    genreNames: tmdbGenreNames(m.genre_ids, "movie"),
    originalLanguage: m.original_language ?? null,
    voteCount: m.vote_count ?? 0,
    voteAverage: typeof m.vote_average === "number" && m.vote_average > 0 ? m.vote_average : null,
  }));
}

export async function fetchShowPage(page = 1, direction: Direction = "future"): Promise<FeedCandidate[]> {
  const { gte, lte } = dateWindow(direction);
  const res = await httpFetch(
    `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_KEY}` +
      `&sort_by=popularity.desc&first_air_date.gte=${gte}` +
      `&first_air_date.lte=${lte}&page=${page}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((s: any): FeedCandidate => ({
    id: `tmdb-show-${s.id}`, rawId: s.id, source: "tmdb", type: "show",
    title: s.name, releaseDate: s.first_air_date ?? null,
    posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w342${s.poster_path}` : null,
    overview: s.overview, ids: { tmdb: s.id },
    raw: { source: "tmdb", sourceId: String(s.id), data: s },
    genreNames: tmdbGenreNames(s.genre_ids, "show"),
    originalLanguage: s.original_language ?? null,
    voteCount: s.vote_count ?? 0,
    voteAverage: typeof s.vote_average === "number" && s.vote_average > 0 ? s.vote_average : null,
  }));
}

// IGDB upcoming games (second game source). Covers/genres/themes come straight
// off the list payload, so these score + render without hydration. `past` and
// unconfigured both no-op (IGDB ranks by `hypes`, only meaningful for upcoming).
export async function fetchIgdbGamePage(page = 1, direction: Direction = "future"): Promise<FeedCandidate[]> {
  if (direction === "past" || !igdbConfigured()) return [];
  const { gte, lte } = dateWindow(direction);
  const gteU = Math.floor(new Date(gte).getTime() / 1000);
  const lteU = Math.floor(new Date(lte).getTime() / 1000);
  const games = await discoverIgdbUpcoming(gteU, lteU, 40, (page - 1) * 40);
  return games.map((g: any): FeedCandidate => ({
    id: `igdb-${g.id}`, rawId: g.id, source: "igdb", type: "game",
    title: g.name, releaseDate: igdbReleaseDate(g),
    // Prefer the portrait cover; when a game has none yet (common for freshly
    // announced titles), fall back to the best landscape art available — artwork
    // (hero image) then a screenshot — so the card shows something real.
    posterUrl:
      igdbImageUrl(g.cover?.image_id, "t_cover_big") ??
      igdbImageUrl(g.artworks?.[0]?.image_id, "t_720p") ??
      igdbImageUrl(g.screenshots?.[0]?.image_id, "t_720p"),
    platforms: (g.platforms ?? []).slice(0, 3).map((p: any) => p?.name).filter(Boolean),
    ids: { igdb: g.id },
    raw: { source: "igdb", sourceId: String(g.id), data: g },
    genreNames: [
      ...(g.genres ?? []).map((x: any) => x?.name),
      ...(g.themes ?? []).map((x: any) => x?.name),
    ].filter((n): n is string => typeof n === "string"),
    originalLanguage: null,
    voteCount: g.total_rating_count ?? 0,
    voteAverage: typeof g.total_rating === "number" && g.total_rating > 0 ? g.total_rating / 10 : null, // 0–100 → 0–10
  }));
}

// Trakt "anticipated" → candidates keyed by their TMDB id (source "tmdb") so they
// dedupe against the TMDB discover pool and get a poster + full facets when
// hydrated (Trakt itself serves no images). Window-filtered to upcoming, like
// the other sources. Items without a tmdb id or date are dropped.
function traktToCandidate(entry: any, type: MediaType, win: { gte: string; lte: string }): FeedCandidate | null {
  const m = entry.movie ?? entry.show ?? entry;
  const tmdbId = m?.ids?.tmdb;
  if (!tmdbId) return null;
  const releaseDate: string | null = m.released ?? m.first_aired?.split("T")[0] ?? null;
  if (!releaseDate || releaseDate < win.gte || releaseDate > win.lte) return null;
  return {
    id: `tmdb-${type === "movie" ? "movie" : "show"}-${tmdbId}`, rawId: tmdbId, source: "tmdb", type,
    title: m.title, releaseDate,
    posterUrl: null, // filled by TMDB hydration
    overview: m.overview, ids: { tmdb: tmdbId, ...(m.ids?.trakt ? { trakt: m.ids.trakt } : {}) },
    // The payload is TRAKT's, even though the candidate is keyed by its tmdb id
    // (see RawPayload). Its `ids.tmdb` still reaches media_external_ids via
    // extractCrossIds, so the item stays matchable against the TMDB pool.
    raw: m.ids?.trakt != null ? { source: "trakt", sourceId: String(m.ids.trakt), data: m } : null,
    genreNames: (m.genres ?? []).filter((g: any): g is string => typeof g === "string"),
    originalLanguage: m.language ?? null,
    voteCount: m.votes ?? 0,
    voteAverage: typeof m.rating === "number" && m.rating > 0 ? m.rating : null,
  };
}

export async function fetchTraktMoviePage(page = 1): Promise<FeedCandidate[]> {
  if (!traktConfigured()) return [];
  const win = dateWindow("future");
  const entries = await getTraktAnticipatedMovies(60, page);
  return entries.map((e) => traktToCandidate(e, "movie", win)).filter((c): c is FeedCandidate => !!c);
}

export async function fetchTraktShowPage(page = 1): Promise<FeedCandidate[]> {
  if (!traktConfigured()) return [];
  const win = dateWindow("future");
  const entries = await getTraktAnticipatedShows(60, page);
  return entries.map((e) => traktToCandidate(e, "show", win)).filter((c): c is FeedCandidate => !!c);
}

// Fetch the first `n` popularity pages of a source in parallel, flattened.
export async function fetchPages(
  fetcher: (page: number) => Promise<FeedCandidate[]>,
  n: number
): Promise<FeedCandidate[]> {
  const pages = await Promise.all(Array.from({ length: n }, (_, i) => fetcher(i + 1)));
  return pages.flat();
}
