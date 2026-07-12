// Tag-targeted discovery against the live catalogs (TMDB for movies/shows, RAWG
// for games). Given the user's strongest tags, find candidate items to ingest
// into the local DB so the recommender has more than just the watchlist to rank.
//
// These return only lightweight { source, sourceId, type } refs — full metadata
// (with keywords/tags) is fetched later by persistItemFromIds during ingestion.

import { MediaType } from "@/types";
import { BoundedCache } from "@/lib/boundedCache";

const TMDB = process.env.TMDB_API_KEY!;
const RAWG = process.env.RAWG_API_KEY!;

export interface CandidateRef {
  source: "tmdb" | "rawg" | "steam";
  sourceId: string;
  type: MediaType;
}

// ── Genre name → provider id/slug maps (normalized tag keys) ──────
// TMDB genre ids are fixed and differ between movie and tv.
const TMDB_MOVIE_GENRES: Record<string, number> = {
  action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80, documentary: 99,
  drama: 18, family: 10751, fantasy: 14, history: 36, horror: 27, music: 10402,
  mystery: 9648, romance: 10749, "science fiction": 878, "sci fi": 878,
  thriller: 53, war: 10752, western: 37,
};
const TMDB_TV_GENRES: Record<string, number> = {
  "action & adventure": 10759, action: 10759, adventure: 10759, animation: 16,
  comedy: 35, crime: 80, documentary: 99, drama: 18, family: 10751, kids: 10762,
  mystery: 9648, reality: 10764, "sci fi & fantasy": 10765, "science fiction": 10765,
  fantasy: 10765, "war & politics": 10768, war: 10768, western: 37,
};
// RAWG genre slugs (our normalized key → RAWG slug).
const RAWG_GENRES: Record<string, string> = {
  action: "action", indie: "indie", adventure: "adventure", rpg: "role-playing-games-rpg",
  "role playing": "role-playing-games-rpg", strategy: "strategy", shooter: "shooter",
  casual: "casual", simulation: "simulation", puzzle: "puzzle", arcade: "arcade",
  platformer: "platformer", racing: "racing", sports: "sports", fighting: "fighting",
  family: "family", "massively multiplayer": "massively-multiplayer", card: "card",
  "board games": "board-games", educational: "educational",
};

export function tmdbGenreId(key: string, type: MediaType): number | undefined {
  return (type === "show" ? TMDB_TV_GENRES : TMDB_MOVIE_GENRES)[key];
}
export function rawgGenreSlug(key: string): string | undefined {
  return RAWG_GENRES[key];
}
// RAWG tag/keyword slug — RAWG slugs are lowercase-hyphenated.
export function rawgTagSlug(key: string): string {
  return key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ── TMDB keyword id resolution (cached) ───────────────────────────
const _keywordCache = new BoundedCache<string, number | null>({ max: 5000 });

export async function resolveTmdbKeywordId(name: string): Promise<number | null> {
  if (_keywordCache.has(name)) return _keywordCache.get(name)!;
  try {
    const r = await fetch(`https://api.themoviedb.org/3/search/keyword?api_key=${TMDB}&query=${encodeURIComponent(name)}`);
    const d = await r.json();
    // Prefer an exact (case-insensitive) name match, else the first result.
    const hit = (d.results ?? []).find((k: any) => k.name?.toLowerCase() === name.toLowerCase()) ?? d.results?.[0];
    const id = hit?.id ?? null;
    _keywordCache.set(name, id);
    return id;
  } catch {
    _keywordCache.set(name, null);
    return null;
  }
}

// ── TMDB discover ─────────────────────────────────────────────────
async function tmdbDiscover(type: "movie" | "tv", params: Record<string, string>): Promise<CandidateRef[]> {
  try {
    const p = new URLSearchParams({
      api_key: TMDB,
      sort_by: "popularity.desc",
      include_adult: "false",
      "vote_count.gte": "40",
      ...params,
    });
    const r = await fetch(`https://api.themoviedb.org/3/discover/${type}?${p}`);
    if (!r.ok) return [];
    const d = await r.json();
    const mt: MediaType = type === "tv" ? "show" : "movie";
    return (d.results ?? []).map((m: any) => ({ source: "tmdb" as const, sourceId: String(m.id), type: mt }));
  } catch {
    return [];
  }
}

export function discoverTmdbByGenres(genreIds: number[], type: MediaType): Promise<CandidateRef[]> {
  if (genreIds.length === 0) return Promise.resolve([]);
  return tmdbDiscover(type === "show" ? "tv" : "movie", { with_genres: genreIds.join("|") });
}
export function discoverTmdbByKeyword(keywordId: number, type: MediaType): Promise<CandidateRef[]> {
  return tmdbDiscover(type === "show" ? "tv" : "movie", { with_keywords: String(keywordId) });
}

// ── RAWG discover ─────────────────────────────────────────────────
async function rawgGames(params: Record<string, string>): Promise<CandidateRef[]> {
  try {
    const p = new URLSearchParams({ key: RAWG, ordering: "-rating", page_size: "30", ...params });
    const r = await fetch(`https://api.rawg.io/api/games?${p}`);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.results ?? []).map((g: any) => ({ source: "rawg" as const, sourceId: String(g.id), type: "game" as MediaType }));
  } catch {
    return [];
  }
}

export function discoverRawgByGenres(slugs: string[]): Promise<CandidateRef[]> {
  if (slugs.length === 0) return Promise.resolve([]);
  return rawgGames({ genres: slugs.join(",") });
}
export function discoverRawgByTag(slug: string): Promise<CandidateRef[]> {
  return rawgGames({ tags: slug });
}
