import { Source, MediaLink, EnrichedItem, MediaType, CommunityRating } from "@/types";
import { SourceNormalized, normalizeSource } from "./sources/normalize";

// merge.ts is now pure POLICY: it merges the per-source SourceNormalized partials
// (built by src/lib/sources/normalize.ts) by priority (single-value) or union
// (multi-value). Per-source extraction lives with the normalizers — adding a
// source touches only that registry, never this file.

// ── Priority orders (single-value fields) ─────────────────────────
const TITLE_PRIORITY: Source[] = ["tmdb", "igdb", "steam", "rawg", "trakt", "letterboxd"];
const DESCRIPTION_PRIORITY: Source[] = ["rawg", "tmdb", "steam", "trakt", "letterboxd", "igdb"];
const RELEASE_DATE_PRIORITY: Source[] = ["steam", "igdb", "rawg", "tmdb", "trakt", "letterboxd"];
// Poster = PORTRAIT box-art (card view). Prefer sources with true portrait art
// (TMDB poster, IGDB cover, Steam library_capsule) over RAWG's landscape image.
const POSTER_PRIORITY: Source[] = ["tmdb", "igdb", "steam", "rawg", "trakt", "letterboxd"];
// Backdrop = LANDSCAPE art (list-row thumbnail). TMDB backdrop for film/TV; for
// games the Steam header / RAWG background / IGDB artwork.
const BACKDROP_PRIORITY: Source[] = ["tmdb", "rawg", "steam", "igdb"];
const TAGLINE_PRIORITY: Source[] = ["tmdb", "trakt", "letterboxd"];
const RUNTIME_PRIORITY: Source[] = ["tmdb", "trakt", "letterboxd"];
const STATUS_PRIORITY: Source[] = ["tmdb", "trakt", "igdb"];
const COLLECTION_PRIORITY: Source[] = ["tmdb", "igdb"];
const LANGUAGE_PRIORITY: Source[] = ["tmdb", "trakt"];
const COUNTRY_PRIORITY: Source[] = ["tmdb", "trakt"];
const NETWORK_PRIORITY: Source[] = ["tmdb", "trakt"];
const DEVELOPER_PRIORITY: Source[] = ["rawg", "steam", "igdb"];

// Union-field source lists — shared by mergeLinks and explainMerge so the
// debug matrix can never drift from the real merge.
const IMAGE_SOURCES: Source[] = ["steam", "tmdb", "rawg", "igdb", "letterboxd"];
const TAG_SOURCES: Source[] = ["rawg", "steam", "tmdb", "trakt", "letterboxd", "igdb"];
const PLATFORM_SOURCES: Source[] = ["steam", "rawg", "igdb"];
const STORE_LINK_SOURCES: Source[] = ["steam", "rawg", "tmdb", "trakt", "letterboxd", "igdb"];
const TRAILER_SOURCES: Source[] = ["tmdb", "trakt", "igdb", "steam"];
const RATING_SOURCES: Source[] = ["tmdb", "trakt", "letterboxd", "igdb", "rawg", "steam"];
const DLC_SOURCES: Source[] = ["igdb", "steam"];
const GAME_MODE_SOURCES: Source[] = ["igdb"];
// Each source reports its own regional rating system (FSK / PG / USK / ESRB) —
// unioned so the detail page can show all of them, not just one.
const CERTIFICATION_SOURCES: Source[] = ["tmdb", "trakt", "steam", "rawg"];

// Build the per-source normalized view once; everything below is policy over it.
function normalizeAll(mediaLinks: { source: Source; data: any }[], type: MediaType): Map<Source, SourceNormalized> {
  const norm = new Map<Source, SourceNormalized>();
  for (const l of mediaLinks) norm.set(l.source, normalizeSource(l.source, l.data, type));
  return norm;
}

// ── Main merge function ───────────────────────────────────────────

export function mergeLinks(mediaLinks: MediaLink[], type: MediaType): Omit<EnrichedItem, "id" | "type" | "platformSources"> {
  const norm = normalizeAll(mediaLinks.map((l) => ({ source: l.source, data: l.rawData })), type);

  // ── Single-value fields (priority order) ──────────────────────
  const title = pickField(TITLE_PRIORITY, norm, "title") ?? "Unknown";
  const description = pickLongestField(DESCRIPTION_PRIORITY, norm, "description");
  const releaseDate = pickField(RELEASE_DATE_PRIORITY, norm, "releaseDate");
  const posterUrl = pickField(POSTER_PRIORITY, norm, "poster");
  const backdropUrl = pickField(BACKDROP_PRIORITY, norm, "backdrop");
  const metacritic = pickField(["rawg"], norm, "metacritic");
  const steamReviewLabel = pickField(["steam"], norm, "steamReviewLabel");
  const letterboxdRating = pickField(["letterboxd"], norm, "letterboxdRating");
  const developer = pickField(DEVELOPER_PRIORITY, norm, "developer");
  const publisher = pickField(DEVELOPER_PRIORITY, norm, "publisher");

  // ── Facts (single-value, priority order) ──────────────────────
  const tagline = pickField(TAGLINE_PRIORITY, norm, "tagline");
  const runtimeMinutes = pickField(RUNTIME_PRIORITY, norm, "runtimeMinutes");
  const certification = dedup(unionValues(CERTIFICATION_SOURCES, norm, "certification")).slice(0, 6);
  const status = pickField(STATUS_PRIORITY, norm, "status");
  const collection = pickField(COLLECTION_PRIORITY, norm, "collection");
  const originalLanguage = pickField(LANGUAGE_PRIORITY, norm, "originalLanguage");
  const country = pickField(COUNTRY_PRIORITY, norm, "country");
  const network = type === "show" ? pickField(NETWORK_PRIORITY, norm, "network") : null;
  const playtimeHours = pickField(["rawg"], norm, "playtimeHours");
  const timeToBeat = pickField(["igdb"], norm, "timeToBeat");

  // TMDB-only facts.
  const tmdb = norm.get("tmdb");
  const budget = tmdb?.budget ?? null;
  const revenue = tmdb?.revenue ?? null;
  const seasonCount = tmdb?.seasonCount ?? null;
  const episodeCount = tmdb?.episodeCount ?? null;
  const nextEpisode = tmdb?.nextEpisode ?? null;

  // ── Community ratings (union across sources) ──────────────────
  const communityRatings = unionValues(RATING_SOURCES, norm, "communityRatings") as CommunityRating[];

  // ── Game-specific union fields ────────────────────────────────
  const gameModes = dedup(unionValues(GAME_MODE_SOURCES, norm, "gameModes")).slice(0, 8);
  const dlc = dedup(unionValues(DLC_SOURCES, norm, "dlc")).slice(0, 12);

  // ── Multi-value fields (union) ────────────────────────────────
  const images = dedup(unionValues(IMAGE_SOURCES, norm, "images"));
  const tags = dedup(unionValues(TAG_SOURCES, norm, "tags"));
  const platforms = dedup(unionValues(PLATFORM_SOURCES, norm, "platforms"));

  // ── Per-source dates ──────────────────────────────────────────
  const dates: { source: Source; date: string }[] = [];
  for (const s of RELEASE_DATE_PRIORITY) {
    const date = norm.get(s)?.releaseDate;
    if (date) dates.push({ source: s, date });
  }
  const uniqueDates = dates.filter((d, i) => dates.findIndex((x) => x.date === d.date) === i);

  // ── Trailer ───────────────────────────────────────────────────
  const trailerYoutubeKey = pickField(TRAILER_SOURCES, norm, "trailerYoutubeKey");
  const steamTrailerUrl = pickField(TRAILER_SOURCES, norm, "steamTrailerUrl");

  // ── Store links (union, dedup by name) ────────────────────────
  const allStoreLinks = unionValues(STORE_LINK_SOURCES, norm, "storeLinks") as { name: string; url: string; source: Source }[];
  const storeLinks = allStoreLinks.filter((l, i) => allStoreLinks.findIndex((x) => x.name === l.name) === i);

  // ── Streaming providers (TMDB) ────────────────────────────────
  const streamingProviders = tmdb?.streamingProviders ?? [];

  // ── TMDB credits + keywords (with letterboxd director fallback) ──
  const director = pickField(["tmdb", "letterboxd"], norm, "director");
  const cast = tmdb?.cast ?? [];
  const keywords = dedup(tmdb?.keywords ?? []).slice(0, 12);

  // IMDb id — from TMDB external_ids/imdb_id or Trakt ids.
  const imdbId = pickField(["tmdb", "trakt"], norm, "imdbId");

  // ── External links ────────────────────────────────────────────
  const links: { label: string; url: string }[] = storeLinks.map((sl) => ({ label: sl.name, url: sl.url }));

  // sources: use the actual mediaLinks array passed in for correct sourceIds
  const sources = mediaLinks.map((l) => ({ source: l.source, sourceId: l.sourceId, data: l.rawData }));

  return {
    title,
    releaseDate,
    posterUrl,
    backdropUrl,
    dates: uniqueDates,
    images: images.slice(0, 12),
    tags: tags.slice(0, 12),
    platforms: platforms.slice(0, 10),
    description,
    tagline,
    metacritic,
    steamReviewLabel,
    rtScore: null,
    imdbRating: null,
    imdbId,
    letterboxdRating,
    communityRatings,
    runtimeMinutes,
    certification,
    status,
    collection,
    originalLanguage,
    country,
    budget,
    revenue,
    network,
    seasonCount,
    episodeCount,
    nextEpisode,
    gameModes,
    playtimeHours,
    timeToBeat,
    dlc,
    developer,
    publisher,
    director,
    cast,
    keywords,
    trailerYoutubeKey,
    steamTrailerUrl,
    storeLinks,
    streamingProviders,
    links,
    sources,
  };
}

// ── Merge explainer (debug detail panel) ─────────────────────────
// Mirrors mergeLinks field-by-field: for every merged field, what each present
// source reports, the final merged value, and which source(s) won.

export interface MergeFieldDebug {
  field: string;
  strategy: "first-by-priority" | "longest" | "union" | "tmdb-only" | "single-source";
  priority: Source[];
  perSource: Partial<Record<Source, any>>;
  final: any;
  winners: Source[];
}

export function explainMerge(mediaLinks: MediaLink[], type: MediaType): MergeFieldDebug[] {
  const norm = normalizeAll(mediaLinks.map((l) => ({ source: l.source, data: l.rawData })), type);
  const rows: MergeFieldDebug[] = [];
  const empty = (v: any) => v === null || v === undefined;

  // What each PRESENT source reports for a field (null/[] kept — shows "has nothing").
  const collect = (sources: Source[], field: keyof SourceNormalized, arr = false): Partial<Record<Source, any>> => {
    const out: Partial<Record<Source, any>> = {};
    for (const s of sources) if (norm.has(s)) out[s] = norm.get(s)?.[field] ?? (arr ? [] : null);
    return out;
  };

  const priorityRow = (
    field: keyof SourceNormalized,
    strategy: "first-by-priority" | "longest" | "single-source",
    priority: Source[],
    label: string = field
  ) => {
    const perSource = collect(priority, field);
    const final = strategy === "longest" ? pickLongestField(priority, norm, field) : pickField(priority, norm, field);
    let winners: Source[] = [];
    if (!empty(final)) {
      const winner = strategy === "longest"
        ? priority.find((s) => perSource[s] === final)
        : priority.find((s) => !empty(perSource[s]));
      if (winner) winners = [winner];
    }
    rows.push({ field: label, strategy, priority, perSource, final, winners });
  };

  const unionRow = (field: keyof SourceNormalized, sources: Source[], final: any[], key: (x: any) => string) => {
    const perSource = collect(sources, field, true);
    const finalKeys = new Set(final.map(key));
    const winners = sources.filter((s) => (perSource[s] ?? []).some((v: any) => finalKeys.has(key(v))));
    rows.push({ field, strategy: "union", priority: sources, perSource, final, winners });
  };

  // ── Single-value fields ───────────────────────────────────────
  priorityRow("title", "first-by-priority", TITLE_PRIORITY);
  priorityRow("description", "longest", DESCRIPTION_PRIORITY);
  priorityRow("releaseDate", "first-by-priority", RELEASE_DATE_PRIORITY);
  priorityRow("poster", "first-by-priority", POSTER_PRIORITY, "posterUrl");
  priorityRow("developer", "first-by-priority", DEVELOPER_PRIORITY);
  priorityRow("publisher", "first-by-priority", DEVELOPER_PRIORITY);
  priorityRow("metacritic", "single-source", ["rawg"]);
  priorityRow("steamReviewLabel", "single-source", ["steam"]);
  priorityRow("letterboxdRating", "single-source", ["letterboxd"]);

  // ── Facts (single-value, priority order) ──────────────────────
  priorityRow("tagline", "first-by-priority", TAGLINE_PRIORITY);
  priorityRow("runtimeMinutes", "first-by-priority", RUNTIME_PRIORITY);
  priorityRow("status", "first-by-priority", STATUS_PRIORITY);
  priorityRow("collection", "first-by-priority", COLLECTION_PRIORITY);
  priorityRow("originalLanguage", "first-by-priority", LANGUAGE_PRIORITY);
  priorityRow("country", "first-by-priority", COUNTRY_PRIORITY);
  if (type === "show") priorityRow("network", "first-by-priority", NETWORK_PRIORITY);
  priorityRow("playtimeHours", "single-source", ["rawg"]);
  priorityRow("timeToBeat", "single-source", ["igdb"]);

  // ── Per-source dates (all kept, deduped by value) ─────────────
  {
    const perSource = collect(RELEASE_DATE_PRIORITY, "releaseDate");
    const dates: { source: Source; date: string }[] = [];
    for (const s of RELEASE_DATE_PRIORITY) {
      const date = perSource[s];
      if (date) dates.push({ source: s, date });
    }
    const uniqueDates = dates.filter((d, i) => dates.findIndex((x) => x.date === d.date) === i);
    rows.push({ field: "dates", strategy: "union", priority: RELEASE_DATE_PRIORITY, perSource, final: uniqueDates, winners: uniqueDates.map((d) => d.source) });
  }

  // ── Union fields (same source lists + slices as mergeLinks) ───
  unionRow("images", IMAGE_SOURCES, dedup(unionValues(IMAGE_SOURCES, norm, "images")).slice(0, 12), (x) => x);
  unionRow("tags", TAG_SOURCES, dedup(unionValues(TAG_SOURCES, norm, "tags")).slice(0, 12), (x) => x);
  unionRow("platforms", PLATFORM_SOURCES, dedup(unionValues(PLATFORM_SOURCES, norm, "platforms")).slice(0, 10), (x) => x);
  unionRow("communityRatings", RATING_SOURCES, unionValues(RATING_SOURCES, norm, "communityRatings"), (x) => x.source);
  unionRow("gameModes", GAME_MODE_SOURCES, dedup(unionValues(GAME_MODE_SOURCES, norm, "gameModes")).slice(0, 8), (x) => x);
  unionRow("dlc", DLC_SOURCES, dedup(unionValues(DLC_SOURCES, norm, "dlc")).slice(0, 12), (x) => x);
  unionRow("certification", CERTIFICATION_SOURCES, dedup(unionValues(CERTIFICATION_SOURCES, norm, "certification")).slice(0, 6), (x) => x);

  {
    const all = unionValues(STORE_LINK_SOURCES, norm, "storeLinks") as { name: string; url: string; source: Source }[];
    const storeFinal = all.filter((l, i) => all.findIndex((x) => x.name === l.name) === i);
    rows.push({
      field: "storeLinks",
      strategy: "union",
      priority: STORE_LINK_SOURCES,
      perSource: collect(STORE_LINK_SOURCES, "storeLinks", true),
      final: storeFinal,
      winners: Array.from(new Set(storeFinal.map((l) => l.source))),
    });
  }

  // ── Trailer (first YouTube key by TRAILER_SOURCES, Steam store fallback) ──
  {
    priorityRow("trailerYoutubeKey", "first-by-priority", TRAILER_SOURCES.filter((s) => s !== "steam"));
    const steamUrl = norm.get("steam")?.steamTrailerUrl ?? null;
    rows.push({
      field: "steamTrailerUrl",
      strategy: "single-source",
      priority: ["steam"],
      perSource: norm.has("steam") ? { steam: steamUrl } : {},
      final: steamUrl,
      winners: steamUrl ? ["steam"] : [],
    });
  }

  // ── TMDB-only fields ──────────────────────────────────────────
  {
    const tmdb = norm.get("tmdb");
    const tmdbRow = (field: string, value: any) => {
      const nonEmpty = !empty(value) && !(Array.isArray(value) && value.length === 0);
      rows.push({
        field,
        strategy: "tmdb-only",
        priority: ["tmdb"],
        perSource: tmdb !== undefined ? { tmdb: value } : {},
        final: value,
        winners: nonEmpty ? ["tmdb"] : [],
      });
    };
    tmdbRow("director", tmdb?.director ?? null);
    tmdbRow("cast", tmdb?.cast ?? []);
    tmdbRow("keywords", dedup(tmdb?.keywords ?? []).slice(0, 12));
    tmdbRow("streamingProviders", tmdb?.streamingProviders ?? []);
  }

  return rows;
}

// ── Merge for canonical record (used when upserting media_items) ──

export function mergeForCanonical(links: { source: Source; data: any }[]): {
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
} {
  // Only the canonical fields are needed; normalize the few sources involved and
  // pick by the same priority orders mergeLinks uses.
  const norm = new Map<Source, SourceNormalized>();
  for (const l of links) {
    // Type is unknown here; canonical fields (title/date/poster) don't depend on it.
    norm.set(l.source, normalizeSource(l.source, l.data, "movie"));
  }
  return {
    title: pickField(TITLE_PRIORITY, norm, "title") ?? "Unknown",
    releaseDate: pickField(RELEASE_DATE_PRIORITY, norm, "releaseDate"),
    posterUrl: pickField(POSTER_PRIORITY, norm, "poster"),
  };
}

// ── Normalization for matching ────────────────────────────────────

// Re-exported from the dependency-free module so existing `@/lib/merge` importers
// keep working while db.ts imports the same rule directly (no duplicated logic).
export { normalizeName } from "./normalize";

export function extractYear(date: string | null): number | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

// ── Policy helpers ─────────────────────────────────────────────────

// First non-null value for a field across sources in priority order.
function pickField(priority: Source[], norm: Map<Source, SourceNormalized>, field: keyof SourceNormalized): any {
  for (const s of priority) {
    const v = norm.get(s)?.[field];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

// Longest non-empty string for a field across sources (descriptions).
function pickLongestField(priority: Source[], norm: Map<Source, SourceNormalized>, field: keyof SourceNormalized): string | null {
  let best: string | null = null;
  for (const s of priority) {
    const v = norm.get(s)?.[field] as string | null | undefined;
    if (v && (!best || v.length > best.length)) best = v;
  }
  return best;
}

// Concatenate an array-valued field across sources (in list order), before dedup.
function unionValues(sources: Source[], norm: Map<Source, SourceNormalized>, field: keyof SourceNormalized): any[] {
  const out: any[] = [];
  for (const s of sources) {
    const v = norm.get(s)?.[field] as any[] | undefined;
    if (v) out.push(...v);
  }
  return out;
}

function dedup(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    if (!x || seen.has(x)) return false;
    seen.add(x);
    return true;
  });
}
