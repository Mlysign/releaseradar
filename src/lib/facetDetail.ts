// Facet detail — everything about one tag / person / company: the titles that
// carry it (with the user's library state), the user's average rating, how that
// compares to the crowd, and (for people) a TMDB bio/age. Powers /insights/facet.
//
// Two sides, sourced independently so neither gets skewed:
//   - YOUR average  → always your full local catalog for the facet (every title
//     you rated), via itemsWithFacet. A sampled crowd set must NOT shrink this.
//   - CROWD average → the broadest sensible set (payload.scope):
//       person  → full TMDB filmography (combined_credits)        "filmography"
//       studio  → TMDB titles, popularity + recency sample        "sample"
//       dev/pub → RAWG titles, most-added + most-recent sample     "sample"
//       tag     → TMDB genre/keyword + RAWG genre/tag, pop+recent  "sample"
//       (network / failed resolution / no external) → catalog      "catalog"
// Sampling blends popularity with recency on purpose: popularity-only over-
// represents hits and inflates the crowd average.

import { BoundedCache } from "@/lib/boundedCache";
import { itemsWithFacet, resolvePersonTmdbId, resolveRawgEntityId, DiscoveryVector } from "@/lib/discovery";
import { getLibraryFacetAnalysis } from "@/lib/libraryAnalysis";
import { getUserStateMap, resolveMediaIdsBySource } from "@/lib/userState";
import { tmdbGenreId, rawgGenreSlug, rawgTagSlug, resolveTmdbKeywordId } from "@/lib/sources/tagDiscover";
import { FacetRole } from "@/lib/facets";
import { MediaType } from "@/types";

const TMDB = process.env.TMDB_API_KEY;
const RAWG = process.env.RAWG_API_KEY;
const MAX_ITEMS = 150;
const COMPANY_PAGES = [1, 2]; // sample depth for a studio/dev (≈40 per sort order)
const TAG_PAGES = [1];        // tags are huge → 20 popular + 20 recent per source
const WRITER_JOBS = new Set(["Writer", "Screenplay", "Story", "Novel", "Author", "Comic Book", "Characters", "Teleplay"]);

export type FacetScope = "filmography" | "sample" | "catalog";

export interface FacetRefIn { kind: string; role?: FacetRole; key: string; label: string }

export interface FacetDetailItem {
  id: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  platformSources: string[];
  onWatchlist: boolean;
  libraryStatus: string | null;
  rating: number | null;
  communityScore: number | null; // 0-100
  sources: { source: string; sourceId: string }[];
}

export interface PersonMeta {
  name: string;
  biography: string | null;
  birthday: string | null;
  deathday: string | null;
  age: number | null;
  placeOfBirth: string | null;
  profileUrl: string | null;
  knownForDepartment: string | null;
  tmdbUrl: string;
}

export interface FacetDetailPayload {
  facet: FacetRefIn;
  person: PersonMeta | null;
  scope: FacetScope;
  stats: {
    userAvg: number | null;
    userCount: number;
    totalCount: number;              // titles in the merged list (yours + discovered)
    crowdCount: number;              // titles the crowd average is computed over
    communityAvg: number | null;     // crowd avg (0-10) over the full/sampled set
    catalogCommunityAvg: number | null; // crowd avg (0-10) over the titles you rated
    baseline: number;
    delta: number | null;
  };
  items: FacetDetailItem[];
  shown: number;
}

// Normalized external title (crowd vote on a 0-10 scale).
interface ExtTitle {
  source: "tmdb" | "rawg";
  sourceId: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  vote: number | null;
  votes: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function ageFrom(birthday: string | null, deathday: string | null): number | null {
  if (!birthday) return null;
  const b = new Date(birthday);
  const end = deathday ? new Date(deathday) : new Date();
  if (isNaN(b.getTime()) || isNaN(end.getTime())) return null;
  let age = end.getFullYear() - b.getFullYear();
  const m = end.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && end.getDate() < b.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

async function tmdbJson(path: string): Promise<any | null> {
  if (!TMDB) return null;
  try {
    const r = await fetch(`https://api.themoviedb.org/3${path}${path.includes("?") ? "&" : "?"}api_key=${TMDB}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function rawgJson(path: string): Promise<any | null> {
  if (!RAWG) return null;
  try {
    const r = await fetch(`https://api.rawg.io/api${path}${path.includes("?") ? "&" : "?"}key=${RAWG}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const _personCache = new BoundedCache<number, PersonMeta | null>({ max: 2000 });
async function fetchPersonMeta(id: number): Promise<PersonMeta | null> {
  if (_personCache.has(id)) return _personCache.get(id)!;
  const d = await tmdbJson(`/person/${id}`);
  if (!d) { _personCache.set(id, null); return null; }
  const meta: PersonMeta = {
    name: d.name,
    biography: d.biography || null,
    birthday: d.birthday || null,
    deathday: d.deathday || null,
    age: ageFrom(d.birthday || null, d.deathday || null),
    placeOfBirth: d.place_of_birth || null,
    profileUrl: d.profile_path ? `https://image.tmdb.org/t/p/w300${d.profile_path}` : null,
    knownForDepartment: d.known_for_department || null,
    tmdbUrl: `https://www.themoviedb.org/person/${id}`,
  };
  _personCache.set(id, meta);
  return meta;
}

function tmdbCredit(c: any): ExtTitle {
  return {
    source: "tmdb", sourceId: String(c.id),
    type: (c.media_type === "tv" ? "show" : "movie") as MediaType,
    title: c.title || c.name || "Untitled",
    releaseDate: c.release_date || c.first_air_date || null,
    posterUrl: c.poster_path ? `https://image.tmdb.org/t/p/w500${c.poster_path}` : null,
    vote: typeof c.vote_average === "number" ? c.vote_average : null,
    votes: c.vote_count ?? 0,
  };
}
function rawgGame(g: any): ExtTitle {
  return {
    source: "rawg", sourceId: String(g.id), type: "game",
    title: g.name || "Untitled",
    releaseDate: g.released || null,
    posterUrl: g.background_image || null,
    vote: typeof g.rating === "number" && g.rating > 0 ? g.rating * 2 : null, // RAWG rating is 0-5
    votes: g.ratings_count ?? 0,
  };
}

// People: the full filmography for the clicked role.
function personTitles(role: string, credits: any): ExtTitle[] {
  const raw: any[] =
    role === "cast" ? (credits.cast ?? [])
    : role === "director" ? (credits.crew ?? []).filter((c: any) => c.job === "Director")
    : role === "writer" ? (credits.crew ?? []).filter((c: any) => WRITER_JOBS.has(c.job))
    : (credits.crew ?? []);
  const seen = new Set<string>();
  return raw
    .filter((c) => (c.media_type === "movie" || c.media_type === "tv") && c.id != null)
    .filter((c) => !(role === "cast" && /^(self|himself|herself|narrator)\b/i.test(String(c.character ?? ""))))
    .filter((c) => (c.vote_count ?? 0) > 0 || c.poster_path)
    .map(tmdbCredit)
    .filter((t) => { const k = `${t.type}:${t.sourceId}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Studios: TMDB titles by the company, blended across popularity + recency.
async function tmdbCompanyTitles(companyId: number): Promise<ExtTitle[]> {
  const reqs: { media: "movie" | "tv"; path: string }[] = [];
  for (const [media, recency] of [["movie", "primary_release_date.desc"], ["tv", "first_air_date.desc"]] as const) {
    for (const sort of ["popularity.desc", recency]) {
      for (const page of COMPANY_PAGES) {
        reqs.push({ media, path: `/discover/${media}?with_companies=${companyId}&sort_by=${sort}&vote_count.gte=10&include_adult=false&page=${page}` });
      }
    }
  }
  const batches = await Promise.all(reqs.map(async (r) => ({ media: r.media, d: await tmdbJson(r.path) })));
  const out: ExtTitle[] = [];
  const seen = new Set<string>();
  for (const { media, d } of batches) {
    for (const m of d?.results ?? []) {
      const t = tmdbCredit({ ...m, media_type: media });
      const k = `${t.type}:${t.sourceId}`;
      if (!seen.has(k)) { seen.add(k); out.push(t); }
    }
  }
  return out;
}

// Game devs/publishers: RAWG titles, blended across most-added + most-recent.
async function rawgEntityTitles(role: string, id: number): Promise<ExtTitle[]> {
  const param = role === "developer" ? "developers" : "publishers";
  const reqs: Promise<any>[] = [];
  for (const ordering of ["-added", "-released"]) {
    for (const page of COMPANY_PAGES) reqs.push(rawgJson(`/games?${param}=${id}&ordering=${ordering}&page_size=40&page=${page}`));
  }
  const out: ExtTitle[] = [];
  const seen = new Set<string>();
  for (const d of await Promise.all(reqs)) {
    for (const g of d?.results ?? []) {
      const sid = String(g.id);
      if (!seen.has(sid)) { seen.add(sid); out.push(rawgGame(g)); }
    }
  }
  return out;
}

// Tags: a popularity + recency sample from TMDB (genre or keyword) and RAWG
// (genre or tag). A genre/tag's full catalog is the whole platform, so we sample.
async function tagTitles(key: string): Promise<ExtTitle[]> {
  const out: ExtTitle[] = [];
  const seen = new Set<string>();
  const pushTmdb = (media: "movie" | "tv", results: any[] | undefined) => {
    for (const m of results ?? []) { const t = tmdbCredit({ ...m, media_type: media }); const k = `${t.type}:${t.sourceId}`; if (!seen.has(k)) { seen.add(k); out.push(t); } }
  };
  const pushRawg = (results: any[] | undefined) => {
    for (const g of results ?? []) { const k = `game:${g.id}`; if (!seen.has(k)) { seen.add(k); out.push(rawgGame(g)); } }
  };
  const reqs: Promise<void>[] = [];

  const movieGid = tmdbGenreId(key, "movie");
  const tvGid = tmdbGenreId(key, "show");
  if (movieGid != null || tvGid != null) {
    if (movieGid != null) for (const sort of ["popularity.desc", "primary_release_date.desc"]) for (const page of TAG_PAGES)
      reqs.push(tmdbJson(`/discover/movie?with_genres=${movieGid}&sort_by=${sort}&vote_count.gte=10&include_adult=false&page=${page}`).then((d) => pushTmdb("movie", d?.results)));
    if (tvGid != null) for (const sort of ["popularity.desc", "first_air_date.desc"]) for (const page of TAG_PAGES)
      reqs.push(tmdbJson(`/discover/tv?with_genres=${tvGid}&sort_by=${sort}&vote_count.gte=10&page=${page}`).then((d) => pushTmdb("tv", d?.results)));
  } else {
    const kwId = await resolveTmdbKeywordId(key);
    if (kwId) {
      for (const [media, recency] of [["movie", "primary_release_date.desc"], ["tv", "first_air_date.desc"]] as const) {
        for (const sort of ["popularity.desc", recency]) for (const page of TAG_PAGES)
          reqs.push(tmdbJson(`/discover/${media}?with_keywords=${kwId}&sort_by=${sort}&vote_count.gte=10&page=${page}`).then((d) => pushTmdb(media, d?.results)));
      }
    }
  }
  const gslug = rawgGenreSlug(key);
  const rawgParam = gslug ? `genres=${gslug}` : `tags=${rawgTagSlug(key)}`;
  for (const ordering of ["-added", "-released"]) for (const page of TAG_PAGES)
    reqs.push(rawgJson(`/games?${rawgParam}&ordering=${ordering}&page_size=20&page=${page}`).then((d) => pushRawg(d?.results)));

  await Promise.all(reqs);
  return out;
}

const _tmdbCompanyCache = new BoundedCache<string, number | null>({ max: 5000 });
async function resolveTmdbCompanyId(label: string): Promise<number | null> {
  const ck = label.toLowerCase();
  if (_tmdbCompanyCache.has(ck)) return _tmdbCompanyCache.get(ck)!;
  const d = await tmdbJson(`/search/company?query=${encodeURIComponent(label)}`);
  const results: any[] = d?.results ?? [];
  let id: number | null = null;
  if (results.length === 1) {
    id = results[0].id;
  } else if (results.length > 1) {
    // TMDB fragments studios across entities — pick the one with the largest catalog.
    const sized = await Promise.all(
      results.slice(0, 5).map(async (c) => ({ id: c.id as number, total: (await tmdbJson(`/discover/movie?with_companies=${c.id}&page=1`))?.total_results ?? 0 }))
    );
    sized.sort((a, b) => b.total - a.total);
    id = sized[0]?.total > 0 ? sized[0].id : (results.find((r) => (r.name ?? "").toLowerCase() === ck)?.id ?? results[0].id);
  }
  _tmdbCompanyCache.set(ck, id);
  return id;
}

function sortItems(items: FacetDetailItem[]) {
  items.sort((a, b) => {
    if ((a.rating != null) !== (b.rating != null)) return a.rating != null ? -1 : 1;
    if (a.rating != null && b.rating != null && a.rating !== b.rating) return b.rating - a.rating;
    return (b.communityScore ?? -1) - (a.communityScore ?? -1) || (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
  });
}

// ── Router ────────────────────────────────────────────────────────
export async function buildFacetDetail(userId: string, ref: FacetRefIn): Promise<FacetDetailPayload> {
  const catVectors = itemsWithFacet(ref);

  if (ref.kind === "person") {
    const id = resolvePersonTmdbId(ref.role ?? "cast", ref.key);
    if (id) {
      const [meta, credits] = await Promise.all([fetchPersonMeta(id), tmdbJson(`/person/${id}/combined_credits`)]);
      const ext = credits ? personTitles(ref.role ?? "cast", credits) : null;
      return assemble(userId, ref, meta, ext ? "filmography" : "catalog", catVectors, ext);
    }
    return assemble(userId, ref, null, "catalog", catVectors, null);
  }

  if (ref.kind === "company") {
    if (ref.role === "studio") {
      const cid = await resolveTmdbCompanyId(ref.label);
      const ext = cid != null ? await tmdbCompanyTitles(cid) : null;
      if (ext && ext.length) return assemble(userId, ref, null, "sample", catVectors, ext);
    } else if (ref.role === "developer" || ref.role === "publisher") {
      const rid = resolveRawgEntityId(ref.role, ref.key);
      const ext = rid != null ? await rawgEntityTitles(ref.role, rid) : null;
      if (ext && ext.length) return assemble(userId, ref, null, "sample", catVectors, ext);
    }
    return assemble(userId, ref, null, "catalog", catVectors, null); // network / failed
  }

  // tag
  const ext = await tagTitles(ref.key);
  return assemble(userId, ref, null, ext.length ? "sample" : "catalog", catVectors, ext.length ? ext : null);
}

// ── Merge the user's catalog (authoritative for YOUR avg) with the external
//    crowd set (authoritative for the CROWD avg + unseen discovery). ──────────
function assemble(
  userId: string, ref: FacetRefIn, person: PersonMeta | null, scope: FacetScope,
  catVectors: DiscoveryVector[], external: ExtTitle[] | null
): FacetDetailPayload {
  // State for every media id we touch (catalog + external titles that resolve locally).
  const extMap = external ? resolveMediaIdsBySource(external.map((t) => ({ source: t.source, sourceId: t.sourceId }))) : new Map<string, string>();
  const mediaIds = new Set<string>(catVectors.map((v) => v.id));
  for (const mid of extMap.values()) mediaIds.add(mid);
  const state = getUserStateMap(userId, [...mediaIds]);

  // Merged item map, keyed by media id when known (so a catalog item and its
  // external twin collapse into one), else by the external source id.
  const map = new Map<string, FacetDetailItem>();
  for (const v of catVectors) {
    const st = state.get(v.id);
    map.set(`mid:${v.id}`, {
      id: v.id, type: v.type, title: v.title, releaseDate: v.releaseDate, posterUrl: v.posterUrl,
      communityScore: v.communityScore,
      platformSources: st?.platformSources ?? [], onWatchlist: st?.onWatchlist ?? false,
      libraryStatus: st?.libraryStatus ?? null, rating: st?.rating ?? null, sources: v.sources,
    });
  }
  for (const t of external ?? []) {
    const mid = extMap.get(`${t.source}:${t.sourceId}`);
    const key = mid ? `mid:${mid}` : `${t.source}:${t.sourceId}`;
    const existing = map.get(key);
    if (existing) {
      if (existing.communityScore == null && t.vote != null) existing.communityScore = Math.round(t.vote * 10);
      continue;
    }
    const st = mid ? state.get(mid) : undefined;
    map.set(key, {
      id: mid ?? `${t.source}-${t.type}-${t.sourceId}`,
      type: t.type, title: t.title, releaseDate: t.releaseDate, posterUrl: t.posterUrl,
      communityScore: t.vote != null ? Math.round(t.vote * 10) : null,
      platformSources: st?.platformSources ?? [], onWatchlist: st?.onWatchlist ?? false,
      libraryStatus: st?.libraryStatus ?? null, rating: st?.rating ?? null,
      sources: [{ source: t.source, sourceId: t.sourceId }],
    });
  }
  const items = [...map.values()];
  sortItems(items);

  // YOUR average — over every title you rated (from the full merged set).
  const rated = items.filter((i) => i.rating != null);
  const userAvg = mean(rated.map((i) => i.rating as number));
  const catalogCommunityAvg = mean(rated.filter((i) => i.communityScore != null).map((i) => (i.communityScore as number) / 10));

  // CROWD average — over the broad external set (well-rated only), else catalog.
  let communityAvg: number | null;
  let crowdCount: number;
  if (external) {
    const minVotes = (t: ExtTitle) => (t.source === "rawg" ? 5 : 10);
    let pool = external.filter((t) => t.vote != null && t.votes >= minVotes(t));
    if (pool.length < 3) pool = external.filter((t) => t.vote != null && t.votes > 0);
    communityAvg = mean(pool.map((t) => t.vote as number));
    crowdCount = pool.length;
  } else {
    const pool = items.filter((i) => i.communityScore != null);
    communityAvg = mean(pool.map((i) => (i.communityScore as number) / 10));
    crowdCount = pool.length;
  }

  const baseline = getLibraryFacetAnalysis(userId).baseline;
  return {
    facet: ref,
    person,
    scope,
    stats: {
      userAvg: userAvg != null ? round1(userAvg) : null,
      userCount: rated.length,
      totalCount: items.length,
      crowdCount,
      communityAvg: communityAvg != null ? round1(communityAvg) : null,
      catalogCommunityAvg: catalogCommunityAvg != null ? round1(catalogCommunityAvg) : null,
      baseline: round1(baseline),
      delta: userAvg != null && communityAvg != null ? round1(userAvg - communityAvg) : null,
    },
    items: items.slice(0, MAX_ITEMS),
    shown: Math.min(items.length, MAX_ITEMS),
  };
}
