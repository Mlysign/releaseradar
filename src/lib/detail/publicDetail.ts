import { get, query } from "@/lib/db";
import { mergeLinks } from "@/lib/merge";
import { MediaLink, MediaType, Source } from "@/types";
import { DEFAULT_COUNTRY } from "@/lib/countries";

// P13 — the PUBLIC read path for an item, used by the server-rendered
// `/{type}/{uuid}/{slug}` page. This is the security boundary for making detail
// pages public, so two rules hold here and are worth stating plainly:
//
// 1. NO PERSONAL DATA, BY CONSTRUCTION. A PublicItem is `{id, type}` plus
//    exactly what `mergeLinks` returns, and mergeLinks only ever derives catalog
//    metadata from media_links (the third-party payloads). It cannot see
//    user_library / user_watchlist / user_item_state, so a rating, review,
//    libraryStatus or platformSources CANNOT leak through this type — the
//    compiler rejects them rather than us remembering to strip them. Anything
//    personal belongs in the authed overlay, never here.
//
// 2. NO LIVE PROVIDER CALLS. Unlike /api/detail (which title-searches every
//    provider and refreshes stale blobs on each request), this reads stored data
//    only. These pages are crawlable: a bot walking ~2,500 of them would
//    otherwise fire thousands of TMDB/IGDB/OMDB requests, blow the rate limits,
//    and make every page slow. Stored-only keeps a render a few local SQLite
//    reads — fast and safely cacheable. Freshness stays the sync's job.
//
// Region: anonymous visitors have no `users.country`, so the merge runs at
// DEFAULT_COUNTRY. Region-aware release dates/streaming are a logged-in feature
// (T22); a shared link shows the neutral default.

export interface PublicItemRow {
  id: string;
  type: MediaType;
  title: string;
}

// `{id, type}` + the merge's catalog output. Deliberately NOT EnrichedItem:
// that carries platformSources/rating/review, which are per-user.
export type PublicItem = { id: string; type: MediaType } & ReturnType<typeof mergeLinks>;

export function loadLinks(mediaItemId: string): MediaLink[] {
  return query<any>("SELECT * FROM media_links WHERE media_item_id = ?", [mediaItemId]).map((r: any) => ({
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

// The item's stored row, or null. `type` is checked by the caller against the
// URL's type segment so /movie/<a-game-uuid>/x 404s instead of rendering.
export function loadPublicItemRow(id: string): PublicItemRow | null {
  const row = get<{ id: string; type: string; title: string }>(
    "SELECT id, type, title FROM media_items WHERE id = ?",
    [id]
  );
  return row ? { id: row.id, type: row.type as MediaType, title: row.title } : null;
}

// Full public detail for a stored item. Returns null when the item doesn't
// exist or has no links to merge (nothing to show → the page 404s).
export function loadPublicDetail(id: string, region: string = DEFAULT_COUNTRY): PublicItem | null {
  const row = loadPublicItemRow(id);
  if (!row) return null;

  const links = loadLinks(id);
  if (links.length === 0) return null;

  return { id: row.id, type: row.type, ...mergeLinks(links, row.type, region) };
}

// Every item eligible for a public page — drives sitemap.xml.
export function listPublicItems(): { id: string; type: MediaType; title: string; updatedAt: number | null }[] {
  return query<any>(
    `SELECT mi.id, mi.type, mi.title, MAX(ml.last_synced) AS updated_at
       FROM media_items mi
       JOIN media_links ml ON ml.media_item_id = mi.id
      GROUP BY mi.id
      ORDER BY mi.id`
  ).map((r: any) => ({ id: r.id, type: r.type as MediaType, title: r.title, updatedAt: r.updated_at ?? null }));
}
