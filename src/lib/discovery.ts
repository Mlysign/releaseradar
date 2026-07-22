// Taste Match — the discovery/recommendation engine that replaces the tag-slider
// "For You". It builds a multi-facet preference profile from the user's ratings
// (tags + people + companies), where facets rated below the user's baseline get
// NEGATIVE weight (so dislikes emerge automatically), refines it with optional
// example-title seeds + manual like/dislike pills, and ranks the WHOLE local
// catalog with explainable reasons — plus extensive filtering and sorting.

import { query, get } from "@/lib/db";
import { BoundedCache } from "@/lib/boundedCache";
import { mergeLinks, extractYear } from "@/lib/merge";
import { representativeCommunity, averageCommunity } from "@/lib/ratings";
import { getUserStateMap } from "@/lib/userState";
import { extractFacets, Facet, facetId, FacetRole, personKey, companyKey } from "@/lib/facets";
import { getLibraryFacetAnalysis, librarySignature } from "@/lib/libraryAnalysis";
import { getScoringConfig, getTagCategories, getTagCategoryOverrides, scoringConfigSignature, TagCategoryConfig } from "@/lib/scoringConfig";
import { applyTagAliases, canonicalTagKey, getTagAliases, tagAliasSignature } from "@/lib/tagAlias";
import { communityVotes, bayesRating, ratingPrior } from "@/lib/ratingsSort";
import { ScoringConfigValues } from "@/lib/scoringDefaults";
import { MediaLink, MediaType } from "@/types";

// ── Tunables ───────────────────────────────────────────────────────
// K_SHRINK (the old raw·count/(count+K) confidence shrink) is gone from HERE —
// buildProfile() now reads its Bayesian equivalent (priorStrength, C) from
// scoringConfig.ts (H5.2). ROLE_WEIGHT stays: liveDiscover.ts's membership-prior
// scoring (a different, non-Fandex-Score signal) still reads it directly.
const TOP_K_FACETS = 8;      // only an item's strongest matches score it (anti facet-dense)
const SEED_BOOST = 1.25;     // example title you like → amplify its (positive) facets
const SEED_PENALTY = 1.25;   // example title you dislike → amplify its (negative) facets
const MANUAL_LIKE = 2.0;     // like pill bump
const MANUAL_DISLIKE = -2.0; // dislike pill bump
export const ROLE_WEIGHT: Record<string, number> = {
  director: 1.3, creator: 1.3, writer: 1.0, cast: 0.6,
  developer: 1.2, publisher: 0.8, studio: 0.7, network: 0.6, tag: 1.0,
};

// ── Types ──────────────────────────────────────────────────────────
export interface DiscoveryVector {
  id: string;
  type: MediaType;
  title: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  releaseDate: string | null;
  year: number | null;
  communityScore: number | null; // 0-100 representative (one source)
  communityAvg: number | null;   // 0-100 average across all DBs (platform-rating sort)
  communityVotes: number;        // summed vote count across sources (popularity + bayes rating)
  runtimeMinutes: number | null;
  addedAt: number;
  sources: { source: string; sourceId: string }[];
  facets: Facet[];
}

export interface VocabEntry { kind: string; role?: FacetRole; key: string; label: string; count: number }

// H5.2 §3.4: BA/n (the facet's Bayesian average + rated-item count) are
// populated by computeFandexScore's reasons so the expanded "why" view can
// read e.g. "Director — 8.9 avg over 4 titles". Optional: scoreFacets'
// (unchanged, idf-weighted Discover-ranking) reasons don't carry them.
// Q29: `capped` (computeFandexScore only) — this facet matched but lost the
// per-category-cap cut, contribution pinned to 0. scoreFacets' reasons never
// set it (that ranking score has no such cap).
export interface Reason { kind: string; role?: FacetRole; label: string; category?: string; contribution: number; BA?: number; n?: number; capped?: boolean }

export interface MembershipFilter { library?: "include" | "exclude" | "only"; wishlist?: "include" | "exclude" | "only" }

export interface DiscoverFilters {
  types?: MediaType[];
  yearMin?: number; yearMax?: number;
  communityMin?: number; communityMax?: number;
  runtimeMin?: number; runtimeMax?: number;
  sources?: string[];
  membership?: MembershipFilter;
  includeFacets?: { kind: string; role?: FacetRole; key: string }[];
  excludeFacets?: { kind: string; role?: FacetRole; key: string }[];
}

export interface FacetRef { kind: string; role?: FacetRole; key: string; label?: string }
export interface DiscoverRefine {
  seeds?: string[];     // media_item ids you like ("more like this")
  negSeeds?: string[];  // media_item ids you dislike
  likes?: FacetRef[];
  dislikes?: FacetRef[];
}

// Unified sort set (2026-07-19): release date (newest), popularity (vote count),
// rating (Bayesian-damped), and the personalized Fandex Score.
export type SortKey = "releaseDate" | "popularity" | "rating" | "fandexScore";

export interface FindRequest {
  q?: string;            // free-text title query (T5 search)
  refine?: DiscoverRefine;
  filters?: DiscoverFilters;
  sort?: SortKey;
  limit?: number;
  offset?: number;
  excludeIgnored?: boolean;  // T10 feed: drop items the user swiped away
}

// ── Candidate cache (whole catalog, user-independent) ──────────────
const CANDIDATE_TTL_MS = 5 * 60 * 1000;
let _cache: { sig: string; aliasSig: string; at: number; vectors: DiscoveryVector[]; byId: Map<string, DiscoveryVector>; vocab: VocabEntry[]; idf: Map<string, number> } | null = null;

// ── The catalog POOL (H2b) ───────────────────────────────────────────────────
//
// Since H2b, media_items is no longer "the library": /discover writes a row for
// every item it returns, so the table is library + recommendIngest's pool +
// everything anyone has browsed past. Everything in this module — the Best-match
// candidate set, Insights, searchTitles, and the IDF weights — means the first
// two and NOT the third. A browsed row is a url target, not a catalog entry.
//
// So the pool is: anything not marked `browsed` (library, synced, ingested),
// UNION anything any user has acted on. The union is what makes promotion
// automatic — wishlist a browsed title and it joins the pool on the next rebuild,
// with no flag to flip and no way for the two to disagree.
//
// NOT filtered on membership alone: recommendIngest deliberately persists unowned
// titles so the recommender has a real pool to rank, and those must stay.
//
// Exported (2026-07-22, PR13) so other pool-scoped reads — the sitemap — use
// the SAME predicate instead of re-deriving it and risking drift.
export const POOL_WHERE = `(mi.browsed = 0 OR mi.id IN (SELECT media_item_id FROM user_item_state))`;

// The signature must be scoped to the pool too, not just the cache it guards.
// A count over ALL of media_items would change on every /discover browse, so
// every browse would invalidate the cache and force a full rebuild — which
// parses the raw_data of the entire catalog, on the request path, for a table
// the browse didn't meaningfully change.
function catalogSignature(): string {
  const r = get<{ n: number; mx: number }>(
    `SELECT COUNT(*) n, COALESCE(MAX(mi.updated_at),0) mx FROM media_items mi WHERE ${POOL_WHERE}`
  );
  return `${r?.n ?? 0}:${r?.mx ?? 0}`;
}

interface VecRow {
  id: string; type: MediaType; title: string; release_date: string | null; poster_url: string | null;
  created_at: number; source: string | null; source_id: string | null; raw_data: string | null; link_release_date: string | null;
}

function buildCache() {
  const rows = query<VecRow>(
    `SELECT mi.id, mi.type, mi.title, mi.release_date, mi.poster_url, mi.created_at,
            ml.source, ml.source_id, ml.raw_data, ml.release_date as link_release_date
     FROM media_items mi
     LEFT JOIN media_links ml ON ml.media_item_id = mi.id
     WHERE ${POOL_WHERE}`
  );

  const groups = new Map<string, { row: VecRow; links: MediaLink[] }>();
  for (const r of rows) {
    if (!groups.has(r.id)) groups.set(r.id, { row: r, links: [] });
    if (r.source) {
      groups.get(r.id)!.links.push({
        id: "", mediaItemId: r.id, source: r.source as MediaLink["source"], sourceId: r.source_id!,
        title: null, releaseDate: r.link_release_date, rawData: JSON.parse(r.raw_data ?? "{}"), lastSynced: 0,
      });
    }
  }

  // H5.6: canonicalize tag facets once per build so bundled spellings collapse
  // into one vocab entry (summed count) and itemsWithFacet(canonical) returns
  // items carrying any member spelling.
  const aliases = getTagAliases();
  const vectors: DiscoveryVector[] = [];
  const vocabMap = new Map<string, VocabEntry>();
  for (const { row, links } of groups.values()) {
    const merged = mergeLinks(links, row.type);
    const facets = applyTagAliases(extractFacets(links, row.type, merged), aliases);
    vectors.push({
      id: row.id, type: row.type,
      title: row.title ?? merged.title,
      posterUrl: row.poster_url ?? merged.posterUrl,
      backdropUrl: merged.backdropUrl,
      releaseDate: row.release_date ?? merged.releaseDate,
      year: extractYear(row.release_date ?? merged.releaseDate),
      communityScore: representativeCommunity(merged.communityRatings),
      communityAvg: averageCommunity(merged.communityRatings),
      communityVotes: communityVotes(merged.communityRatings),
      runtimeMinutes: merged.runtimeMinutes,
      addedAt: row.created_at ?? 0,
      sources: links.map((l) => ({ source: l.source, sourceId: l.sourceId })),
      facets,
    });
    for (const f of facets) {
      const id = facetId(f);
      const v = vocabMap.get(id);
      if (v) v.count++;
      else vocabMap.set(id, { kind: f.kind, role: f.role, key: f.key, label: f.label, count: 1 });
    }
  }

  // IDF: a facet on most items (Singleplayer, Action) is a weak signal; a rare
  // one (steampunk, a specific director) is a strong, distinctive match. This is
  // what stops generic high-frequency genres from dominating recommendations.
  const N = vectors.length || 1;
  const idf = new Map<string, number>();
  for (const [id, e] of vocabMap.entries()) idf.set(id, Math.log((N + 1) / (e.count + 1)));

  const byId = new Map(vectors.map((v) => [v.id, v]));
  const vocab = [...vocabMap.values()].sort((a, b) => b.count - a.count);
  return { vectors, byId, vocab, idf };
}

function getCache() {
  const sig = catalogSignature();
  // H5.6: a bundle edit doesn't change the catalog (catalogSignature), so guard
  // on the alias signature too — otherwise bundled vocab/vectors would stay stale
  // until the 5-min TTL expired.
  const aliasSig = tagAliasSignature();
  if (_cache && _cache.sig === sig && _cache.aliasSig === aliasSig && Date.now() - _cache.at < CANDIDATE_TTL_MS) return _cache;
  const built = buildCache();
  _cache = { sig, aliasSig, at: Date.now(), ...built };
  return _cache;
}

// Public: invalidate after a fetch-more ingest so new items appear immediately.
export function invalidateDiscoveryCache() { _cache = null; }

// The catalog-wide IDF map (facetId → rarity weight). Exposed so the live
// discover feed can score off-catalog (upcoming) items with the same rarity
// signal; facets unseen in the catalog fall back to idf 1 at the call site.
export function getCatalogIdf(): Map<string, number> { return getCache().idf; }

// H5.4 — the taxonomy editor's tag-triage view: every tag in the catalog
// vocab, sorted by frequency (already the vocab's sort order). Not filtered by
// category here — the caller (the vocab API route) decides what to show.
export function getTagVocab(): VocabEntry[] { return getCache().vocab.filter((v) => v.kind === "tag"); }

// Q25 (2026-07-19) — same "recover the real label from the catalog" trick as
// getTagVocab (Q11), for companies. companyKey() strips trailing legal/role
// tokens ("Focus Entertainment" -> "focus"), and a public /studio/<slug> URL
// carries only that lossy key — searching providers with it directly matched
// the wrong company (Focus Features, a different studio, beat "focus" out).
export function getCompanyVocab(): VocabEntry[] { return getCache().vocab.filter((v) => v.kind === "company"); }

// ── Preference profile ────────────────────────────────────────────
// meta's classWeight/BA/n are set for every real (rated-library) facet — H5.2
// adds them for computeFandexScore's aggregate + explainability. Facets
// injected by applyRefinements (seeds/manual pills) have no library stats
// behind them, so those three stay undefined; computeFandexScore treats a
// facet with no classWeight as unscored (see its `meta?.classWeight` guard).
export interface Profile {
  w: Map<string, number>;
  meta: Map<string, { kind: string; role?: FacetRole; key: string; label: string; category?: string; classWeight?: number; BA?: number; n?: number }>;
  baseline: number;
  hasSignal: boolean;
  ratedItemCount: number;
}

// H5.3 §8 cold-start: below this many rated items, computeFandexScore refuses
// to show a number at all rather than a misleading one built on 1-2 samples.
// Deliberately NOT folded into `hasSignal` (which stays "at least one facet",
// unchanged since before H5) — hasSignal also gates Discover's "match" sort
// fallback, and raising that bar would change existing ranking behavior for
// sparse profiles as a side effect of a scoring-display decision.
export const MIN_RATED_FOR_FANDEX_SCORE = 3;

// Per-user; sig-invalidated on read. Capped so many distinct users can't grow it
// without bound (single-instance, P2).
const _profileCache = new BoundedCache<string, { sig: string; profile: Profile }>({ max: 500 });

// H5.2: the Bayesian shrinkage average (§3.1) — replaces the old
// `raw · count/(count+K)` shortcut with a textbook Bayesian average, shrunk
// toward the user's OWN rating baseline (D4) rather than a global one. This is
// what makes a facet seen once get pulled most of the way back to baseline
// until real evidence accumulates, and what makes dislikes (dev_f < 0) emerge
// with no special-casing.
//
// Weight class (§3.2): tags resolve their EFFECTIVE category as
// `tag_category_override[key] ?? f.category` (D6 — a backend reassignment
// from the taxonomy editor wins over categorizeTag()'s code heuristic), then
// read that category's weight from tag_category and are DROPPED entirely
// (not just zero-weighted) when it's ignored — meta/noise today, anything else
// someone buckets that way via the taxonomy editor (H5.4). `meta.category`
// stores the EFFECTIVE id too, so the breakdown UI's color/label matches what
// was actually scored, not the pre-reassignment category. People/company
// roles keep reading roleWeights (still the ROLE_WEIGHT literal's values, now
// DB-backed via scoring_config).
//
// `overrides` (H5.4): the /dev/scoring live preview needs to score against
// DRAFT (unsaved) weights without touching the DB or the shared cache — pass
// `config`/`categoryWeights` to bypass getScoringConfig()/getTagCategories()
// for just those fields, layered onto everything else that's still real
// (the user's actual rated facets, tag_category_override, category
// id/label/color). Providing overrides always skips the profile cache: its
// key is userId+librarySignature only, which can't distinguish a draft call
// from a real one, so caching a draft result would leak into every other read.
export interface ProfileOverrides {
  config?: ScoringConfigValues;
  categoryWeights?: Map<string, { weight: number; ignored: boolean }>;
}

export function buildProfile(userId: string, overrides?: ProfileOverrides): Profile {
  const sig = `${librarySignature(userId)}|${scoringConfigSignature()}`;
  if (!overrides) {
    const cached = _profileCache.get(userId);
    if (cached && cached.sig === sig) return cached.profile;
  }

  const a = getLibraryFacetAnalysis(userId);
  const cfg = overrides?.config ?? getScoringConfig();
  const tagOverrides = getTagCategoryOverrides();
  const categoryById = new Map<string, TagCategoryConfig>(
    getTagCategories().map((c) => {
      const w = overrides?.categoryWeights?.get(c.id);
      return [c.id, w ? { ...c, weight: w.weight, ignored: w.ignored } : c];
    })
  );

  const w = new Map<string, number>();
  const meta = new Map<string, { kind: string; role?: FacetRole; key: string; label: string; category?: string; classWeight?: number; BA?: number; n?: number }>();
  for (const f of a.facets) {
    const id = `${f.kind}|${f.role ?? ""}|${f.key}`;

    let classWeight: number;
    let effectiveCategory = f.category;
    if (f.kind === "tag") {
      effectiveCategory = tagOverrides.get(f.key) ?? f.category ?? "other";
      const cat = categoryById.get(effectiveCategory);
      if (cat?.ignored || cat?.weight === 0) continue;
      classWeight = cat?.weight ?? 1;
    } else {
      classWeight = cfg.roleWeights[f.role ?? "tag"] ?? 1;
    }

    // Q30: from the prominence-weighted accumulators (identical to
    // weightedSum/weightedCount == sum/count for every non-cast facet) — a
    // lead-role rating counts closer to a full data point toward this
    // person's Bayesian average, a cameo closer to CAST_PROMINENCE_FLOOR.
    // `n` stays the plain rated-title count for the breakdown's "N titles" text.
    const BA = (cfg.priorStrength * a.baseline + f.weightedSum) / (cfg.priorStrength + f.weightedCount);
    const dev = BA - a.baseline;

    w.set(id, dev * classWeight);
    meta.set(id, { kind: f.kind, role: f.role, key: f.key, label: f.label, category: effectiveCategory, classWeight, BA, n: f.count });
  }
  const profile: Profile = { w, meta, baseline: a.baseline, hasSignal: w.size > 0, ratedItemCount: a.ratedItemCount };
  if (!overrides) _profileCache.set(userId, { sig, profile });
  return profile;
}

// Clone + inject seeds / manual pills (per request — never mutate the cache).
function applyRefinements(profile: Profile, refine: DiscoverRefine | undefined, byId: Map<string, DiscoveryVector>): Profile {
  const w = new Map(profile.w);
  const meta = new Map(profile.meta);
  if (!refine) return { ...profile, w, meta };

  const noteMeta = (f: Facet) => {
    const id = facetId(f);
    if (!meta.has(id)) meta.set(id, { kind: f.kind, role: f.role, key: f.key, label: f.label, category: f.category });
    return id;
  };

  for (const seedId of refine.seeds ?? []) {
    const v = byId.get(seedId);
    if (!v) continue;
    for (const f of v.facets) {
      const id = noteMeta(f);
      const base = w.get(id) ?? 0;
      w.set(id, Math.max(base, 0) * SEED_BOOST + (base <= 0 ? 1.0 : 0));
    }
  }
  for (const seedId of refine.negSeeds ?? []) {
    const v = byId.get(seedId);
    if (!v) continue;
    for (const f of v.facets) {
      const id = noteMeta(f);
      const base = w.get(id) ?? 0;
      w.set(id, Math.min(base, 0) * SEED_PENALTY + (base >= 0 ? -1.0 : 0));
    }
  }
  for (const l of refine.likes ?? []) {
    const id = `${l.kind}|${l.role ?? ""}|${l.key}`;
    w.set(id, (w.get(id) ?? 0) + MANUAL_LIKE);
    if (!meta.has(id)) meta.set(id, { kind: l.kind, role: l.role, key: l.key, label: l.label ?? l.key });
  }
  for (const d of refine.dislikes ?? []) {
    const id = `${d.kind}|${d.role ?? ""}|${d.key}`;
    w.set(id, (w.get(id) ?? 0) + MANUAL_DISLIKE);
    if (!meta.has(id)) meta.set(id, { kind: d.kind, role: d.role, key: d.key, label: d.label ?? d.key });
  }

  const hasSignal = [...w.values()].some((x) => x !== 0);
  return { w, meta, baseline: profile.baseline, hasSignal, ratedItemCount: profile.ratedItemCount };
}

// ── Scoring ────────────────────────────────────────────────────────
// Each matched facet contributes (user taste weight) × (catalog rarity / idf),
// so a shared distinctive facet outweighs several generic ones. Works off a bare
// facet list so it scores both catalog vectors and live (upcoming) candidates.
export function scoreFacets(facets: Facet[], w: Map<string, number>, idf: Map<string, number>): { score: number; reasons: Reason[] } | null {
  const contribs: { f: Facet; w: number }[] = [];
  for (const f of facets) {
    const id = facetId(f);
    const weight = w.get(id);
    if (weight == null) continue;
    const eff = weight * (idf.get(id) ?? 1);
    if (eff) contribs.push({ f, w: eff });
  }
  if (!contribs.length) return null;
  contribs.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  const kept = contribs.slice(0, TOP_K_FACETS);
  const sum = kept.reduce((acc, c) => acc + c.w, 0);
  const score = sum / Math.sqrt(Math.max(kept.length, 1));
  const reasons: Reason[] = kept
    .sort((a, b) => b.w - a.w)
    .map((c) => ({ kind: c.f.kind, role: c.f.role, label: c.f.label, category: c.f.category, contribution: Math.round(c.w * 100) / 100 }));
  return { score: Math.round(score * 1000) / 1000, reasons };
}

// ── Fandex Score (H5.2, §3.3) ───────────────────────────────────────
// The VISIBLE per-item taste-match number (0-100) — a different computation
// from scoreFacets' idf-weighted ranking score above, which stays exactly as
// it was and keeps driving Discover's "match" sort (D2: idf may remain a
// sort signal, never in the shown number). Takes only `facets` + the rated
// profile, so §4's hard exclusions (community rating, browsed/popularity,
// release date) hold structurally — this function has no parameter to leak
// them through even by mistake.
export interface FandexScoreResult { score: number; center: number; reasons: Reason[] }

interface FandexContrib { f: Facet; dev: number; classWeight: number; BA?: number; n?: number }

// `configOverride` (H5.4 live preview): use the draft mappingConstant/
// perCategoryCap instead of the persisted ones — pass the SAME override
// object given to buildProfile so K/cap and the role/category weights that
// produced `profile` stay consistent with each other.
export function computeFandexScore(facets: Facet[], profile: Profile, configOverride?: ScoringConfigValues): FandexScoreResult | null {
  if (!profile.hasSignal || profile.ratedItemCount < MIN_RATED_FOR_FANDEX_SCORE) return null;
  const cfg = configOverride ?? getScoringConfig();

  const matched: FandexContrib[] = [];
  for (const f of facets) {
    const id = facetId(f);
    const w = profile.w.get(id);
    const meta = profile.meta.get(id);
    if (w == null || !meta?.classWeight) continue;
    // Q30: `dev` recovers from `w` using the profile's BUILD-time classWeight
    // (the same value `w` was computed with) — but the classWeight carried
    // FORWARD into this item's weighted mean is scaled by THIS item's own
    // cast prominence (f.prominence), so the same actor counts more here if
    // they're the lead in THIS title than if they were a cameo. Absent/1 for
    // every non-cast facet.
    const classWeight = meta.classWeight * (f.prominence ?? 1);
    matched.push({ f, dev: w / meta.classWeight, classWeight, BA: meta.BA, n: meta.n });
  }
  if (!matched.length) return null;

  // §3.3/D3: per-category cap, TAGS ONLY — top-N by |dev| per category, so a
  // facet-dense item (20 theme tags) can't swamp a single strong director
  // match. People/company roles are naturally low-cardinality per item and
  // stay uncapped.
  const byCategory = new Map<string, FandexContrib[]>();
  const kept: FandexContrib[] = [];
  // Q29 (2026-07-19): tags beyond the cap used to just vanish — no trace in
  // the breakdown, so "why isn't this counted" had no visible answer. Tracked
  // separately (not added to `kept`, so the score math is untouched) and
  // rendered grayed-out with contribution pinned to 0 below.
  const capped: FandexContrib[] = [];
  for (const c of matched) {
    if (c.f.kind === "tag" && c.f.category) {
      const arr = byCategory.get(c.f.category) ?? [];
      arr.push(c);
      byCategory.set(c.f.category, arr);
    } else {
      kept.push(c);
    }
  }
  for (const arr of byCategory.values()) {
    arr.sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev));
    kept.push(...arr.slice(0, cfg.perCategoryCap));
    capped.push(...arr.slice(cfg.perCategoryCap));
  }
  if (!kept.length) return null;

  // Weighted MEAN (divide by total weight, not count/sqrt) — keeps
  // facet-dense items from inflating just by carrying more tags (D3).
  const totalWeight = kept.reduce((acc, c) => acc + c.classWeight, 0);
  const weightedDev = totalWeight ? kept.reduce((acc, c) => acc + c.dev * c.classWeight, 0) / totalWeight : 0;

  // Q19 (2026-07-19): center on the user's OWN mean rating (matching what
  // Insights shows as "your average"), not a fixed 50 — a fixed center meant
  // ~half of any library scored below 50 by construction ("you won't like
  // most things"). The center is derived, never an admin knob. Positive
  // deviations (above-your-average items) and negative ones (below-average)
  // get separately tunable gains (K_up / K_down) so the visible range can be
  // skewed toward enthusiasm without an asymmetric center.
  const center = profile.baseline * 10; // baseline is 0-10 (mean personal rating) → 0-100
  const gain = weightedDev >= 0 ? cfg.mappingConstantUp : cfg.mappingConstantDown;
  const rawDelta = gain * weightedDev;
  const score = Math.max(0, Math.min(100, center + rawDelta));

  // Q20 (2026-07-19): make the breakdown genuinely additive — `center + Σ
  // reasons[].contribution` must equal `score` (within rounding), not just be
  // "in the same ballpark". Each reason's raw points are its share of
  // `gain·weightedDev` (i.e. `gain · dev_i · classWeight_i / totalWeight`,
  // which is exactly what the weighted-mean formula above sums to rawDelta).
  // When clamping caps the score (rawDelta pushed it past 0/100), scale every
  // reason's points down by the same factor the clamp applied, so the shown
  // parts never overstate what actually reached the visible number.
  const clampedDelta = score - center;
  const scale = rawDelta !== 0 ? clampedDelta / rawDelta : 0;

  const reasons: Reason[] = kept
    .sort((a, b) => b.dev * b.classWeight - a.dev * a.classWeight)
    .map((c) => ({
      kind: c.f.kind, role: c.f.role, label: c.f.label, category: c.f.category,
      contribution: Math.round(((gain * c.dev * c.classWeight / totalWeight) * scale) * 10) / 10,
      BA: c.BA, n: c.n,
    }));

  // Q29 — appended after the real contributors, contribution fixed at 0 (so
  // the additive sum from Q20 is unaffected), flagged `capped` for the client
  // to render grayed-out with a "not counted" note.
  for (const c of capped.sort((a, b) => Math.abs(b.dev * b.classWeight) - Math.abs(a.dev * a.classWeight))) {
    reasons.push({ kind: c.f.kind, role: c.f.role, label: c.f.label, category: c.f.category, contribution: 0, BA: c.BA, n: c.n, capped: true });
  }

  return { score: Math.round(score * 10) / 10, center: Math.round(center * 10) / 10, reasons };
}

// ── Filtering ──────────────────────────────────────────────────────
function hasFacet(v: DiscoveryVector, ref: { kind: string; role?: FacetRole; key: string }): boolean {
  return v.facets.some((f) => f.kind === ref.kind && f.key === ref.key && (!ref.role || f.role === ref.role));
}

function passesFilters(
  v: DiscoveryVector,
  filters: DiscoverFilters,
  state: { onWatchlist: boolean; libraryStatus: string | null } | undefined
): boolean {
  if (filters.types?.length && !filters.types.includes(v.type)) return false;

  const yearActive = filters.yearMin != null || filters.yearMax != null;
  if (yearActive) {
    if (v.year == null) return false;
    if (filters.yearMin != null && v.year < filters.yearMin) return false;
    if (filters.yearMax != null && v.year > filters.yearMax) return false;
  }

  const commActive = (filters.communityMin != null && filters.communityMin > 0) || (filters.communityMax != null && filters.communityMax < 100);
  if (commActive) {
    if (v.communityScore == null) return false;
    if (filters.communityMin != null && v.communityScore < filters.communityMin) return false;
    if (filters.communityMax != null && v.communityScore > filters.communityMax) return false;
  }

  const runtimeActive = filters.runtimeMin != null || filters.runtimeMax != null;
  if (runtimeActive) {
    if (v.runtimeMinutes == null) return false;
    if (filters.runtimeMin != null && v.runtimeMinutes < filters.runtimeMin) return false;
    if (filters.runtimeMax != null && v.runtimeMinutes > filters.runtimeMax) return false;
  }

  if (filters.sources?.length && !v.sources.some((s) => filters.sources!.includes(s.source))) return false;

  const m = filters.membership;
  if (m) {
    const inLib = !!state?.libraryStatus;
    const inWl = !!state?.onWatchlist;
    if (m.library === "only" && !inLib) return false;
    if (m.library === "exclude" && inLib) return false;
    if (m.wishlist === "only" && !inWl) return false;
    if (m.wishlist === "exclude" && inWl) return false;
  }

  for (const inc of filters.includeFacets ?? []) if (!hasFacet(v, inc)) return false;
  for (const exc of filters.excludeFacets ?? []) if (hasFacet(v, exc)) return false;

  return true;
}

// ── Public: find ───────────────────────────────────────────────────
export interface DiscoverResultItem {
  id: string;
  type: MediaType;
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
}

export interface FindResult {
  baseline: number;
  total: number;
  profileSummary: { topPositive: Reason[]; topNegative: Reason[] };
  items: DiscoverResultItem[];
}

export function find(userId: string, req: FindRequest): FindResult {
  const { vectors, byId, idf } = getCache();
  // H5.3: the visible Fandex Score badge uses the RAW rated-library profile,
  // never the refined one — a seed/manual-pill nudge changes what ranks well
  // in THIS search, not your actual taste-match number (D2's "fully
  // transparent" intent extends to "stable regardless of session refinements").
  const rawProfile = buildProfile(userId);
  const profile = applyRefinements(rawProfile, req.refine, byId);
  const filters = req.filters ?? {};
  const sort: SortKey = req.sort ?? "fandexScore";
  const limit = Math.min(Math.max(req.limit ?? 60, 1), 120);
  const offset = Math.max(req.offset ?? 0, 0);
  const q = (req.q ?? "").trim().toLowerCase();

  // State for the whole catalog (needed for membership filtering + hydration).
  const state = getUserStateMap(userId, vectors.map((v) => v.id));

  const ignored = req.excludeIgnored
    ? new Set(query<{ media_item_id: string }>(
        "SELECT media_item_id FROM user_item_state WHERE user_id = ? AND relation = 'ignored'", [userId]
      ).map((r) => r.media_item_id))
    : null;

  // Fandex Score is computed here (not just for the paged slice) so the whole
  // set can be SORTED by it. The badge uses the RAW profile (H5.3) regardless.
  const scored: { v: DiscoveryVector; score: number; reasons: Reason[]; fandexScore: number | null }[] = [];
  for (const v of vectors) {
    if (ignored?.has(v.id)) continue;
    if (q && !v.title.toLowerCase().includes(q)) continue;
    if (!passesFilters(v, filters, state.get(v.id))) continue;
    const s = scoreFacets(v.facets, profile.w, idf);
    scored.push({ v, score: s?.score ?? 0, reasons: s?.reasons ?? [], fandexScore: computeFandexScore(v.facets, rawProfile)?.score ?? null });
  }

  // Unified sort model: releaseDate (newest) / popularity (votes) / rating
  // (Bayesian-damped) / fandexScore. "Fandex Score" with no usable signal (cold
  // start) falls back to the Bayesian rating so the page stays useful.
  const score10 = (v: DiscoveryVector) => (v.communityAvg == null ? null : v.communityAvg / 10);
  const prior = ratingPrior(scored.map(({ v }) => ({ score10: score10(v), votes: v.communityVotes })));
  const bayes = (v: DiscoveryVector) => bayesRating(score10(v), v.communityVotes, prior);
  const fandexUsable = sort === "fandexScore" && rawProfile.ratedItemCount >= MIN_RATED_FOR_FANDEX_SCORE;
  scored.sort((a, b) => {
    switch (sort) {
      case "releaseDate": return cmpDate(a.v.releaseDate, b.v.releaseDate); // cmpDate defaults to desc (newest first)
      case "popularity": return b.v.communityVotes - a.v.communityVotes || bayes(b.v) - bayes(a.v);
      case "rating": return bayes(b.v) - bayes(a.v) || b.v.communityVotes - a.v.communityVotes;
      default: // fandexScore
        if (!fandexUsable) return bayes(b.v) - bayes(a.v) || b.v.communityVotes - a.v.communityVotes;
        return (b.fandexScore ?? -1) - (a.fandexScore ?? -1) || bayes(b.v) - bayes(a.v);
    }
  });

  const total = scored.length;
  const page = scored.slice(offset, offset + limit);

  const items: DiscoverResultItem[] = page.map(({ v, score, reasons, fandexScore }) => {
    const st = state.get(v.id);
    return {
      id: v.id, type: v.type, title: v.title, releaseDate: v.releaseDate, posterUrl: v.posterUrl, backdropUrl: v.backdropUrl,
      communityScore: v.communityScore,
      communityAvg: v.communityAvg,
      communityVotes: v.communityVotes,
      platformSources: st?.platformSources ?? [],
      onWatchlist: st?.onWatchlist ?? false,
      libraryStatus: st?.libraryStatus ?? null,
      rating: st?.rating ?? null,
      sources: v.sources, score, reasons,
      fandexScore,
    };
  });

  // Profile summary — strongest positive/negative facets overall, ranked by the
  // same idf-weighted effective contribution used for scoring.
  const entries = [...profile.w.entries()].map(([id, weight]) => ({ eff: weight * (idf.get(id) ?? 1), meta: profile.meta.get(id) }))
    .filter((e) => e.meta);
  const toReason = (e: { eff: number; meta: any }): Reason => ({
    kind: e.meta.kind, role: e.meta.role, label: e.meta.label, category: e.meta.category, contribution: Math.round(e.eff * 100) / 100,
  });
  const topPositive = entries.filter((e) => e.eff > 0).sort((a, b) => b.eff - a.eff).slice(0, 12).map(toReason);
  const topNegative = entries.filter((e) => e.eff < 0).sort((a, b) => a.eff - b.eff).slice(0, 12).map(toReason);

  return { baseline: Math.round(profile.baseline * 10) / 10, total, profileSummary: { topPositive, topNegative }, items };
}

function cmpDate(a: string | null, b: string | null, asc = false): number {
  // For desc (releaseNew): later dates first, nulls last. asc flips, nulls still last.
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return asc ? a.localeCompare(b) : b.localeCompare(a);
}

// ── Public: facet + title autocomplete (for pills + seeds) ─────────
export function searchFacets(q: string, kind: string | null, limit = 20): VocabEntry[] {
  const { vocab } = getCache();
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return vocab
    .filter((e) => (!kind || e.kind === kind) && e.label.toLowerCase().includes(needle))
    .slice(0, limit);
}

export interface TitleMatch { id: string; title: string; type: MediaType; posterUrl: string | null; year: number | null }
export function searchTitles(q: string, limit = 12): TitleMatch[] {
  const { vectors } = getCache();
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const out: TitleMatch[] = [];
  for (const v of vectors) {
    if (v.title.toLowerCase().includes(needle)) {
      out.push({ id: v.id, title: v.title, type: v.type, posterUrl: v.posterUrl, year: v.year });
      if (out.length >= limit * 3) break; // gather a few, then rank
    }
  }
  // Prefer prefix matches, then shorter titles (closer to the query).
  out.sort((a, b) => {
    const ap = a.title.toLowerCase().startsWith(needle) ? 0 : 1;
    const bp = b.title.toLowerCase().startsWith(needle) ? 0 : 1;
    return ap - bp || a.title.length - b.title.length;
  });
  return out.slice(0, limit);
}

// All catalog items carrying a given facet (for the facet detail page).
// H5.6: the cached vectors carry CANONICAL tag keys, so canonicalize a tag ref
// key too — a caller passing a member spelling still matches the whole bundle.
export function itemsWithFacet(ref: { kind: string; role?: FacetRole; key: string }): DiscoveryVector[] {
  const { vectors } = getCache();
  const key = ref.kind === "tag" ? canonicalTagKey(ref.key) : ref.key;
  return vectors.filter((v) =>
    v.facets.some((f) => f.kind === ref.kind && f.key === key && (!ref.role || f.role === ref.role))
  );
}

// Resolve a person facet to its TMDB person id by reading the credits of one
// catalog item that carries them — so the detail page can fetch bio/age. Cached.
const _personIdCache = new BoundedCache<string, number | null>({ max: 5000 });
export function resolvePersonTmdbId(role: string, key: string): number | null {
  const ck = `${role}:${key}`;
  if (_personIdCache.has(ck)) return _personIdCache.get(ck)!;
  let found: number | null = null;
  for (const v of itemsWithFacet({ kind: "person", role: role as FacetRole, key })) {
    const row = get<{ raw_data: string }>(`SELECT raw_data FROM media_links WHERE media_item_id = ? AND source = 'tmdb' LIMIT 1`, [v.id]);
    if (!row) continue;
    let data: any;
    try { data = JSON.parse(row.raw_data ?? "{}"); } catch { continue; }
    const pool: any[] = role === "cast" ? (data.credits?.cast ?? []) : role === "creator" ? (data.created_by ?? []) : (data.credits?.crew ?? []);
    const hit = pool.find((p) => personKey(p?.name ?? "") === key);
    if (hit?.id) { found = hit.id; break; }
  }
  _personIdCache.set(ck, found);
  return found;
}

// Resolve a game developer/publisher facet to its RAWG entity id (for pulling
// their catalog), by reading one carrying item's rawg raw_data. Cached.
const _rawgEntityCache = new BoundedCache<string, number | null>({ max: 5000 });
export function resolveRawgEntityId(role: string, key: string): number | null {
  const ck = `${role}:${key}`;
  if (_rawgEntityCache.has(ck)) return _rawgEntityCache.get(ck)!;
  let found: number | null = null;
  for (const v of itemsWithFacet({ kind: "company", role: role as FacetRole, key })) {
    const row = get<{ raw_data: string }>(`SELECT raw_data FROM media_links WHERE media_item_id = ? AND source = 'rawg' LIMIT 1`, [v.id]);
    if (!row) continue;
    let data: any;
    try { data = JSON.parse(row.raw_data ?? "{}"); } catch { continue; }
    const pool: any[] = role === "developer" ? (data.developers ?? []) : (data.publishers ?? []);
    const hit = pool.find((p) => companyKey(p?.name ?? "") === key);
    if (hit?.id) { found = hit.id; break; }
  }
  _rawgEntityCache.set(ck, found);
  return found;
}

// Strongest positive tag keys from the profile — drives the "fetch more" ingest.
export function topPositiveTagKeys(userId: string, refine: DiscoverRefine | undefined, n = 8): string[] {
  const { byId, idf } = getCache();
  const profile = applyRefinements(buildProfile(userId), refine, byId);
  return [...profile.w.entries()]
    .map(([id, weight]) => ({ meta: profile.meta.get(id), eff: weight * (idf.get(id) ?? 1) }))
    .filter((e) => e.meta?.kind === "tag" && e.eff > 0)
    .sort((a, b) => b.eff - a.eff)
    .slice(0, n)
    .map((e) => e.meta!.key);
}
