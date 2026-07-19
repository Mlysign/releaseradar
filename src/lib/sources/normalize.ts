import { Source, MediaType, CommunityRating, EnrichedItem } from "@/types";

// ── A1: per-source normalizers ────────────────────────────────────────────────
// Each source maps its raw_data → a SourceNormalized partial (one place per
// platform). merge.ts is now pure POLICY (priority/union over these partials);
// adding a source = one normalizer here + its priority-list entry, with zero edits
// to the merge logic. This replaces the old field-oriented switch(source) monolith
// where one platform's knowledge was smeared across ~20 extractors.

export interface SourceNormalized {
  // single-value
  title?: string | null;
  description?: string | null;
  releaseDate?: string | null;
  poster?: string | null;     // portrait box-art (2:3) — for the card view
  backdrop?: string | null;   // landscape art (≈16:9) — for the list-row thumbnail
  tagline?: string | null;
  developer?: string | null;
  publisher?: string | null;
  metacritic?: number | null;
  steamReviewLabel?: string | null;
  letterboxdRating?: number | null;
  runtimeMinutes?: number | null;
  status?: string | null;
  collection?: string | null;
  originalLanguage?: string | null;
  country?: string | null;
  network?: string | null;
  playtimeHours?: number | null;
  timeToBeat?: EnrichedItem["timeToBeat"];
  director?: string | null;
  imdbId?: string | null;
  trailerYoutubeKey?: string | null;
  steamTrailerUrl?: string | null;
  // multi-value (union)
  images?: string[];
  tags?: string[];
  platforms?: string[];
  certification?: string[];
  gameModes?: string[];
  dlc?: string[];
  keywords?: string[];
  communityRatings?: CommunityRating[];
  storeLinks?: { name: string; url: string; source: Source }[];
  cast?: { name: string; character: string | null; profileUrl?: string | null }[];
  streamingProviders?: { name: string; logoPath: string | null; providerId: number }[];
  // T22: full per-region maps so merge can pick the user's country. Streaming for
  // every region TMDB returns; release dates per region (movies).
  streamingByRegion?: Record<string, { name: string; logoPath: string | null; providerId: number }[]>;
  releaseDatesByRegion?: Record<string, string>;
  // tmdb-only facts
  budget?: number | null;
  revenue?: number | null;
  seasonCount?: number | null;
  episodeCount?: number | null;
  nextEpisode?: EnrichedItem["nextEpisode"];
}

// ── Shared formatting helpers ─────────────────────────────────────────────────

// IGDB images are referenced by image_id → build a sized CDN URL.
function igdbImg(imageId: string | undefined | null, size: string): string | null {
  return imageId ? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg` : null;
}

// Slug → Title Case ("science-fiction" → "Science Fiction") so Trakt's slugged
// genres/statuses dedup against TMDB's display names.
function titleCaseSlug(s: string): string {
  return s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function trailerKeyFromUrl(url: any): string | null {
  const m = String(url ?? "").match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return m?.[1] ?? null;
}

// ── TMDB ──────────────────────────────────────────────────────────────────────

function normalizeTmdb(d: any, type: MediaType): SourceNormalized {
  const out: SourceNormalized = {};
  out.title = d.title ?? d.name ?? null;
  out.description = d.overview ?? null;
  out.releaseDate = d.release_date ?? d.first_air_date ?? null;
  out.poster = d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null;
  out.backdrop = d.backdrop_path ? `https://image.tmdb.org/t/p/w780${d.backdrop_path}` : null;
  out.tagline = d.tagline || null;
  out.runtimeMinutes = type === "movie"
    ? (d.runtime || null)
    : (d.episode_run_time?.[0] ?? d.last_episode_to_air?.runtime ?? null);
  out.status = d.status || null;
  out.collection = d.belongs_to_collection?.name ?? null;
  out.originalLanguage = (() => {
    const iso = d.original_language;
    if (!iso) return null;
    return (d.spoken_languages ?? []).find((l: any) => l.iso_639_1 === iso)?.english_name ?? iso.toUpperCase();
  })();
  out.country = d.production_countries?.[0]?.name ?? d.origin_country?.[0] ?? null;
  out.network = d.networks?.[0]?.name ?? null;

  // certification (union; TMDB carries DE + US)
  out.certification = (() => {
    const cert: string[] = [];
    if (type === "movie") {
      const results: any[] = d.release_dates?.results ?? [];
      const certOf = (iso: string) =>
        results.find((r) => r.iso_3166_1 === iso)?.release_dates?.find((x: any) => x.certification)?.certification ?? null;
      const de = certOf("DE"); if (de) cert.push(`FSK ${de}`);
      const us = certOf("US"); if (us) cert.push(us);
    } else {
      const ratings: any[] = d.content_ratings?.results ?? [];
      const de = ratings.find((r) => r.iso_3166_1 === "DE")?.rating; if (de) cert.push(`FSK ${de}`);
      const us = ratings.find((r) => r.iso_3166_1 === "US")?.rating; if (us) cert.push(us);
    }
    return cert;
  })();

  out.communityRatings = d.vote_average > 0
    ? [{ source: "tmdb", label: "TMDB", score: round1(d.vote_average), outOf: 10, votes: d.vote_count ?? null }]
    : [];

  const images: string[] = [];
  if (d.poster_path) images.push(`https://image.tmdb.org/t/p/w500${d.poster_path}`);
  if (d.backdrop_path) images.push(`https://image.tmdb.org/t/p/w780${d.backdrop_path}`);
  out.images = images;

  out.tags = (d.genres ?? []).map((g: any) => g.name).filter(Boolean);

  const storeLinks: SourceNormalized["storeLinks"] = [];
  if (d.id && type === "movie") storeLinks!.push({ name: "TMDB", url: `https://www.themoviedb.org/movie/${d.id}`, source: "tmdb" });
  if (d.id && type === "show") storeLinks!.push({ name: "TMDB", url: `https://www.themoviedb.org/tv/${d.id}`, source: "tmdb" });
  if (d.homepage) storeLinks!.push({ name: "Official site", url: d.homepage, source: "tmdb" });
  if (d.external_ids?.imdb_id) storeLinks!.push({ name: "IMDb", url: `https://www.imdb.com/title/${d.external_ids.imdb_id}/`, source: "tmdb" });
  out.storeLinks = storeLinks;

  out.trailerYoutubeKey = (() => {
    const vids: any[] = d.videos?.results ?? [];
    const t = vids.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official)
      ?? vids.find((v) => v.site === "YouTube" && v.type === "Trailer")
      ?? vids.find((v) => v.site === "YouTube");
    return t?.key ?? null;
  })();

  // Full per-region streaming map (merge picks the user's country — T22). The
  // legacy DE-first `streamingProviders` is kept for the debug explainer.
  out.streamingByRegion = (() => {
    const results = d["watch/providers"]?.results;
    if (!results) return undefined;
    const map: Record<string, { name: string; logoPath: string | null; providerId: number }[]> = {};
    for (const [iso, region] of Object.entries<any>(results)) {
      const providers = region?.flatrate ?? region?.free ?? region?.ads ?? region?.rent ?? region?.buy ?? [];
      if (providers.length) {
        map[iso] = providers.map((p: any) => ({ name: p.provider_name, logoPath: p.logo_path ?? null, providerId: p.provider_id }));
      }
    }
    return Object.keys(map).length ? map : undefined;
  })();
  out.streamingProviders = (() => {
    const m = out.streamingByRegion;
    return m ? (m.DE ?? m.US ?? m[Object.keys(m)[0]]) : [];
  })();

  // Per-region release dates (movies) — TMDB carries different theatrical/digital
  // dates per country; merge picks the user's region (T22). Prefer a real
  // theatrical/digital/premiere date, else the earliest of any type.
  out.releaseDatesByRegion = (() => {
    if (type !== "movie") return undefined;
    const results: any[] = d.release_dates?.results ?? [];
    const map: Record<string, string> = {};
    for (const r of results) {
      const iso = r.iso_3166_1;
      const dates = (r.release_dates ?? []).filter((x: any) => x.release_date);
      if (!iso || !dates.length) continue;
      const ranked = [...dates].sort((a: any, b: any) => (a.release_date < b.release_date ? -1 : 1));
      const preferred = ranked.find((x: any) => [3, 4, 2, 1].includes(x.type)) ?? ranked[0];
      map[iso] = String(preferred.release_date).slice(0, 10);
    }
    return Object.keys(map).length ? map : undefined;
  })();

  out.director = type === "show"
    ? (d.created_by?.[0]?.name ?? null)
    : ((d.credits?.crew ?? []).find((c: any) => c.job === "Director")?.name ?? null);
  out.cast = (d.credits?.cast ?? []).slice(0, 8).map((c: any) => ({
    name: c.name,
    character: c.character ?? null,
    profileUrl: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
  }));
  out.keywords = (d.keywords?.keywords ?? d.keywords?.results ?? []).map((k: any) => k.name).filter(Boolean);

  out.imdbId = d.external_ids?.imdb_id ?? d.imdb_id ?? null;
  out.budget = d.budget > 0 ? d.budget : null;
  out.revenue = d.revenue > 0 ? d.revenue : null;
  out.seasonCount = type === "show" ? (d.number_of_seasons ?? null) : null;
  out.episodeCount = type === "show" ? (d.number_of_episodes ?? null) : null;
  out.nextEpisode = type === "show" && d.next_episode_to_air
    ? {
        name: d.next_episode_to_air.name ?? null,
        airDate: d.next_episode_to_air.air_date ?? null,
        season: d.next_episode_to_air.season_number ?? null,
        episode: d.next_episode_to_air.episode_number ?? null,
      }
    : null;
  return out;
}

// ── Trakt ─────────────────────────────────────────────────────────────────────

function normalizeTrakt(d: any, type: MediaType): SourceNormalized {
  const out: SourceNormalized = {};
  out.title = d.title ?? d.show?.title ?? null;
  out.description = d.overview ?? null;
  out.releaseDate = d.released ?? d.first_aired?.split("T")[0] ?? null;
  out.poster = null;
  out.tagline = d.tagline || null;
  out.runtimeMinutes = d.runtime || null;
  out.status = d.status ? titleCaseSlug(String(d.status).replace(/\s+/g, "-")) : null;
  out.originalLanguage = d.language ? String(d.language).toUpperCase() : null;
  out.country = d.country ? String(d.country).toUpperCase() : null;
  out.network = d.network ?? null;
  out.certification = d.certification ? [d.certification] : [];
  out.communityRatings = d.rating > 0
    ? [{ source: "trakt", label: "Trakt", score: round1(d.rating), outOf: 10, votes: d.votes ?? null }]
    : [];
  out.tags = [...(d.genres ?? []), ...(d.subgenres ?? [])]
    .filter((g: any) => typeof g === "string").map(titleCaseSlug);

  const storeLinks: SourceNormalized["storeLinks"] = [];
  const slug = d.ids?.slug;
  if (slug) storeLinks!.push({ name: "Trakt", url: `https://trakt.tv/${type === "show" ? "shows" : "movies"}/${slug}`, source: "trakt" });
  if (d.homepage) storeLinks!.push({ name: "Official site", url: d.homepage, source: "trakt" });
  if (d.ids?.imdb) storeLinks!.push({ name: "IMDb", url: `https://www.imdb.com/title/${d.ids.imdb}/`, source: "trakt" });
  if (d.social_ids?.wikipedia) storeLinks!.push({ name: "Wikipedia", url: `https://en.wikipedia.org/wiki/${d.social_ids.wikipedia}`, source: "trakt" });
  out.storeLinks = storeLinks;

  out.trailerYoutubeKey = trailerKeyFromUrl(d.trailer);
  out.imdbId = d.ids?.imdb ?? null;
  return out;
}

// ── Letterboxd ────────────────────────────────────────────────────────────────

function normalizeLetterboxd(d: any): SourceNormalized {
  const out: SourceNormalized = {};
  out.title = d.name ?? null;
  out.description = d.description ?? null;
  out.releaseDate = d.releaseYear ? `${d.releaseYear}-01-01` : null;
  out.poster = d.posterUrl ?? d.poster?.versions?.[0]?.url ?? null;
  out.tagline = d.tagline || null;
  out.runtimeMinutes = d.runTime || null;
  out.letterboxdRating = typeof d.averageRating === "number" ? d.averageRating : null;
  out.communityRatings = typeof d.averageRating === "number"
    ? [{ source: "letterboxd", label: "Letterboxd", score: round1(d.averageRating), outOf: 5 }]
    : [];
  out.tags = (d.genres ?? []).map((g: any) => g.name).filter(Boolean);

  const images: string[] = [];
  if (d.posterUrl) images.push(d.posterUrl);
  for (const v of d.poster?.versions ?? []) if (v.url) images.push(v.url);
  out.images = images;

  const storeLinks: SourceNormalized["storeLinks"] = [];
  if (d.id) storeLinks!.push({ name: "Letterboxd", url: `https://letterboxd.com/film/${d.id}/`, source: "letterboxd" });
  for (const l of d.links ?? []) if (l.type === "imdb" && l.url) storeLinks!.push({ name: "IMDb", url: l.url, source: "letterboxd" });
  out.storeLinks = storeLinks;

  out.director = d.directors?.[0]?.name ?? null;
  return out;
}

// ── Steam ─────────────────────────────────────────────────────────────────────

function normalizeSteam(d: any): SourceNormalized {
  const out: SourceNormalized = {};
  const appId = d.appid;
  out.title = d.name ?? null;
  out.description = d.basic_info?.short_description ?? d.short_description ?? null;
  out.releaseDate = (() => {
    const r = d.release;
    if (!r) return null;
    if (r.steam_release_date) return new Date(r.steam_release_date * 1000).toISOString().split("T")[0];
    if (r.custom_release_date?.date) {
      const p = Date.parse(r.custom_release_date.date);
      if (!isNaN(p)) return new Date(p).toISOString().split("T")[0];
    }
    return null;
  })();
  // Portrait box-art (library_capsule, ≈600×900) when the enriched assets are
  // present; else fall back to the landscape header (un-enriched owned-games).
  const steamCapsule = d.assets?.asset_url_format && d.assets?.library_capsule
    ? `https://shared.fastly.steamstatic.com/store_item_assets/${d.assets.asset_url_format.replace("${FILENAME}", d.assets.library_capsule)}`
    : null;
  const steamHeader = appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg` : null;
  out.poster = steamCapsule ?? steamHeader;
  out.backdrop = steamHeader;
  out.steamReviewLabel = d.reviews?.summary_filtered?.review_score_label ?? null;
  out.developer = d.basic_info?.developers?.[0]?.name ?? null;
  out.publisher = d.basic_info?.publishers?.[0]?.name ?? null;
  out.certification = (() => {
    const r = d.game_rating;
    if (!r?.rating) return [];
    // SM4: `type` is Steam's internal rating-system id, not a display label —
    // "steam_germany" is the German storefront's USK-aligned age rating and was
    // rendering raw as "STEAM_GERMANY 6". Map the known systems; unknown ones
    // fall back to title-cased words instead of UPPER_SNAKE.
    const SYSTEM_LABEL: Record<string, string> = {
      esrb: "ESRB", pegi: "PEGI", usk: "USK", steam_germany: "USK",
      cero: "CERO", bbfc: "BBFC", dejus: "ClassInd", csrr: "CSRR", kgrb: "GRAC",
    };
    const type = String(r.type ?? "").toLowerCase();
    const label = SYSTEM_LABEL[type] ??
      type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    return [`${label} ${r.rating}`.trim()];
  })();
  out.communityRatings = (() => {
    const s = d.reviews?.summary_filtered;
    return s?.percent_positive > 0
      ? [{ source: "steam", label: "Steam", score: s.percent_positive, outOf: 100, votes: s.review_count ?? null }]
      : [];
  })();

  const images: string[] = [];
  if (appId) images.push(`https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`);
  if (d.assets?.asset_url_format && d.assets?.hero_capsule) {
    const path = d.assets.asset_url_format.replace("${FILENAME}", d.assets.hero_capsule);
    images.push(`https://shared.fastly.steamstatic.com/store_item_assets/${path}`);
  }
  for (const s of (d.screenshots?.all_ages_screenshots ?? []).slice(0, 5)) {
    if (s.filename) images.push(`https://shared.fastly.steamstatic.com/store_item_assets/${s.filename}`);
  }
  out.images = images;

  out.tags = d.resolvedTags ?? [];
  out.platforms = Object.entries(d.platforms ?? {})
    .filter(([k, v]) => ["windows", "mac", "linux"].includes(k) && v === true)
    .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));
  out.dlc = (d.included_items?.included_apps ?? [])
    .map((a: any) => a.name)
    .filter((n: any) => n && n !== d.name);

  out.storeLinks = appId ? [{ name: "Steam", url: `https://store.steampowered.com/app/${appId}`, source: "steam" }] : [];
  out.steamTrailerUrl = (d.trailers?.highlights?.length ?? 0) > 0
    ? `https://store.steampowered.com/app/${appId}` : null;
  return out;
}

// ── RAWG ──────────────────────────────────────────────────────────────────────

function normalizeRawg(d: any): SourceNormalized {
  const out: SourceNormalized = {};
  out.title = d.name ?? null;
  out.description = d.description_raw ?? d.description ?? null;
  out.releaseDate = d.released ?? null;
  // RAWG only carries landscape art — same image serves as poster fallback and
  // backdrop (POSTER_PRIORITY prefers Steam/IGDB portrait art when present).
  out.poster = d.background_image ?? null;
  out.backdrop = d.background_image ?? null;
  out.metacritic = typeof d.metacritic === "number" ? d.metacritic : null;
  out.developer = d.developers?.[0]?.name ?? null;
  out.publisher = d.publishers?.[0]?.name ?? null;
  out.playtimeHours = d.playtime > 0 ? d.playtime : null;
  out.certification = d.esrb_rating?.name ? [`ESRB ${d.esrb_rating.name}`] : [];
  out.communityRatings = (() => {
    const r: CommunityRating[] = [];
    if (d.rating > 0) r.push({ source: "rawg", label: "RAWG", score: round1(d.rating), outOf: 5, votes: d.ratings_count ?? null });
    if (typeof d.metacritic === "number") r.push({ source: "metacritic", label: "Metacritic", score: d.metacritic, outOf: 100, url: d.metacritic_url ?? null });
    return r;
  })();

  const images: string[] = [];
  if (d.background_image) images.push(d.background_image);
  if (d.background_image_additional) images.push(d.background_image_additional);
  for (const s of (d.screenshots ?? d.short_screenshots ?? []).slice(0, 5)) if (s.image) images.push(s.image);
  out.images = images;

  out.tags = (d.genres ?? []).map((g: any) => g.name).filter(Boolean);
  out.platforms = (d.platforms ?? []).map((p: any) => p.platform?.name).filter(Boolean);

  const storeLinks: SourceNormalized["storeLinks"] = [];
  if (d.slug) storeLinks!.push({ name: "RAWG", url: `https://rawg.io/games/${d.slug}`, source: "rawg" });
  for (const s of d.stores ?? []) if (s.url) storeLinks!.push({ name: s.store.name, url: s.url, source: "rawg" });
  if (d.website) storeLinks!.push({ name: "Official site", url: d.website, source: "rawg" });
  if (d.reddit_url) storeLinks!.push({ name: "Reddit", url: d.reddit_url, source: "rawg" });
  if (d.metacritic_url) storeLinks!.push({ name: "Metacritic", url: d.metacritic_url, source: "rawg" });
  out.storeLinks = storeLinks;
  return out;
}

// ── IGDB ──────────────────────────────────────────────────────────────────────

function normalizeIgdb(d: any): SourceNormalized {
  const out: SourceNormalized = {};
  out.title = d.name ?? null;
  out.description = d.summary ?? null;
  out.releaseDate = typeof d.first_release_date === "number"
    ? new Date(d.first_release_date * 1000).toISOString().split("T")[0] : null;
  out.poster = igdbImg(d.cover?.image_id, "t_cover_big");
  // Landscape art for the list thumbnail: first artwork, else first screenshot.
  out.backdrop = igdbImg(d.artworks?.[0]?.image_id ?? d.screenshots?.[0]?.image_id, "t_1080p");
  out.developer = (d.involved_companies ?? []).find((c: any) => c.developer)?.company?.name ?? null;
  out.publisher = (d.involved_companies ?? []).find((c: any) => c.publisher)?.company?.name ?? null;
  out.collection = d.franchises?.[0]?.name ?? null;
  out.timeToBeat = (() => {
    if (!d.time_to_beat) return null;
    const h = (s: any) => (typeof s === "number" && s > 0 ? round1(s / 3600) : null);
    const t = d.time_to_beat;
    const ttb = { hastily: h(t.hastily), normally: h(t.normally), completely: h(t.completely) };
    return ttb.hastily || ttb.normally || ttb.completely ? ttb : null;
  })();
  out.communityRatings = (() => {
    const r: CommunityRating[] = [];
    if (d.rating > 0) r.push({ source: "igdb", label: "IGDB", score: Math.round(d.rating), outOf: 100, votes: d.rating_count ?? null });
    if (d.aggregated_rating > 0) r.push({ source: "igdb-critics", label: "IGDB Critics", score: Math.round(d.aggregated_rating), outOf: 100, votes: d.aggregated_rating_count ?? null });
    return r;
  })();

  const images: string[] = [];
  const cover = igdbImg(d.cover?.image_id, "t_cover_big");
  if (cover) images.push(cover);
  for (const s of (d.screenshots ?? []).slice(0, 5)) { const u = igdbImg(s.image_id, "t_screenshot_huge"); if (u) images.push(u); }
  for (const a of (d.artworks ?? []).slice(0, 3)) { const u = igdbImg(a.image_id, "t_1080p"); if (u) images.push(u); }
  out.images = images;

  // Keywords (steampunk, atmospheric, soulslike, …) folded into `tags` — same
  // bucket genres/themes already use. `merge.ts`'s dedicated `keywords` field
  // is TMDB-only by design (movies/shows), so a game's flavor tags need to
  // ride in `tags` to reach the "Tags & details" section at all.
  out.tags = [...(d.genres ?? []), ...(d.themes ?? []), ...(d.keywords ?? [])].map((g: any) => g.name).filter(Boolean);
  out.platforms = (d.platforms ?? []).map((p: any) => p.name).filter(Boolean);
  out.gameModes = [
    ...(d.game_modes ?? []).map((m: any) => m.name),
    ...(d.player_perspectives ?? []).map((p: any) => p.name),
  ].filter(Boolean);
  out.dlc = [...(d.dlcs ?? []), ...(d.expansions ?? [])].map((x: any) => x.name).filter(Boolean);

  const storeLinks: SourceNormalized["storeLinks"] = [];
  if (d.url) storeLinks!.push({ name: "IGDB", url: d.url, source: "igdb" });
  const IGDB_SITE_NAMES: Record<number, string> = {
    1: "Official site", 3: "Wikipedia", 13: "Steam", 14: "Reddit",
    15: "itch.io", 16: "Epic Games", 17: "GOG", 18: "Discord",
  };
  for (const w of d.websites ?? []) { const name = IGDB_SITE_NAMES[w.type]; if (name && w.url) storeLinks!.push({ name, url: w.url, source: "igdb" }); }
  out.storeLinks = storeLinks;

  // videos[] are YouTube ids — prefer the one actually named "Trailer".
  const vids: any[] = d.videos ?? [];
  out.trailerYoutubeKey = (vids.find((v) => /trailer/i.test(v.name ?? "")) ?? vids[0])?.video_id ?? null;
  return out;
}

// ── Registry ──────────────────────────────────────────────────────────────────
// New source = add one entry here. merge.ts never changes.
const NORMALIZERS: Partial<Record<Source, (data: any, type: MediaType) => SourceNormalized>> = {
  tmdb: normalizeTmdb,
  trakt: normalizeTrakt,
  letterboxd: (d) => normalizeLetterboxd(d),
  steam: (d) => normalizeSteam(d),
  rawg: (d) => normalizeRawg(d),
  igdb: (d) => normalizeIgdb(d),
};

export function normalizeSource(source: Source, data: any, type: MediaType): SourceNormalized {
  const fn = NORMALIZERS[source];
  return fn ? fn(data, type) : {};
}
