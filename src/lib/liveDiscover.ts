// Personalized discover browse — the engine that replaces the global-popularity
// default feed. It pulls a WIDE pool of upcoming releases, taste-ranks them with
// the SAME facet model the catalog "Best match" sort uses (discovery.ts), and
// returns the most relevant set for the client to date-sort into its timeline.
//
// Two-stage (B2): a cheap genre/language pre-score picks which movie/show
// candidates are worth hydrating; the hydrated ones get full-facet scoring
// (people, keywords, studios). Games are scored from their list genres/tags only
// (RAWG detail costs 4 sub-requests each — not worth it for a browse feed).
//
// Signals: the user's rated taste profile + a LIBRARY/WISHLIST membership prior
// (so an unrated-but-owned/wishlisted genre still counts, and a fresh account
// with only a wishlist still gets a feed) + a gentle original-language affinity
// and a crowd-vote floor.

import { BoundedCache } from "@/lib/boundedCache";
import { buildProfile, scoreFacets, getCatalogIdf, ROLE_WEIGHT, Reason } from "@/lib/discovery";
import { getMembershipSignal } from "@/lib/libraryAnalysis";
import { extractFacets, tagKey, Facet } from "@/lib/facets";
import { mergeLinks, normalizeName, extractYear } from "@/lib/merge";
import { METADATA } from "@/lib/metadata/registry";
import {
  FeedCandidate, RawPayload, fetchGamePage, fetchMoviePage, fetchShowPage, fetchPages,
  fetchIgdbGamePage, fetchTraktMoviePage, fetchTraktShowPage,
} from "@/lib/discoverFeed";
import { MediaLink, MediaType } from "@/types";

// ── Tunables ───────────────────────────────────────────────────────
const PAGES_PER_SOURCE = 5;   // wide pull: ~200 candidates per type before ranking
const HYDRATE_KEEP = 24;      // movie/show candidates to hydrate (TMDB = 1 req each)
const FINAL_KEEP = 18;        // items kept per type for the merged feed
const HYDRATE_CONCURRENCY = 8;

const LIB_PRIOR = 0.6;        // an unrated library facet's positive prior (per item, shrunk)
const WISH_PRIOR = 0.9;      // wishlist = forward-looking intent → weighed higher
const K_MEMBER = 3;          // membership confidence shrink: count/(count+K)

const LANG_BONUS = 0.5;      // max nudge toward your dominant original languages
const LANG_MALUS = 0.4;      // nudge away from a language you never engage with
const FLOOR_VOTES = 50;      // only judge crowd score once this many votes exist
const FLOOR_SCORE = 5.0;     // …then drop sub-5/10 (clearly poorly received)

// ── Live profile (rated taste + membership priors) ─────────────────
interface LiveProfile {
  w: Map<string, number>;
  hasSignal: boolean;
  langPref: Map<string, number>;
  langTotal: number;
}

function buildLiveProfile(userId: string): LiveProfile {
  const base = buildProfile(userId);          // rated signal (signed by avg − baseline)
  const w = new Map(base.w);
  const member = getMembershipSignal(userId);

  for (const [id, f] of member.facets) {
    const libShrink = f.libCount / (f.libCount + K_MEMBER);
    const wishShrink = f.wishCount / (f.wishCount + K_MEMBER);
    const role = ROLE_WEIGHT[f.role ?? "tag"] ?? 1;
    const prior = (LIB_PRIOR * libShrink + WISH_PRIOR * wishShrink) * role;
    if (prior !== 0) w.set(id, (w.get(id) ?? 0) + prior);
  }

  let langTotal = 0;
  for (const v of member.languages.values()) langTotal += v;

  return {
    w,
    hasSignal: base.hasSignal || member.facets.size > 0,
    langPref: member.languages,
    langTotal,
  };
}

// Gentle language affinity: + for your dominant languages, − for one you never
// touch. Bounded so it only breaks ties / sinks fully-foreign no-match content
// (the K-drama-flood lever) without overriding a real facet match.
function langTerm(lang: string | null, p: LiveProfile): number {
  if (!lang || p.langTotal === 0) return 0;
  const share = (p.langPref.get(lang) ?? 0) / p.langTotal;
  return share > 0 ? LANG_BONUS * share : -LANG_MALUS;
}

// Drop only clearly poorly-received items that have enough votes to judge.
// Unreleased / low-sample upcoming items always pass (the floor can't see them).
function belowFloor(c: FeedCandidate): boolean {
  return c.voteCount >= FLOOR_VOTES && c.voteAverage != null && c.voteAverage < FLOOR_SCORE;
}

// Tag facets straight off a candidate's list-payload genres/tags (no hydration).
function listFacets(c: FeedCandidate): Facet[] {
  const seen = new Set<string>();
  const out: Facet[] = [];
  for (const name of c.genreNames) {
    const key = tagKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "tag", key, label: name });
  }
  return out;
}

// ── Hydration (full facets for movies/shows via one TMDB detail fetch) ──
// Also returns the merged poster so Trakt-sourced candidates (which carry no
// image) get one once hydrated through their TMDB id.
interface Hydrated { facets: Facet[]; posterUrl: string | null }
// LRU-capped: hydration is expensive (a TMDB detail fetch) so we keep recent
// results, but the cap prevents unbounded growth over long uptime (P2).
const _facetCache = new BoundedCache<string, Hydrated>({ max: 3000 });

async function hydrateFacets(c: FeedCandidate): Promise<Hydrated> {
  const ck = `${c.source}:${c.rawId}`;
  const cached = _facetCache.get(ck);
  if (cached) return cached;

  let result: Hydrated = { facets: listFacets(c), posterUrl: c.posterUrl };
  try {
    const provider = METADATA[c.source as keyof typeof METADATA];
    const link = await provider?.fetchById?.(String(c.rawId), c.type);
    if (link) {
      const ml: MediaLink = {
        id: "", mediaItemId: "", source: link.source, sourceId: link.sourceId,
        title: link.title, releaseDate: link.releaseDate, rawData: link.rawData, lastSynced: 0,
      };
      const merged = mergeLinks([ml], c.type);
      result = { facets: extractFacets([ml], c.type, merged), posterUrl: c.posterUrl ?? merged.posterUrl ?? null };
    }
  } catch { /* fall back to list facets */ }

  _facetCache.set(ck, result);
  return result;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── Per-type ranking ───────────────────────────────────────────────
interface Scored { c: FeedCandidate; score: number; reasons: Reason[] }

async function rankType(
  candidates: FeedCandidate[],
  profile: LiveProfile,
  idf: Map<string, number>,
  hydrate: boolean
): Promise<Scored[]> {
  // Dedup (pages can overlap) + apply the crowd-vote floor.
  const byId = new Map<string, FeedCandidate>();
  for (const c of candidates) if (!belowFloor(c) && !byId.has(c.id)) byId.set(c.id, c);
  const pool = [...byId.values()];

  // Cheap pre-score (list genres/tags + language) — always available.
  const cheap = (c: FeedCandidate) =>
    (scoreFacets(listFacets(c), profile.w, idf)?.score ?? 0) + langTerm(c.originalLanguage, profile);

  if (!hydrate) {
    return pool
      .map((c): Scored => {
        const s = scoreFacets(listFacets(c), profile.w, idf);
        return { c, score: (s?.score ?? 0) + langTerm(c.originalLanguage, profile), reasons: s?.reasons ?? [] };
      })
      .sort(byScore)
      .slice(0, FINAL_KEEP);
  }

  // Hydrate only the most promising candidates, then full-facet score them.
  const top = pool
    .map((c) => ({ c, cheap: cheap(c) }))
    .sort((a, b) => b.cheap - a.cheap)
    .slice(0, HYDRATE_KEEP)
    .map((x) => x.c);
  const hydrated = await mapLimit(top, HYDRATE_CONCURRENCY, hydrateFacets);
  return top
    .map((c, i): Scored => {
      const h = hydrated[i];
      if (!c.posterUrl && h.posterUrl) c.posterUrl = h.posterUrl; // backfill Trakt items
      const s = scoreFacets(h.facets, profile.w, idf);
      return { c, score: (s?.score ?? 0) + langTerm(c.originalLanguage, profile), reasons: s?.reasons ?? [] };
    })
    .sort(byScore)
    .slice(0, FINAL_KEEP);
}

// Taste score desc; tiebreak on crowd score so equally-relevant items order by
// quality rather than arbitrarily.
function byScore(a: Scored, b: Scored): number {
  return b.score - a.score || (b.c.voteAverage ?? -1) - (a.c.voteAverage ?? -1);
}

// ── Cross-source dedup (the browse feed shows UNMERGED live items) ──
// Movies/shows: Trakt candidates are keyed by their TMDB id (same `id` format as
// the TMDB discover items), so identity dedup suffices — first (TMDB) wins.
function dedupeById(cands: FeedCandidate[]): FeedCandidate[] {
  const seen = new Set<string>();
  const out: FeedCandidate[] = [];
  for (const c of cands) if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
  return out;
}

// Games: RAWG and IGDB use independent ids, so the same title would appear
// twice — dedupe by normalized title + release year. First (RAWG) wins; IGDB
// only adds titles RAWG's window missed.
function dedupeGames(cands: FeedCandidate[]): FeedCandidate[] {
  const seen = new Set<string>();
  const out: FeedCandidate[] = [];
  for (const c of cands) {
    const key = `${normalizeName(c.title ?? "")}|${extractYear(c.releaseDate) ?? "?"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// ── Public: the personalized browse feed ───────────────────────────
// Returns client-shaped discover items (taste-selected, NOT yet date-sorted —
// the client owns timeline ordering), or null when the user has no taste signal
// at all (cold start) so the caller can fall back to global popularity.

export interface PersonalizedItem {
  id: string; rawId: number; source: string; type: MediaType;
  title: string; releaseDate: string | null; posterUrl: string | null;
  platforms?: string[]; overview?: string; ids: Record<string, number>;
  raw?: RawPayload | null;   // carried through for H2b persistence, not for the client
  score: number; reasons: Reason[];
}

const FEED_TTL_MS = 45 * 60 * 1000;
// Keyed by `${userId}:${region}`. TTL expiry + a size cap so stale/for-many-users
// entries can't accumulate on the long-lived process (P2).
const _feedCache = new BoundedCache<string, PersonalizedItem[]>({ max: 500, ttlMs: FEED_TTL_MS });

export function invalidatePersonalizedFeed(userId?: string) {
  if (!userId) { _feedCache.clear(); return; }
  for (const k of [..._feedCache.keys()]) if (k.startsWith(`${userId}:`)) _feedCache.delete(k);
}

export async function personalizedFeed(userId: string, region: string): Promise<PersonalizedItem[] | null> {
  const profile = buildLiveProfile(userId);
  if (!profile.hasSignal) return null;

  const key = `${userId}:${region}`;
  const hit = _feedCache.get(key);
  if (hit) return hit;

  const idf = getCatalogIdf();
  // Each medium pulls from two sources in parallel: RAWG + IGDB (games),
  // TMDB + Trakt-anticipated (movies/shows). Trakt only paginates a finite
  // anticipated list, so it contributes its first 2 pages, not the full depth.
  const [rawgGames, igdbGames, tmdbMovies, traktMovies, tmdbShows, traktShows] = await Promise.all([
    fetchPages((p) => fetchGamePage(p, "future"), PAGES_PER_SOURCE),
    fetchPages((p) => fetchIgdbGamePage(p, "future"), PAGES_PER_SOURCE),
    fetchPages((p) => fetchMoviePage(p, "future", region), PAGES_PER_SOURCE),
    fetchPages((p) => fetchTraktMoviePage(p), 2),
    fetchPages((p) => fetchShowPage(p, "future"), PAGES_PER_SOURCE),
    fetchPages((p) => fetchTraktShowPage(p), 2),
  ]);

  const games = dedupeGames([...rawgGames, ...igdbGames]);
  const movies = dedupeById([...tmdbMovies, ...traktMovies]);
  const shows = dedupeById([...tmdbShows, ...traktShows]);

  const [selGames, selMovies, selShows] = await Promise.all([
    rankType(games, profile, idf, false),   // games: list-facet score only (RAWG + IGDB)
    rankType(movies, profile, idf, true),   // movies: hydrate → full facets (TMDB + Trakt)
    rankType(shows, profile, idf, true),    // shows: hydrate → full facets (TMDB + Trakt)
  ]);

  const items: PersonalizedItem[] = [...selGames, ...selMovies, ...selShows].map(({ c, score, reasons }) => ({
    id: c.id, rawId: c.rawId, source: c.source, type: c.type,
    title: c.title, releaseDate: c.releaseDate, posterUrl: c.posterUrl,
    platforms: c.platforms, overview: c.overview, ids: c.ids, raw: c.raw,
    score, reasons,
  }));

  _feedCache.set(key, items);
  return items;
}

// Cheap personalization for the infinite-scroll section pages: no hydration,
// just drop the crowd-floor failures and the clearly-irrelevant (negative taste
// + foreign-language no-match), so deeper scrolling doesn't revert to a global
// popularity flood. Keeps load-more fast.
export function filterSectionPage(userId: string, candidates: FeedCandidate[]): FeedCandidate[] {
  const profile = buildLiveProfile(userId);
  if (!profile.hasSignal) return candidates;
  const idf = getCatalogIdf();
  return candidates.filter((c) => {
    if (belowFloor(c)) return false;
    const score = (scoreFacets(listFacets(c), profile.w, idf)?.score ?? 0) + langTerm(c.originalLanguage, profile);
    return score >= 0; // keep neutral-or-better; drop actively-mismatched
  });
}
