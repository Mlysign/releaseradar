// Client-side mirror of the Taste Match API shapes (kept free of server imports).

// BA/n (H5.2 §3.4): the facet's Bayesian average + rated-item count, only
// populated on Fandex Score reasons (not the older Discover match-score ones).
export interface Reason { kind: string; role?: string; label: string; category?: string; contribution: number; BA?: number; n?: number; capped?: boolean }

export interface DiscoverItem {
  id: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  communityScore: number | null;
  communityAvg: number | null;
  communityVotes: number;
  platformSources: string[];
  onWatchlist: boolean;
  libraryStatus: string | null;
  rating: number | null;
  sources: { source: string; sourceId: string }[];
  score: number;
  reasons: Reason[];
  fandexScore: number | null;
  // PR15 (2026-07-22): absent/true means linkable, same convention as
  // MediaCardItem (cardItem.ts). false for an anonymous-viewer result that
  // wasn't persisted to a real row — id is a synthetic composite key
  // (`tmdb-movie-…`), not a uuid, so PosterCard/ListCard must not link it.
  linkable?: boolean;
}

export interface FacetPill { kind: string; role?: string; key: string; label: string }
export interface SeedPill { id: string; title: string; type: string; posterUrl: string | null }

export type Membership = "include" | "exclude" | "only";
export type SortKey = "releaseDate" | "popularity" | "rating" | "fandexScore";

// The single shared sort option set, used by Discover / Wishlist / Library AND
// mirrored on the facet pages. "Rating" is Bayesian-damped (see ratingsSort.ts);
// "Fandex Score" is personal (logged-in). Unified 2026-07-19.
export const SORTS: [SortKey, string][] = [
  ["releaseDate", "Release date"],
  ["popularity", "Popularity"],
  ["rating", "Rating"],
  ["fandexScore", "Fandex Score"],
];

// Sorts whose result list is grouped/scrolled by date (calendar view allowed).
export const DATE_SORTS: SortKey[] = ["releaseDate"];

// Map any stored/legacy sort value to a valid SortKey. Old keys (releaseNew,
// platformRating, match, …) linger in sessionStorage across a deploy; anything
// unknown falls back to `fallback`.
export function normalizeSort(v: unknown, fallback: SortKey = "fandexScore"): SortKey {
  const valid: SortKey[] = ["releaseDate", "popularity", "rating", "fandexScore"];
  if (typeof v === "string" && (valid as string[]).includes(v)) return v as SortKey;
  const legacy: Record<string, SortKey> = {
    releaseNew: "releaseDate",
    releaseOld: "releaseDate",
    platformRating: "rating",
    userRating: "fandexScore",
    match: "fandexScore",
  };
  return (typeof v === "string" && legacy[v]) || fallback;
}

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
