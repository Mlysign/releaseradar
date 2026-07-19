// `import type`, not a value import: scripts/migrate.mjs loads this module under
// Node's native type-stripping, which erases `export type Source` from the target
// but would leave a value import of it in place → "does not provide an export".
import type { Source } from "@/types";
import { COUNTRIES } from "@/lib/countries";

// ── H2a: raw_data projection ─────────────────────────────────────────────────
//
// `media_links.raw_data` used to store the ENTIRE provider payload. Measured on
// the live catalog that was ~92KB per TMDB link — 149.6MB across 4,012 links, or
// ~94% of the whole database — while the app reads a small, fixed subset.
//
// Measured field shares on the largest TMDB blobs (avg 197KB):
//   credits         53.9%   ← we read ONE name (the Director) + cast.slice(0,8)
//   watch/providers 36.3%   ← ~200 countries; users.country is validated against
//                             a curated list, so the rest can NEVER be read
//   release_dates    6.0%   ← same: per-country, only the curated set is reachable
//   videos           2.5%   ← we read one trailer key
//   (top 6 fields = 99.2% of the payload)
//
// So this projects a payload down to what the readers actually consume. It is
// applied at WRITE time; everything downstream keeps reading `rawData` exactly as
// before, which is why no reader had to change.
//
// WHAT MUST SURVIVE — verified by tracing every reader:
//   • the identity fields matcher.ts pulls cross-ids from (`id`, `ids.{trakt,
//     tmdb}`, `appid`) — dropping these would break item matching and
//     media_external_ids
//   • everything `normalize.ts` reads (it defines the app's whole view of an item)
//   • the direct readers outside normalize: discovery.ts (tmdb/rawg scoring),
//     facets.ts, enrichGameDetail.ts
//
// Anything not explicitly kept is dropped, so this is a deny-by-default list:
// a NEW consumer of an unprojected field must add it here AND bump
// PROJECTION_VERSION, or it will read undefined on freshly-written rows.

/**
 * Bump when the kept-field set changes. Stored per link in
 * `media_links.projection_version` so staleness is an EXPLICIT check.
 *
 * This replaces the old field-sniffing (`ensureTmdbDetail` treating a missing
 * `external_ids`/`keywords` as "stale → refetch"). Sniffing and projection are
 * fundamentally incompatible: a projected row is legitimately missing fields, so
 * a sniffer sees every row as stale and stampedes the provider APIs.
 */
// v2 (2026-07-19): IGDB's GAME_FIELDS query now requests `keywords.name` (was
// missing entirely — steampunk/atmospheric/soulslike-style tags never reached
// raw_data before this). projectIgdb() keeps IGDB payloads verbatim (nothing
// to add to a keep-list here), but existing stored rows still lack the field
// outright, so the version bump is what makes ensureGameDetail() treat them
// as stale and refetch.
export const PROJECTION_VERSION = 2;

// The only countries `users.country` can be set to (validated by
// normalizeCountry), so region data outside this set is unreachable by design.
const KEPT_REGIONS = new Set(COUNTRIES.map((c) => c.code));

// Cast kept per title. normalize.ts renders 8; the headroom means a UI that
// shows a few more doesn't need a re-fetch of the whole catalog.
const CAST_LIMIT = 20;

function pick<T extends object>(o: T | null | undefined, keys: string[]): any {
  if (!o) return undefined;
  const out: any = {};
  for (const k of keys) if ((o as any)[k] !== undefined) out[k] = (o as any)[k];
  return out;
}

// `watch/providers` is the single biggest field even AFTER region-filtering
// (62% of the projected blob), so it gets trimmed three ways — all verified
// lossless by the probe:
//
//  1. non-curated regions dropped (unreachable — see KEPT_REGIONS)
//  2. `link` dropped (an ~87-char JustWatch URL per region that nothing reads)
//  3. only the ONE array normalize can select is kept. normalize takes the first
//     non-empty of `flatrate ?? free ?? ads ?? rent ?? buy`, so for any region
//     the other four are unreachable — and rent/buy are usually the longest.
//
// (3) bakes normalize's priority into storage: if that order changes, bump
// PROJECTION_VERSION so rows re-fetch.
const PROVIDER_PRIORITY = ["flatrate", "free", "ads", "rent", "buy"] as const;

function projectWatchProviders(results: any): any {
  if (!results || typeof results !== "object") return results;
  const out: any = {};
  for (const [iso, region] of Object.entries<any>(results)) {
    if (!KEPT_REGIONS.has(iso)) continue;
    const key = PROVIDER_PRIORITY.find((k) => region?.[k]?.length);
    if (!key) continue; // normalize skips regions with no providers anyway
    out[iso] = {
      [key]: region[key].map((p: any) => pick(p, ["provider_id", "provider_name", "logo_path"])),
    };
  }
  return out;
}

// Keep only the curated regions from a `[{ iso_3166_1, ... }]` shaped list.
function pickRegionList(results: any): any {
  if (!Array.isArray(results)) return results;
  return results.filter((r) => KEPT_REGIONS.has(r?.iso_3166_1));
}

function projectTmdb(d: any): any {
  const out: any = pick(d, [
    // identity + core (matcher reads `id`)
    // identity + core (matcher reads `id`)
    "id", "title", "name", "original_title", "original_name",
    "release_date", "first_air_date", "overview", "tagline", "homepage",
    "poster_path", "backdrop_path", "status", "original_language",
    "vote_average", "vote_count", "popularity", "budget", "revenue", "adult",
    // runtime: movies use `runtime`; shows fall back
    // `episode_run_time[0] ?? last_episode_to_air.runtime` — omitting
    // last_episode_to_air nulled runtimeMinutes on shows (probe caught it).
    "runtime", "episode_run_time", "last_episode_to_air",
    // imdbId is `external_ids.imdb_id ?? imdb_id` — the top-level fallback is
    // the only source on a handful of older blobs.
    "external_ids", "imdb_id",
    // small structured bits normalize.ts reads wholesale
    // country is `production_countries[0].name ?? origin_country[0]` — the
    // origin_country fallback is what shows rely on.
    "genres", "production_companies", "production_countries", "origin_country",
    "spoken_languages", "belongs_to_collection", "created_by",
    "number_of_seasons", "number_of_episodes", "next_episode_to_air", "networks",
    "content_ratings",
  ]);

  // credits: 54% of the payload, and we read a single crew name + the top cast.
  if (d.credits) {
    out.credits = {
      cast: (d.credits.cast ?? []).slice(0, CAST_LIMIT).map((c: any) =>
        pick(c, ["id", "name", "character", "profile_path", "order"])
      ),
      // Only the crew rows any consumer looks up by job.
      crew: (d.credits.crew ?? [])
        .filter((c: any) => ["Director", "Creator", "Writer", "Screenplay"].includes(c?.job))
        .map((c: any) => pick(c, ["id", "name", "job", "profile_path"])),
    };
  }

  // videos: only ~2.5% of the payload, and the trailer pick is FRAGILE —
  // normalizeTmdb does `official Trailer ?? any Trailer ?? ANY YouTube video`,
  // and each clause is an order-dependent `find`. So filtering by type or
  // slicing silently selects a DIFFERENT trailer (the probe caught this on 289
  // titles). Keep every YouTube video, in order; only trim per-video fields.
  // site !== "YouTube" is safe to drop: all three clauses require YouTube.
  if (d.videos?.results) {
    out.videos = {
      results: d.videos.results
        .filter((v: any) => v?.site === "YouTube")
        .map((v: any) => pick(v, ["key", "site", "type", "official", "name"])),
    };
  }

  // Region-scoped blocks: 36% + 6% of the payload, ~85% of it unreachable.
  if (d["watch/providers"]?.results) {
    out["watch/providers"] = { results: projectWatchProviders(d["watch/providers"].results) };
  }
  if (d.release_dates?.results) {
    out.release_dates = { results: pickRegionList(d.release_dates.results) };
  }

  // keywords is small but arrives under two shapes (movie vs tv).
  if (d.keywords) {
    out.keywords = d.keywords.keywords
      ? { keywords: (d.keywords.keywords ?? []).map((k: any) => pick(k, ["id", "name"])) }
      : { results: (d.keywords.results ?? []).map((k: any) => pick(k, ["id", "name"])) };
  }

  return out;
}

function projectTrakt(d: any): any {
  // Trakt payloads are already small (1,242 links = 1.4MB total). Keep as-is:
  // `ids` is what matcher.ts cross-references, and trimming buys nothing.
  return d;
}

// Field list derived by extracting every `d.<field>` normalizeRawg touches — not
// by eyeballing. Missing `background_image_additional` + `short_screenshots` here
// silently changed `images` on 704 of 722 links, which the losslessness probe
// caught. Keep this list in sync with normalizeRawg.
function projectRawg(d: any): any {
  const out: any = pick(d, [
    "id", "slug", "name", "released", "tba", "description_raw", "description",
    "background_image", "background_image_additional",
    "metacritic", "metacritic_url", "reddit_url", "playtime", "rating",
    "ratings_count", "website", "esrb_rating", "updated",
  ]);
  for (const k of [
    "platforms", "genres", "tags", "developers", "publishers", "stores",
    "screenshots", "short_screenshots", "parent_platforms",
  ]) {
    if (d[k]) out[k] = d[k];
  }
  return out;
}

function projectIgdb(d: any): any {
  return d; // small; `id` is the cross-ref
}

function projectSteam(d: any): any {
  // `appid` is the cross-ref. Steam payloads carry big screenshot/movie lists
  // but total only 4.4MB across 576 links — not worth the risk of trimming.
  return d;
}

/**
 * Project a provider payload down to the fields the app reads.
 * Unknown sources pass through untouched (safe default: keep everything).
 */
export function projectRawData(source: Source, data: any): any {
  if (data == null || typeof data !== "object") return data;
  switch (source) {
    case "tmdb": return projectTmdb(data);
    case "rawg": return projectRawg(data);
    case "trakt": return projectTrakt(data);
    case "igdb": return projectIgdb(data);
    case "steam": return projectSteam(data);
    default: return data;
  }
}
