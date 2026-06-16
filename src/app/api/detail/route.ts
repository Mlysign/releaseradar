import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { query, get } from "@/lib/db";
import { mergeLinks, explainMerge, extractYear } from "@/lib/merge";
import { MediaLink, EnrichedItem, Source, MediaType } from "@/types";
import { fetchOmdbScores, fetchOmdbByImdbId, OmdbResult } from "@/lib/sources/omdb";
import { METADATA, metadataForType } from "@/lib/metadata/registry";
import { MetaLink } from "@/lib/metadata/types";
import { parseRatings, averageRating } from "@/lib/ratings";
import { getPlatformStatus } from "@/lib/watchlistStatus";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Canonical detail resolver ─────────────────────────────────────────────────
// One flow for every entry point (dashboard / library / discover). Given any item
// identity it always returns the SAME shape: live-enriched metadata + wishlist
// status across providers + library (watched/played + rating). This is the single
// mechanic that gathers everything the detail panel needs.
export const GET = withUser(async (req: NextRequest, session) => {
    const { searchParams } = req.nextUrl;

    const id = searchParams.get("id");
    const type = searchParams.get("type") as MediaType | null;
    const title = searchParams.get("title");
    const sourceIds = readSourceIds(searchParams);
    const debugMode = searchParams.get("debug") === "1";

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    // 1. Resolve the canonical media_item — by UUID, else by any provided source id.
    let mediaItemId: string | null = UUID_RE.test(id) ? id : resolveBySourceIds(type, sourceIds);

    const item = mediaItemId ? get<any>("SELECT * FROM media_items WHERE id = ?", [mediaItemId]) : null;
    if (mediaItemId && !item) mediaItemId = null; // stale id → treat as live-only

    const resolvedVia: "uuid" | "source-id" | "live" = item ? (UUID_RE.test(id) ? "uuid" : "source-id") : "live";
    const itemType: MediaType = (item?.type ?? type ?? "game") as MediaType;

    // 2. Build the source links — from DB when stored, else live from the sources.
    let links: MediaLink[];
    if (item) {
      links = loadLinks(mediaItemId!);
    } else {
      links = await buildLiveLinks(id, itemType, title, sourceIds);
    }
    const dbSources = new Set(item ? links.map((l) => l.source) : []);

    // Older stored items predate the richer payloads — refresh their stored
    // links in-memory so the new fields are always available.
    const tmdbRefreshed = await ensureTmdbDetail(links, itemType);
    await ensureGameDetail(links, itemType);

    // 3. Live-enrich any missing sources (always checks the other online DBs).
    const hasSources = new Set(links.map((l) => l.source));
    const enrichment = await enrichMissingSources(itemType, item?.title ?? title ?? "", mediaItemId ?? id, links, hasSources);

    if (links.length === 0 && !item) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // 4. Merge canonical metadata.
    const merged = mergeLinks(links, itemType);

    // 5. Attach the user's wishlist + library state (empty when not in DB).
    const watchlistRow = mediaItemId
      ? get<{ platform_sources: string }>(
          "SELECT platform_sources FROM user_watchlist WHERE media_item_id = ? AND user_id = ?",
          [mediaItemId, session.userId]
        )
      : null;
    const libraryRow = mediaItemId
      ? get<any>(
          "SELECT platform_sources, status, rating, review, reviewed_at, metadata FROM user_library WHERE media_item_id = ? AND user_id = ?",
          [mediaItemId, session.userId]
        )
      : null;

    const platformSources: Source[] = Array.from(new Set<Source>([
      ...JSON.parse(watchlistRow?.platform_sources ?? "[]"),
      ...JSON.parse(libraryRow?.platform_sources ?? "[]"),
    ]));

    const enriched: EnrichedItem = {
      id: mediaItemId ?? id,
      type: itemType,
      platformSources,
      ...merged,
      ...(libraryRow ? (() => {
        const r = parseRatings(libraryRow.metadata);
        return {
          rating: averageRating(r) ?? libraryRow.rating,
          ratings: r,
          review: libraryRow.review,
          reviewedAt: libraryRow.reviewed_at,
          libraryStatus: libraryRow.status,
        };
      })() : {}),
    };
    await applyOmdbScores(enriched);

    // 6. Provider wishlist status (shared helper — same shape everywhere).
    const { platforms, onAnyList } = getPlatformStatus(session.userId, mediaItemId, itemType);

    // 7. Debug payload (only when ?debug=1): merge provenance for the debug panel.
    const debug = debugMode
      ? {
          resolvedVia,
          mediaItemId,
          links: links.map((l) => ({
            source: l.source,
            sourceId: l.sourceId,
            origin: dbSources.has(l.source) ? "db" : hasSources.has(l.source) ? "live-id" : "live-search",
            title: l.title,
            releaseDate: l.releaseDate,
            lastSynced: l.lastSynced,
            rawBytes: JSON.stringify(l.rawData).length,
            ...(l.source === "tmdb" && tmdbRefreshed ? { tmdbRefreshed: true } : {}),
          })),
          enrichment,
          matrix: explainMerge(links, itemType),
        }
      : undefined;

    return NextResponse.json({
      item: enriched,
      platforms,
      resolvedMediaItemId: mediaItemId,
      onAnyList,
      ...(debug ? { debug } : {}),
    });
});

// ── Identity helpers ──────────────────────────────────────────────────────────

interface SourceIds {
  rawg: string | null;
  tmdb: string | null;
  trakt: string | null;
  steam: string | null;
  letterboxd: string | null;
}

function readSourceIds(sp: URLSearchParams): SourceIds {
  return {
    rawg:       sp.get("rawgId"),
    tmdb:       sp.get("tmdbId"),
    trakt:      sp.get("traktId"),
    steam:      sp.get("steamId"),
    letterboxd: sp.get("letterboxdId"),
  };
}

// Resolve an existing media_item from any provided source id via media_links.
function resolveBySourceIds(type: MediaType | null, ids: SourceIds): string | null {
  const candidates: { source: string; id: string }[] = [];
  if (ids.rawg)       candidates.push({ source: "rawg",       id: ids.rawg });
  if (ids.tmdb)       candidates.push({ source: "tmdb",       id: ids.tmdb });
  if (ids.trakt)      candidates.push({ source: "trakt",      id: ids.trakt });
  if (ids.steam)      candidates.push({ source: "steam",      id: ids.steam });
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

function loadLinks(mediaItemId: string): MediaLink[] {
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
  }));
}

// Wrap a normalized MetaLink as an in-memory MediaLink for merging.
function toMediaLink(link: MetaLink, mediaItemId: string): MediaLink {
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
// each known id through its MetadataProvider. The remaining sources are filled in
// by enrichMissingSources().
async function buildLiveLinks(
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

// Refresh a stored movie/show's TMDB link in-memory when it lacks the newer
// appended blocks (keywords, then external_ids/release_dates/content_ratings).
// Returns whether the stored data was replaced with a fresh fetch.
async function ensureTmdbDetail(links: MediaLink[], type: MediaType): Promise<boolean> {
  if (type !== "movie" && type !== "show") return false;
  const tmdb = links.find((l) => l.source === "tmdb");
  // external_ids is the most recent append — its absence means the stored blob
  // predates the richer fetch even if keywords are present.
  if (!tmdb || (tmdb.rawData?.keywords && tmdb.rawData?.external_ids)) return false;
  try {
    const fresh = await METADATA.tmdb?.fetchById?.(tmdb.sourceId, type);
    if (fresh) {
      tmdb.rawData = fresh.rawData;
      return true;
    }
  } catch { /* keep stored data */ }
  return false;
}

// Refresh stored game links (igdb/rawg) in-memory when they predate the richer
// field set. IGDB without `time_to_beat` and RAWG without `screenshots` are the
// markers that a stored blob was fetched before this change.
async function ensureGameDetail(links: MediaLink[], type: MediaType): Promise<boolean> {
  if (type !== "game") return false;
  let refreshed = false;
  const stale: { link: MediaLink; provider: "igdb" | "rawg" }[] = [];
  const igdb = links.find((l) => l.source === "igdb");
  if (igdb && igdb.rawData && !("time_to_beat" in igdb.rawData) && !igdb.rawData.themes) {
    stale.push({ link: igdb, provider: "igdb" });
  }
  const rawg = links.find((l) => l.source === "rawg");
  if (rawg && rawg.rawData && !rawg.rawData.screenshots) {
    stale.push({ link: rawg, provider: "rawg" });
  }
  for (const { link, provider } of stale) {
    try {
      const fresh = await METADATA[provider]?.fetchById?.(link.sourceId, type);
      if (fresh) { link.rawData = fresh.rawData; refreshed = true; }
    } catch { /* keep stored data */ }
  }
  return refreshed;
}

// ── Shared helper: live-enrich missing sources for a known item ───────────────
// Title-search every non-primary metadata provider for this type that isn't
// already linked, and add what matches. (TMDB is `primary` — resolved by id, not
// guessed by name — so it's skipped here.) Returns one outcome per consulted
// provider so the debug view can show why a source is absent.
interface EnrichmentOutcome {
  source: Source;
  outcome: "already-linked" | "linked" | "no-match" | "not-configured" | "error" | "skipped-primary";
}

async function enrichMissingSources(
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
async function applyOmdbScores(item: EnrichedItem): Promise<void> {
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
