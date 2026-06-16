// The single normalized item shape for the two ubiquitous media components:
// PosterCard (card view) and ListCard (list view). Every list/grid item across
// the app — library, wishlist, discover/Taste Match, facet detail — satisfies
// it (EnrichedItem and the discover/facet item shapes are all assignable).
export interface MediaCardItem {
  id: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;          // portrait box-art (card view)
  backdropUrl?: string | null;       // landscape art (list-row thumbnail); falls back to posterUrl
  platformSources?: string[];   // wishlist providers
  onWatchlist?: boolean;
  dates?: { source: string; date: string }[];
  rating?: number | null;        // personal score (0-10)
  ratings?: { source: string; rating: number }[]; // per-platform breakdown
  libraryStatus?: string | null; // watched | played | owned
  // Identity for quick actions (rate / wishlist) without opening the detail page.
  sources?: { source: string; sourceId: string }[];
  ids?: Record<string, string | number>;
}
