import { get, query } from "@/lib/db";
import { mergeLinks } from "@/lib/merge";
import { MediaType } from "@/types";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { BoundedCache } from "@/lib/boundedCache";
import { POOL_WHERE } from "@/lib/discovery";
import {
  PublicEnrichedItem, loadLinks, ensureTmdbDetail,
  ensureGameDetail, enrichMissingSources, applyOmdbScores,
} from "./enrich";

// P13 — the PUBLIC read path for an item, behind `/{type}/{uuid}/{slug}`.
//
// This runs the SAME enrichment pipeline as /api/detail (lib/detail/enrich.ts):
// refresh stale stored blobs, live-search the metadata providers that aren't
// linked yet, merge, then attach OMDB scores. An earlier version read stored
// data only — it rendered a fraction of the page (no cast, trailers,
// where-to-watch, RT/IMDb) even though every one of those is public data. The
// public page and the authed page now differ ONLY in the per-user overlay.
//
// THE BOUNDARY: this returns PublicEnrichedItem, which omits rating / ratings /
// review / reviewedAt / libraryStatus / platformSources. Nothing here reads
// user_library / user_watchlist / user_item_state, and the type makes a leak a
// compile error rather than a thing we must remember not to do. The per-user
// overlay belongs in /api/detail; it must never move down into here.
//
// Region: anonymous visitors have no users.country, so the merge runs at
// DEFAULT_COUNTRY. Region-aware dates/streaming (T22) stay a logged-in feature.

export interface PublicItemRow {
  id: string;
  type: MediaType;
  title: string;
}

// The item's stored row, or null. The caller checks `type` against the URL's
// type segment so /movie/<a-game-uuid>/x 404s instead of rendering.
export function loadPublicItemRow(id: string): PublicItemRow | null {
  const row = get<{ id: string; type: string; title: string }>(
    "SELECT id, type, title FROM media_items WHERE id = ?",
    [id]
  );
  return row ? { id: row.id, type: row.type as MediaType, title: row.title } : null;
}

// Cross-request cache for the built public detail (2026-07-20, post-P13b:
// every crawler re-visits all ~2,500 item pages, and each visit re-ran the
// whole enrichment pipeline — provider refetches, OMDB, merge). Keyed by
// id+region; leak-safe BY THE BOUNDARY ABOVE — PublicEnrichedItem structurally
// cannot carry per-user data, and region is an explicit input, so two viewers
// with the same key see identical bytes. Misses (null) are deliberately NOT
// cached: a just-persisted uuid must resolve on its very first visit.
const _detailCache = new BoundedCache<string, PublicEnrichedItem>({ max: 1000, ttlMs: 30 * 60 * 1000 });

// Full public detail for a stored item. Returns null when the item doesn't
// exist or has no links to merge (nothing to show → the page 404s).
export async function loadPublicDetail(
  id: string,
  region: string = DEFAULT_COUNTRY
): Promise<PublicEnrichedItem | null> {
  const cacheKey = `${id}:${region}`;
  const cached = _detailCache.get(cacheKey);
  if (cached) return cached;

  const row = loadPublicItemRow(id);
  if (!row) return null;

  const links = loadLinks(id);
  if (links.length === 0) return null;

  // Same steps as /api/detail: refresh stale blobs, then fill in the providers
  // this item isn't linked to yet (IGDB/Metacritic/Steam…).
  await ensureTmdbDetail(links, row.type);
  await ensureGameDetail(links, row.type);
  const hasSources = new Set(links.map((l) => l.source));
  await enrichMissingSources(row.type, row.title, id, links, hasSources);

  const enriched: PublicEnrichedItem = {
    id: row.id,
    type: row.type,
    ...mergeLinks(links, row.type, region),
  };
  await applyOmdbScores(enriched);

  _detailCache.set(cacheKey, enriched);
  return enriched;
}

// The item a source id belongs to, or null. Used by the LEGACY `/item?id=…&
// tmdbId=…` redirect, which is handed provider ids by urls in the wild and has
// to turn them into today's uuid url. This is a read-only index lookup — it is
// NOT the old live-resolve path (which fetched from providers and could write a
// row); a source id we've never stored simply doesn't resolve.
export function findItemBySourceId(source: string, sourceId: string): PublicItemRow | null {
  const row = get<{ media_item_id: string }>(
    "SELECT media_item_id FROM media_links WHERE source = ? AND source_id = ?",
    [source, sourceId]
  );
  return row ? loadPublicItemRow(row.media_item_id) : null;
}

// ── Resolving the url's id segment ───────────────────────────────────────────
//
// H2b — this used to be the interesting part of the file: the id segment could be
// a source id for a /discover result with no row, so resolving it meant a live
// provider build, an optional create-on-view write (gated to logged-in viewers,
// because a write driven by an inbound GET lets a bot walk a provider's id space),
// and a "canonicalId may be null" state that rippled out into the page's metadata
// and redirects. Discover persists now, so the id is always a uuid and resolving
// is just "load the row". All of that is gone.

export interface ResolvedPublic {
  item: PublicEnrichedItem;
  /** The DB uuid. Always set — kept so the page can canonical-redirect on slug drift. */
  canonicalId: string;
}

/**
 * Resolve the url's id segment (a uuid) to a public item, or null if there's no
 * such row. A uuid that isn't in the DB is just a dead url.
 */
export async function resolvePublicDetail(
  id: string,
  type: MediaType,
  region: string = DEFAULT_COUNTRY
): Promise<ResolvedPublic | null> {
  const row = loadPublicItemRow(id);
  if (!row || row.type !== type) return null;
  const item = await loadPublicDetail(id, region);
  return item ? { item, canonicalId: id } : null;
}

// Every item eligible for a public page — drives sitemap.xml.
//
// 2026-07-22 (PR13): scoped to the POOL, same predicate discovery.ts uses for
// Best-match/Insights. Before this, every `browsed=1` row (crawler-visited
// facet-page titles) was in here too — the pool grew to ~676k rows against a
// library of under 2,000, and the resulting sitemap was ~135 MB / 13.5x
// Google's 50,000-URL cap, almost certainly rejected outright. A browsed item
// still has a working page (it 404s only if it truly has no links) — it's just
// not advertised for crawling, matching what recommendIngest already treats as
// "not a catalog entry" everywhere else.
export function listPublicItems(): { id: string; type: MediaType; title: string; updatedAt: number | null }[] {
  return query<any>(
    `SELECT mi.id, mi.type, mi.title, MAX(ml.last_synced) AS updated_at
       FROM media_items mi
       JOIN media_links ml ON ml.media_item_id = mi.id
      WHERE ${POOL_WHERE}
      GROUP BY mi.id
      ORDER BY mi.id`
  ).map((r: any) => ({ id: r.id, type: r.type as MediaType, title: r.title, updatedAt: r.updated_at ?? null }));
}
