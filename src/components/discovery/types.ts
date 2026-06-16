// Client-side mirror of the Taste Match API shapes (kept free of server imports).

export interface Reason { kind: string; role?: string; label: string; category?: string; contribution: number }

export interface DiscoverItem {
  id: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  communityScore: number | null;
  communityAvg: number | null;
  platformSources: string[];
  onWatchlist: boolean;
  libraryStatus: string | null;
  rating: number | null;
  sources: { source: string; sourceId: string }[];
  score: number;
  reasons: Reason[];
}

export interface FacetPill { kind: string; role?: string; key: string; label: string }
export interface SeedPill { id: string; title: string; type: string; posterUrl: string | null }

export type Membership = "include" | "exclude" | "only";
export type SortKey = "releaseNew" | "releaseOld" | "userRating" | "platformRating" | "match";

// The single shared sort option set (T8), used by Discover / Wishlist / Library.
export const SORTS: [SortKey, string][] = [
  ["releaseNew", "Release (newest)"],
  ["releaseOld", "Release (oldest)"],
  ["userRating", "Your rating"],
  ["platformRating", "Platform rating"],
  ["match", "Best match"],
];

// Sorts whose result list is grouped/scrolled by date (calendar view allowed).
export const DATE_SORTS: SortKey[] = ["releaseNew", "releaseOld"];

export interface FindResult {
  baseline: number;
  total: number;
  profileSummary: { topPositive: Reason[]; topNegative: Reason[] };
  items: DiscoverItem[];
}

export interface VocabMatch { kind: string; role?: string; key: string; label: string; count: number }
export interface TitleMatch { id: string; title: string; type: string; posterUrl: string | null; year: number | null }

// UI filter state. Ranges are stored as raw slider [lo, hi]; the request builder
// only sends a bound when the slider is off its extreme (so full-range never
// excludes items with a null year/community/runtime).
export interface UiFilters {
  types: string[];
  sources: string[];
  yearRange: [number, number];
  commRange: [number, number];
  runtimeRange: [number, number];
  membership: { library?: Membership; wishlist?: Membership };
  includeFacets: FacetPill[];
  excludeFacets: FacetPill[];
}

export const YEAR_MIN = 1950;
export const YEAR_MAX = 2027;
export const RUNTIME_MAX = 240;

export function defaultUiFilters(): UiFilters {
  return {
    types: [], sources: [],
    yearRange: [YEAR_MIN, YEAR_MAX], commRange: [0, 100], runtimeRange: [0, RUNTIME_MAX],
    membership: {}, includeFacets: [], excludeFacets: [],
  };
}
