import { query } from "@/lib/db";
import { Source } from "@/types";

// The canonical per-item user-state shown on list / card / calendar items.
// `platformSources` is canonically the WISHLIST providers (so the source dots
// mean the same thing everywhere); library state is separate.
export interface UserState {
  platformSources: Source[];
  onWatchlist: boolean;
  libraryStatus: string | null;
  rating: number | null;
  reviewedAt: number | null;
}

const EMPTY: UserState = { platformSources: [], onWatchlist: false, libraryStatus: null, rating: null, reviewedAt: null };

// Batch-read wishlist + library state for a set of media_item ids (two queries).
export function getUserStateMap(userId: string, mediaItemIds: string[]): Map<string, UserState> {
  const map = new Map<string, UserState>();
  const ids = [...new Set(mediaItemIds.filter(Boolean))];
  if (ids.length === 0) return map;

  const ph = ids.map(() => "?").join(",");
  const watchlist = query<{ media_item_id: string; platform_sources: string }>(
    `SELECT media_item_id, platform_sources FROM user_watchlist WHERE user_id = ? AND media_item_id IN (${ph})`,
    [userId, ...ids]
  );
  const library = query<{ media_item_id: string; status: string | null; rating: number | null; reviewed_at: number | null }>(
    `SELECT media_item_id, status, rating, reviewed_at FROM user_library WHERE user_id = ? AND media_item_id IN (${ph})`,
    [userId, ...ids]
  );

  const wl = new Map<string, Source[]>(watchlist.map((r) => [r.media_item_id, JSON.parse(r.platform_sources ?? "[]") as Source[]]));
  const lib = new Map(library.map((r) => [r.media_item_id, r]));

  for (const id of ids) {
    const sources = wl.get(id) ?? [];
    const l = lib.get(id);
    map.set(id, {
      platformSources: sources,
      onWatchlist: sources.length > 0,
      libraryStatus: l?.status ?? null,
      rating: l?.rating ?? null,
      reviewedAt: l?.reviewed_at ?? null,
    });
  }
  return map;
}

// Resolve live items (e.g. discover) to their canonical media_item id via any of
// their source ids. One batched media_links query; matched by exact source+id.
export function resolveMediaIdsBySource(pairs: { source: string; sourceId: string }[]): Map<string, string> {
  const map = new Map<string, string>(); // "source:sourceId" → media_item_id
  const sourceIds = [...new Set(pairs.map((p) => String(p.sourceId)).filter(Boolean))];
  if (sourceIds.length === 0) return map;

  const ph = sourceIds.map(() => "?").join(",");
  const links = query<{ media_item_id: string; source: string; source_id: string }>(
    `SELECT media_item_id, source, source_id FROM media_links WHERE source_id IN (${ph})`,
    sourceIds
  );
  // Index by the exact source+id so e.g. tmdb 123 ≠ rawg 123.
  const byKey = new Map<string, string>();
  for (const l of links) byKey.set(`${l.source}:${l.source_id}`, l.media_item_id);

  for (const p of pairs) {
    const mid = byKey.get(`${p.source}:${p.sourceId}`);
    if (mid) map.set(`${p.source}:${p.sourceId}`, mid);
  }
  return map;
}

// Resolve a single canonical media_item id from a bag of source ids
// ({ tmdb: 123, trakt: 456 }). Used by the removal endpoints so a card that
// doesn't carry the local UUID (discover/feed items) can still be removed.
// Returns the first matching item, or null when none of the ids are known.
export function resolveMediaItemFromIds(ids: Record<string, unknown> | null | undefined): string | null {
  if (!ids) return null;
  const pairs = Object.entries(ids)
    .filter(([, v]) => v != null)
    .map(([source, sourceId]) => ({ source, sourceId: String(sourceId) }));
  if (!pairs.length) return null;
  for (const mid of resolveMediaIdsBySource(pairs).values()) return mid;
  return null;
}

export { EMPTY as EMPTY_USER_STATE };
