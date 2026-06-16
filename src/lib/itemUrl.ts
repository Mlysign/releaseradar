// Builds the URL for the item inspection page (`/item`). Works for every entry
// point: watchlist/library items carry a UUID + a `sources` array, while
// discover items carry a composite id + an `ids` object. Both serialize into
// the same query shape that `/api/detail` already knows how to resolve.
import { CATALOG } from "@/lib/sources/catalog";

export interface InspectableItem {
  id: string;
  type: string;
  title?: string | null;
  releaseDate?: string | null;
  posterUrl?: string | null;
  // Watchlist / library shape
  sources?: { source: string; sourceId: string }[];
  // Discover shape
  ids?: { rawg?: number | string; tmdb?: number | string; trakt?: number | string; steam?: number | string; letterboxd?: number | string };
}

// source → `/item` query-param name, declared once on the catalog entries (A5).
const SOURCE_PARAM: Record<string, string> = Object.fromEntries(
  Object.values(CATALOG).map((m) => [m.id, m.urlParam]),
);

// The param names themselves, for the read side (`/item` forwarding the ids it
// received). Replaces the hardcoded `["rawgId", "tmdbId", …]` lists.
export const SOURCE_PARAMS: string[] = Object.values(CATALOG).map((m) => m.urlParam);

export function buildItemHref(item: InspectableItem): string {
  const p = new URLSearchParams();
  p.set("id", item.id);
  p.set("type", item.type);
  if (item.title) p.set("title", item.title);
  if (item.posterUrl) p.set("posterUrl", item.posterUrl);

  // Source ids from the watchlist `sources` array…
  for (const s of item.sources ?? []) {
    const key = SOURCE_PARAM[s.source];
    if (key && s.sourceId) p.set(key, String(s.sourceId));
  }
  // …or from the discover `ids` object.
  if (item.ids) {
    for (const [source, val] of Object.entries(item.ids)) {
      const key = SOURCE_PARAM[source];
      if (key && val != null) p.set(key, String(val));
    }
  }

  return `/item?${p.toString()}`;
}

// Link to the insights facet detail page for a tag / person / company.
export function buildFacetHref(f: { kind: string; role?: string; key: string; label: string }): string {
  const p = new URLSearchParams();
  p.set("kind", f.kind);
  if (f.role) p.set("role", f.role);
  p.set("key", f.key);
  p.set("label", f.label);
  return `/insights/facet?${p.toString()}`;
}
