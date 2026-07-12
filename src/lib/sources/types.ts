import { MediaType, Source } from "@/types";

// ── MediaSource adapter contract ──────────────────────────────────────────────
//
// One interface every connectable platform implements, so the rest of the app
// (sync, per-item refresh, watchlist/library write-backs, the wishlist panel)
// can drive any provider through the same shape instead of per-provider `if`
// branches. Adding a platform becomes: implement this + register it.
//
// Capabilities are DECLARATIVE — consumers check them rather than try/catch to
// discover what a platform can do (e.g. Steam is read-only; RAWG has no review
// text). A data method is only present when its matching capability is true.

export interface Capabilities {
  wishlist: { read: boolean; write: boolean };
  library:  { read: boolean };
  rating:   { read: boolean; write: boolean };
  review:   { read: boolean; write: boolean };
  status:   { write: boolean };
}

// Cross-reference ids known for an item, used to resolve a provider's own id
// (e.g. Trakt/Letterboxd resolve their id from a TMDB id).
export interface CrossIds {
  tmdb?: string | number | null;
  trakt?: string | number | null;
  rawg?: string | number | null;
  steam?: string | number | null;
  letterboxd?: string | number | null;
}

// Everything needed to act for one user on one provider. Produced by
// `MediaSource.context()`, which also handles provider-specific token refresh.
export interface SourceContext {
  userId: string;
  identity: any;          // the user_identities row
  token: string | null;   // resolved (refreshed) access token, null if none
  slug: string | null;    // provider handle: rawg slug, steam id, trakt user…
}

// A normalized item pulled from a provider. Wishlist pulls fill the first block;
// library pulls additionally fill rating/review/status. `rating` is already on
// the app's 0–10 scale — scale conversion lives in the adapter, not consumers.
export interface PulledItem {
  sourceId: string;
  title: string;
  releaseDate: string | null;
  rawData: any;
  type?: MediaType;            // set when a provider spans types (e.g. Trakt movies+shows)
  rating?: number | null;
  review?: string | null;
  status?: string | null;      // watched | played | owned
  reviewedAt?: number | null;  // unix seconds
}

export interface MediaSource {
  id: Source;
  label: string;
  color: string;
  mediaTypes: MediaType[];
  auth: "oauth" | "openid" | "credentials";
  capabilities: Capabilities;

  // Resolve a usable context (refreshing tokens as needed) for this provider.
  // Returns null when the user hasn't connected it.
  context(userId: string): Promise<SourceContext | null>;

  // Resolve this provider's own id for an item from cross-reference ids
  // (e.g. via TMDB). `meta` carries a title/year hint for search-based providers.
  // Returns null when unresolvable. Required for write paths on multi-id items.
  resolveSourceId?(
    ctx: SourceContext,
    type: MediaType,
    ids: CrossIds,
    meta?: { title?: string | null; year?: number | null }
  ): Promise<string | null>;

  // Does a pulled item correspond to the item identified by `ids`? Used by the
  // single-item refresh to find one item in a provider's pulled list. Defaults to
  // own-id equality; Trakt/Letterboxd override to also match via a TMDB cross-ref.
  matches?(item: PulledItem, ids: CrossIds): boolean;

  // ── Data ops — present only when the matching capability is true ──
  // `pushRating` is self-contained: it records the score AND marks the item
  // consumed (watched/played), since a rating implies consumption. `pushStatus`
  // marks consumed without a score. This lets consumers dispatch with a simple
  // else-if while preserving each provider's native semantics.
  pullWishlist?(ctx: SourceContext): Promise<PulledItem[]>;
  pushWishlist?(ctx: SourceContext, sourceId: string, type: MediaType, add: boolean): Promise<void>;
  pullLibrary?(ctx: SourceContext): Promise<PulledItem[]>;
  pushRating?(ctx: SourceContext, sourceId: string, type: MediaType, appRating: number): Promise<void>;
  pushStatus?(ctx: SourceContext, sourceId: string, type: MediaType, status: string): Promise<void>;
  // Clear ONLY the rating on the platform, leaving watched/consumed state intact
  // (Trakt keeps rating + history separate; TMDB has only a rating). Used when the
  // user removes their score but keeps the item watched.
  clearRating?(ctx: SourceContext, sourceId: string, type: MediaType): Promise<void>;
  // Undo library membership on the platform: clear the rating AND un-mark watched
  // so a later resync doesn't re-pull the removed state. Present when the platform
  // can write ratings/status. (TMDB has no watched concept → clears the rating.)
  removeFromLibrary?(ctx: SourceContext, sourceId: string, type: MediaType): Promise<void>;

  // Cross-enrich a freshly-persisted item with secondary source links (e.g.
  // Trakt/Letterboxd → TMDB, Steam ↔ RAWG). `kind` lets the adapter skip
  // expensive name-search enrichment for large library pulls while keeping the
  // cheap id-based TMDB enrichment everywhere — matching the legacy behavior.
  enrich?(item: PulledItem, mediaItemId: string, kind: "wishlist" | "library"): Promise<void>;
}
