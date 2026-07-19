// S8 — request-body schemas for the API routes. Each route parses its body with
// `parseJsonBody(req, <Schema>)` (see validate.ts); unknown keys are stripped,
// wrong types 400 instead of blowing up deeper as a 500/type-confusion.
//
// Schemas mirror the hand-written body types they replace — kept intentionally
// lenient where the routes were lenient (all-optional DELETE/refine bodies), and
// only tightened where a bad value is a real footgun (rating range, enums).

import { z } from "zod";

// ── Shared primitives (single source of truth for the domain enums) ──────────
export const zMediaType = z.enum(["game", "movie", "show"]);
export const zSource = z.enum(["steam", "rawg", "tmdb", "trakt", "igdb", "letterboxd"]);
export const zFacetRole = z.enum([
  "director", "writer", "creator", "cast",       // PersonRole
  "developer", "publisher", "studio", "network", // CompanyRole
]);
export const zSortKey = z.enum(["releaseDate", "popularity", "rating", "fandexScore"]);

// Cross-source id map, e.g. { tmdb: 603, trakt: "the-matrix" }. Flat, string keys.
export const zIds = z.record(z.string(), z.union([z.string(), z.number()]).nullable());

const zFacetRef = z.object({
  kind: z.string(),
  role: zFacetRole.optional(),
  key: z.string(),
  label: z.string().optional(),
});

const zMembership = z.object({
  library: z.enum(["include", "exclude", "only"]).optional(),
  wishlist: z.enum(["include", "exclude", "only"]).optional(),
});

const zFacetKey = z.object({ kind: z.string(), role: zFacetRole.optional(), key: z.string() });

export const zDiscoverFilters = z.object({
  types: z.array(zMediaType).optional(),
  yearMin: z.number().optional(),
  yearMax: z.number().optional(),
  communityMin: z.number().optional(),
  communityMax: z.number().optional(),
  runtimeMin: z.number().optional(),
  runtimeMax: z.number().optional(),
  sources: z.array(z.string()).optional(),
  membership: zMembership.optional(),
  includeFacets: z.array(zFacetKey).optional(),
  excludeFacets: z.array(zFacetKey).optional(),
});

export const zDiscoverRefine = z.object({
  seeds: z.array(z.string()).optional(),
  negSeeds: z.array(z.string()).optional(),
  likes: z.array(zFacetRef).optional(),
  dislikes: z.array(zFacetRef).optional(),
});

// ── Route body schemas ───────────────────────────────────────────────────────

// POST /api/watchlist — add to wishlist (+ platform write-back).
export const WatchlistPostSchema = z.object({
  type: zMediaType,
  ids: zIds,
  title: z.string().nullish(),
  releaseDate: z.string().nullish(),
  posterUrl: z.string().nullish(),
  targetProvider: zSource.optional(),
});

// DELETE /api/watchlist — remove from wishlist. Tolerant: resolves the item from
// mediaItemId or ids; an empty body is a no-op (allowEmpty at the call site).
export const WatchlistDeleteSchema = z.object({
  source: zSource.optional(),
  mediaItemId: z.string().optional(),
  ids: zIds.optional(),
});

// POST /api/library — rate and/or mark watched/played.
export const LibraryPostSchema = z.object({
  mediaItemId: z.string().optional(),
  rating: z.number().min(0).max(10).nullish(),
  status: z.string().nullish(),
  type: zMediaType.optional(),
  title: z.string().nullish(),
  releaseDate: z.string().nullish(),
  posterUrl: z.string().nullish(),
  ids: zIds.optional(),
});

// DELETE /api/library — clear rating/status. Tolerant like the watchlist DELETE.
export const LibraryDeleteSchema = z.object({
  mediaItemId: z.string().optional(),
  ids: zIds.optional(),
});

// POST /api/sync — trigger a provider sync. Missing body defaults to "all".
// `provider` starts a fresh run (a source id or "all"); `providers` is P6's
// resume list — the remaining provider ids the client re-invokes with.
export const SyncPostSchema = z.object({
  provider: z.union([zSource, z.literal("all")]).optional(),
  providers: z.array(z.string()).optional(),
});

// POST /api/settings — profile settings (currently just country).
export const SettingsPostSchema = z.object({
  country: z.string().min(1),
});

// POST /api/auth/disconnect — remove a connected identity.
export const DisconnectPostSchema = z.object({
  provider: zSource,
});

// POST /api/auth/rawg — RAWG email/password login.
export const RawgLoginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

// POST /api/discover/find — Taste Match query. Fully optional (lenient default).
export const FindSchema = z.object({
  q: z.string().optional(),
  refine: zDiscoverRefine.optional(),
  filters: zDiscoverFilters.optional(),
  sort: zSortKey.optional(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  excludeIgnored: z.boolean().optional(),
});

// POST /api/discover/fetch-more — grow the local catalog from top tags.
export const FetchMoreSchema = z.object({
  refine: zDiscoverRefine.optional(),
});

// POST /api/discover/facet-fetch — pull a facet's external set for search.
// `label` is required by FacetRefIn (used downstream), so default it to "".
export const FacetFetchSchema = z.object({
  facets: z
    .array(z.object({
      kind: z.string(),
      role: zFacetRole.optional(),
      key: z.string(),
      label: z.string().default(""),
    }))
    .optional(),
  types: z.array(zMediaType).optional(),
  membership: zMembership.optional(),
});

// ── H5.4 /dev/scoring (admin-only) ────────────────────────────────────────
const zRoleWeights = z.record(z.string(), z.number());

// PUT /api/dev/scoring — save role weights + C/K/cap.
export const ScoringConfigPutSchema = z.object({
  roleWeights: zRoleWeights,
  priorStrength: z.number().positive(),
  mappingConstantUp: z.number().positive(),
  mappingConstantDown: z.number().positive(),
  perCategoryCap: z.number().int().positive(),
});

// POST /api/dev/scoring/categories — create/edit one tag_category row.
export const TagCategoryPostSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "id must be lowercase-kebab"),
  label: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be a #rrggbb hex value"),
  weight: z.number().min(0),
  ignored: z.boolean(),
});

// PUT /api/dev/scoring/categories — batch weight/ignored save (the Weights
// panel's "Save weights" button; label/color/id are untouched).
export const TagCategoryWeightsPutSchema = z.object({
  updates: z.array(z.object({ id: z.string(), weight: z.number().min(0), ignored: z.boolean() })),
});

// POST /api/dev/scoring/overrides — reassign one tag key to a category.
export const TagCategoryOverridePostSchema = z.object({
  tagKey: z.string().min(1),
  categoryId: z.string().min(1),
});

// POST /api/dev/scoring/preview — score a sample item with draft weights.
export const ScoringPreviewSchema = z.object({
  config: ScoringConfigPutSchema,
  categoryWeights: z.array(z.object({ id: z.string(), weight: z.number().min(0), ignored: z.boolean() })),
  itemId: z.string().optional(),
});

// POST /api/dev/scoring/aliases — bundle member tag spellings under one canonical.
export const TagAliasPostSchema = z.object({
  canonical: z.string().min(1),
  members: z.array(z.string().min(1)).min(1),
});
