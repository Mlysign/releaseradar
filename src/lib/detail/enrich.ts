import { query, get } from "@/lib/db";
import { PROJECTION_VERSION } from "@/lib/sources/project";
import { linkSourceToItem } from "@/lib/matcher";
import { extractYear } from "@/lib/merge";
import { MediaLink, EnrichedItem, Source, MediaType } from "@/types";
import { fetchOmdbScores, fetchOmdbByImdbId, OmdbResult } from "@/lib/sources/omdb";
import { METADATA, metadataForType } from "@/lib/metadata/registry";
import { MetaLink } from "@/lib/metadata/types";

// ── Shared detail-enrichment pipeline ────────────────────────────────────────
//
// Extracted from /api/detail so the AUTHED endpoint and the PUBLIC page render
// from ONE pipeline. They previously diverged: the public page was built on a
// stored-data-only path and rendered a fraction of the data (no cast, trailers,
// where-to-watch or RT/IMDb scores) even though all of it is public. One code
// path means the public page can never silently fall behind again.
//
// Everything here is CATALOG data — third-party metadata about the item itself.
// Nothing in this module reads user_library / user_watchlist / user_item_state.
// The per-user overlay (rating, review, wishlist status) is layered on top by
// /api/detail and must never move down into here.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// EnrichedItem minus EVERY per-user field. The public page builds THIS, so
// putting a rating/review/libraryStatus on it is a compile error rather than
// something we have to remember to strip.
//
// `platformSources` (which of the viewer's accounts hold the item) is per-user
// too, so it's omitted as well — the display components never read it; the view
// supplies `platformSources: []` at the boundary where it hands off to them.
export type PublicEnrichedItem = Omit<
  EnrichedItem,
  "rating" | "ratings" | "review" | "reviewedAt" | "libraryStatus" | "platformSources"
>;

export interface SourceIds {
  rawg: string | null;
  tmdb: string | null;
  trakt: string | null;
  steam: string | null;
  letterboxd: string | null;
}

export function readSourceIds(sp: URLSearchParams): SourceIds {
  return {
    rawg: sp.get("rawgId"),
    tmdb: sp.get("tmdbId"),
    trakt: sp.get("traktId"),
    steam: sp.get("steamId"),
    letterboxd: sp.get("letterboxdId"),
  };
}

// Resolve an existing media_item from any provided source id via media_links.
export function resolveBySourceIds(type: MediaType | null, ids: SourceIds): string | null {
  const candidates: { source: string; id: string }[] = [];
  if (ids.rawg) candidates.push({ source: "rawg", id: ids.rawg });
  if (ids.tmdb) candidates.push({ source: "tmdb", id: ids.tmdb });
  if (ids.trakt) candidates.push({ source: "trakt", id: ids.trakt });
  if (ids.steam) candidates.push({ source: "steam", id: ids.steam });
  if (ids.letterboxd) candidates.push({ source: "letterboxd", id: ids.letterboxd });

  for (const { source, id } of candidates) {
    const link = get<{ media_item_id: string }>(
      "SELECT media_item_id FROM media_links WHERE source = ? AND source_id = ?",
      [source, id]
    );
    if (link) return link.media_item_id;
  }
  return null;
}

export function loadLinks(mediaItemId: string): MediaLink[] {
  const linkRows = query<any>("SELECT * FROM media_links WHERE media_item_id = ?", [mediaItemId]);
  return linkRows.map((r: any) => ({
    id: r.id,
    mediaItemId: r.media_item_id,
    source: r.source as Source,
    sourceId: r.source_id,
    title: r.title,
    releaseDate: r.release_date,
    rawData: JSON.parse(r.raw_data),
    lastSynced: r.last_synced,
    projectionVersion: r.projection_version ?? 0,
  }));
}

// Wrap a normalized MetaLink as an in-memory MediaLink for merging.
export function toMediaLink(link: MetaLink, mediaItemId: string): MediaLink {
  return {
    id: `live-${link.source}`,
    mediaItemId,
    source: link.source,
    sourceId: link.sourceId,
    title: link.title,
    releaseDate: link.releaseDate,
    rawData: link.rawData,
    lastSynced: 0,
  };
}

// Build links live from the provided source ids (item not in DB), by fetching
// each known id through its MetadataProvider. The remaining sources are filled
// in by enrichMissingSources().
export async function buildLiveLinks(
  id: string,
  type: MediaType,
  title: string | null,
  ids: SourceIds
): Promise<MediaLink[]> {
  const links: MediaLink[] = [];
  for (const provider of metadataForType(type)) {
    const rawId = ids[provider.id as keyof SourceIds];
    if (rawId == null || !provider.fetchById) continue;
    try {
      const link = await provider.fetchById(String(rawId), type);
      if (link) links.push(toMediaLink(link, id));
    } catch { /* continue */ }
  }
  return links;
}

// Refresh a stored movie/show's TMDB link in-memory when it predates the
// current fetch shape. Returns whether the stored data was replaced.
//
// H2a — this USED to sniff fields ("no external_ids/keywords → old blob →
// refetch"). Sniffing is fundamentally incompatible with the raw_data
// projection: a projected row is legitimately missing fields, so every row would
// read as stale and stampede TMDB with ~1,472 refetches. Staleness is now the
// EXPLICIT `projection_version` stamp — the only honest signal, since it says
// what shape a row was written in rather than guessing from its contents.
export async function ensureTmdbDetail(links: MediaLink[], type: MediaType): Promise<boolean> {
  if (type !== "movie" && type !== "show") return false;
  const tmdb = links.find((l) => l.source === "tmdb");
  if (!tmdb || (tmdb.projectionVersion ?? 0) >= PROJECTION_VERSION) return false;
  try {
    const fresh = await METADATA.tmdb?.fetchById?.(tmdb.sourceId, type);
    if (fresh) {
      tmdb.rawData = fresh.rawData;
      storeRefreshed(tmdb, type, fresh);
      return true;
    }
  } catch { /* keep stored data */ }
  return false;
}

// Persist a blob we just refetched because the stored one was stale, so the row
// heals ONCE instead of refetching on every read.
//
// H2b makes this load-bearing. Discover now writes a `thin` list-payload row per
// browsed item, stamped version 0 = "refetch on first detail read". Without a
// write-back that stamp never advances, so every view of every browsed item
// would hit TMDB again, forever — the refresh above was in-memory only, which
// was survivable when the only stale rows were a handful of pre-H2a leftovers
// and is not survivable once the catalog grows with everything anyone browses.
//
// Guarded on a uuid `mediaItemId`: the live paths (buildLiveLinks) put a SOURCE
// id there for an item with no row, and those must stay unstored.
function storeRefreshed(link: MediaLink, type: MediaType, fresh: MetaLink): void {
  if (!UUID_RE.test(link.mediaItemId) || !fresh.title) return;
  try {
    linkSourceToItem(link.mediaItemId, {
      source: link.source, sourceId: link.sourceId, type,
      title: fresh.title, releaseDate: fresh.releaseDate ?? link.releaseDate, rawData: fresh.rawData,
    });
  } catch { /* a failed heal just means we refetch next time — never break the read */ }
}

// Refresh stored game links (igdb/rawg) in-memory when they predate the current
// fetch shape. Same H2a change as ensureTmdbDetail: this used to sniff for
// `time_to_beat`/`screenshots`, which the projection would make look
// permanently stale. Now keyed on the explicit projection_version stamp.
export async function ensureGameDetail(links: MediaLink[], type: MediaType): Promise<boolean> {
  if (type !== "game") return false;
  let refreshed = false;
  const stale: { link: MediaLink; provider: "igdb" | "rawg" }[] = [];
  for (const provider of ["igdb", "rawg"] as const) {
    const link = links.find((l) => l.source === provider);
    if (link && link.rawData && (link.projectionVersion ?? 0) < PROJECTION_VERSION) {
      stale.push({ link, provider });
    }
  }
  for (const { link, provider } of stale) {
    try {
      const fresh = await METADATA[provider]?.fetchById?.(link.sourceId, type);
      if (fresh) { link.rawData = fresh.rawData; storeRefreshed(link, type, fresh); refreshed = true; }
    } catch { /* keep stored data */ }
  }
  return refreshed;
}

export interface EnrichmentOutcome {
  source: Source;
  outcome: "already-linked" | "linked" | "no-match" | "not-configured" | "error" | "skipped-primary";
}

// Title-search every non-primary metadata provider for this type that isn't
// already linked, and add what matches. (TMDB is `primary` — resolved by id, not
// guessed by name — so it's skipped here.) Returns one outcome per consulted
// provider so the debug view can show why a source is absent.
export async function enrichMissingSources(
  itemType: string,
  itemTitle: string,
  mediaItemId: string,
  links: MediaLink[],
  hasSources: Set<string>
): Promise<EnrichmentOutcome[]> {
  const outcomes: EnrichmentOutcome[] = [];
  // The earliest year among the already-linked sources is the best proxy for
  // the *original* release — ports/remasters/re-releases come later. Passing it
  // lets a provider disambiguate same-titled entries (e.g. IGDB returning a
  // BioShock port instead of the 2007 original).
  const knownYear = links
    .map((l) => extractYear(l.releaseDate))
    .filter((y): y is number => y != null)
    .reduce<number | null>((min, y) => (min == null || y < min ? y : min), null);
  for (const provider of metadataForType(itemType)) {
    if (hasSources.has(provider.id)) { outcomes.push({ source: provider.id, outcome: "already-linked" }); continue; }
    if (provider.primary || !provider.searchByTitle) { outcomes.push({ source: provider.id, outcome: "skipped-primary" }); continue; }
    if (provider.configured && !provider.configured()) { outcomes.push({ source: provider.id, outcome: "not-configured" }); continue; }
    try {
      const link = await provider.searchByTitle(itemTitle, itemType as MediaType, { year: knownYear });
      if (link) {
        links.push(toMediaLink(link, mediaItemId));
        outcomes.push({ source: provider.id, outcome: "linked" });
      } else {
        outcomes.push({ source: provider.id, outcome: "no-match" });
      }
    } catch {
      outcomes.push({ source: provider.id, outcome: "error" });
    }
  }
  return outcomes;
}

// Fetch OMDB scores (RT + IMDb + Metacritic + certification + awards + box
// office) and attach them to an enriched item in-place. Prefers an exact lookup
// by the IMDb id the merge already resolved (from TMDB/Trakt); falls back to a
// title+year search. Only applies to movies and shows.
//
// Takes PublicEnrichedItem: every field it touches is catalog data, and
// EnrichedItem is structurally assignable, so /api/detail passes its own item.
export async function applyOmdbScores(item: PublicEnrichedItem): Promise<void> {
  if (item.type === "game") return;
  try {
    let scores: OmdbResult;
    if (item.imdbId) {
      scores = await fetchOmdbByImdbId(item.imdbId);
    } else {
      const year = item.releaseDate ? parseInt(item.releaseDate.slice(0, 4)) : undefined;
      scores = await fetchOmdbScores(item.title, year, item.type === "show" ? "series" : "movie");
    }
    item.rtScore = scores.rtScore;
    item.imdbRating = scores.imdbRating;
    item.imdbId = scores.imdbID ?? item.imdbId;
    item.awards = scores.awards;
    item.boxOffice = scores.boxOffice;
    // OMDB metascore for movies/shows fills the gap left by RAWG (games-only).
    if (item.metacritic == null && scores.metascore != null) item.metacritic = scores.metascore;
    // OMDB certification (US rating) — add it to the union if not already there.
    if (scores.rated && !item.certification.includes(scores.rated)) item.certification.push(scores.rated);
    // Surface the IMDb score in the unified ratings row too.
    if (scores.imdbRating != null) {
      item.communityRatings = [
        ...item.communityRatings.filter((r) => r.source !== "imdb"),
        { source: "imdb", label: "IMDb", score: scores.imdbRating, outOf: 10, votes: scores.imdbVotes, url: scores.imdbID ? `https://www.imdb.com/title/${scores.imdbID}/` : null },
      ];
    }
    if (scores.rtScore != null) {
      item.communityRatings = [
        ...item.communityRatings.filter((r) => r.source !== "rt"),
        { source: "rt", label: "Rotten Tomatoes", score: scores.rtScore, outOf: 100 },
      ];
    }
  } catch { /* silently skip */ }
}
