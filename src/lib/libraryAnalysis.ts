// Library analysis — aggregates the user's rated library into per-facet stats
// (count / sum / avg) plus a flat per-item list, the user's rating baseline, and
// type/status breakdowns. Powers both the Insights page and the Taste Match
// preference model. Generalizes the old tag-only `analyzeLibraryTags`.

import { query, get } from "@/lib/db";
import { BoundedCache } from "@/lib/boundedCache";
import { mergeLinks } from "@/lib/merge";
import { parseRatings, averageRating, representativeCommunity } from "@/lib/ratings";
import { extractFacets, facetId, FacetKind, FacetRole } from "@/lib/facets";
import { MediaLink, MediaType } from "@/types";

// One aggregated facet (tag / person / company) across the rated library.
export interface FacetStat {
  kind: FacetKind;
  role?: FacetRole;
  key: string;
  label: string;
  category?: string; // tags only
  count: number;     // # rated items carrying this facet
  sum: number;       // Σ of those items' personal ratings
  avg: number;       // sum / count — the "well received" score (0-10)
}

// A rated library item, flattened for the overview / histogram / divergence /
// by-era stats. `community` is the normalized 0-100 representative crowd score.
export interface RatedItem {
  id: string;
  type: MediaType;
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
  rating: number;
  community: number | null;
  sources: { source: string; sourceId: string }[]; // for buildItemHref on the few items sent to the client
}

export interface LibraryFacetAnalysis {
  facets: FacetStat[];         // sorted by avg desc, then count desc
  items: RatedItem[];          // rated items only
  baseline: number;            // mean personal rating across rated items
  ratedItemCount: number;
  libraryItemCount: number;    // all library rows (rated or not)
  libraryIds: string[];        // all library item ids — for membership filters
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  ratingValues: number[];      // every personal rating (for histogram/median)
}

interface ItemRow {
  id: string;
  type: MediaType;
  title: string;
  release_date: string | null;
  poster_url: string | null;
  rating: number | null;
  metadata: string | null;
  status: string | null;
  source: string | null;
  source_id: string | null;
  raw_data: string | null;
  link_release_date: string | null;
}

// Personal 0-10 score: average across platforms, falling back to the canonical
// column. null when unrated.
function personalRating(rating: number | null, metadata: string | null): number | null {
  return averageRating(parseRatings(metadata)) ?? rating;
}

export function analyzeLibraryFacets(userId: string): LibraryFacetAnalysis {
  const rows = query<ItemRow>(
    `SELECT mi.id, mi.type, mi.title, mi.release_date, mi.poster_url,
            ul.rating, ul.metadata, ul.status,
            ml.source, ml.source_id, ml.raw_data, ml.release_date as link_release_date
     FROM user_library ul
     JOIN media_items mi ON mi.id = ul.media_item_id
     LEFT JOIN media_links ml ON ml.media_item_id = mi.id
     WHERE ul.user_id = ?`,
    [userId]
  );

  // Collapse (item ⋈ links) into one entry per media item.
  const groups = new Map<string, { item: ItemRow; links: MediaLink[] }>();
  for (const r of rows) {
    if (!groups.has(r.id)) groups.set(r.id, { item: r, links: [] });
    if (r.source) {
      groups.get(r.id)!.links.push({
        id: "", mediaItemId: r.id, source: r.source as MediaLink["source"],
        sourceId: r.source_id!, title: null, releaseDate: r.link_release_date,
        rawData: JSON.parse(r.raw_data ?? "{}"), lastSynced: 0,
      });
    }
  }

  const statMap = new Map<string, FacetStat>();
  const items: RatedItem[] = [];
  const libraryIds: string[] = [];
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const ratingValues: number[] = [];
  let ratingSum = 0;

  for (const { item, links } of groups.values()) {
    libraryIds.push(item.id);
    const rating = personalRating(item.rating, item.metadata);
    if (rating == null) continue; // unrated → no weight

    ratingSum += rating;
    ratingValues.push(rating);
    byType[item.type] = (byType[item.type] ?? 0) + 1;
    if (item.status) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;

    const merged = mergeLinks(links, item.type);
    items.push({
      id: item.id,
      type: item.type,
      title: item.title ?? merged.title,
      posterUrl: item.poster_url ?? merged.posterUrl,
      releaseDate: item.release_date ?? merged.releaseDate,
      rating,
      community: representativeCommunity(merged.communityRatings),
      sources: links.map((l) => ({ source: l.source, sourceId: l.sourceId })),
    });

    for (const f of extractFacets(links, item.type, merged)) {
      const id = `${f.kind}|${f.role ?? ""}|${f.key}`;
      const st = statMap.get(id);
      if (st) {
        st.count++;
        st.sum += rating;
      } else {
        statMap.set(id, {
          kind: f.kind, role: f.role, key: f.key, label: f.label,
          category: f.category, count: 1, sum: rating, avg: 0,
        });
      }
    }
  }

  const facets = [...statMap.values()].map((s) => ({
    ...s,
    avg: Math.round((s.sum / s.count) * 10) / 10,
  }));
  facets.sort((a, b) => b.avg - a.avg || b.count - a.count);

  const ratedItemCount = ratingValues.length;
  const baseline = ratedItemCount ? ratingSum / ratedItemCount : 0;

  return {
    facets, items, baseline, ratedItemCount,
    libraryItemCount: libraryIds.length, libraryIds, byType, byStatus, ratingValues,
  };
}

// ── Cache (the analysis is identical until the library changes) ────

// Per-user; sig-invalidated on read. Size-capped so it can't grow unbounded
// across many users on the single long-lived process (P2).
const _cache = new BoundedCache<string, { sig: string; data: LibraryFacetAnalysis }>({ max: 500 });

export function librarySignature(userId: string): string {
  // D6: COUNT/MAX(reviewed_at)/SUM(rating) alone miss two offsetting edits
  // (7→8 and 8→7 leave all three unchanged). A rowid-weighted rating sum is
  // order-sensitive, so swapping two items' ratings changes the signature.
  const r = get<{ n: number; mx: number; sm: number; wsm: number }>(
    `SELECT COUNT(*) n, COALESCE(MAX(reviewed_at),0) mx, COALESCE(SUM(rating),0) sm,
            COALESCE(SUM(rating * rowid),0) wsm
     FROM user_library WHERE user_id = ?`,
    [userId]
  );
  // D9: the facets come from the underlying media_links' raw_data, but an
  // enrich/backfill rewrites raw_data + bumps last_synced WITHOUT touching
  // user_library — so a user_library-only signature would serve stale (pre-enrich)
  // facets. Fold in the linked rows' count + MAX(last_synced) so any re-sync of a
  // library item's links invalidates the cache.
  const l = get<{ lc: number; lmx: number }>(
    `SELECT COUNT(*) lc, COALESCE(MAX(ml.last_synced),0) lmx
       FROM user_library ul JOIN media_links ml ON ml.media_item_id = ul.media_item_id
      WHERE ul.user_id = ?`,
    [userId]
  );
  return `${r?.n ?? 0}:${r?.mx ?? 0}:${r?.sm ?? 0}:${r?.wsm ?? 0}:${l?.lc ?? 0}:${l?.lmx ?? 0}`;
}

export function getLibraryFacetAnalysis(userId: string): LibraryFacetAnalysis {
  const sig = librarySignature(userId);
  const cached = _cache.get(userId);
  if (cached && cached.sig === sig) return cached.data;
  const data = analyzeLibraryFacets(userId);
  _cache.set(userId, { sig, data });
  return data;
}

// ── Membership signal (for the personalized live discover feed) ────
// Unlike analyzeLibraryFacets (which only weighs RATED items), this counts every
// facet carried by the user's library + wishlist regardless of rating — so a
// stuffed wishlist with zero ratings still yields a taste signal (cold-start),
// and an unrated-but-owned genre still nudges recommendations. Also collects an
// original-language histogram (the most direct lever against an irrelevant
// foreign-language flood) without making language a hard filter.

export interface MembershipFacet {
  kind: FacetKind; role?: FacetRole; key: string; label: string; category?: string;
  libCount: number;  // # library items carrying this facet (rated or not)
  wishCount: number; // # wishlist items carrying this facet
}

export interface MembershipSignal {
  facets: Map<string, MembershipFacet>;  // keyed by facetId
  languages: Map<string, number>;        // original_language → weighted count (wishlist counts double)
  libCount: number;                      // total library items seen
  wishCount: number;                     // total wishlist items seen
}

interface MemberRow {
  id: string; type: MediaType;
  source: string | null; raw_data: string | null;
  link_release_date: string | null; source_id: string | null;
}

// One (item ⋈ links) load for a membership table, grouped per media item.
function loadMembershipGroups(userId: string, table: "user_library" | "user_watchlist") {
  const rows = query<MemberRow>(
    `SELECT mi.id, mi.type, ml.source, ml.source_id, ml.raw_data, ml.release_date as link_release_date
       FROM ${table} ut
       JOIN media_items mi ON mi.id = ut.media_item_id
       LEFT JOIN media_links ml ON ml.media_item_id = mi.id
      WHERE ut.user_id = ?`,
    [userId]
  );
  const groups = new Map<string, { type: MediaType; links: MediaLink[] }>();
  for (const r of rows) {
    if (!groups.has(r.id)) groups.set(r.id, { type: r.type, links: [] });
    if (r.source) {
      groups.get(r.id)!.links.push({
        id: "", mediaItemId: r.id, source: r.source as MediaLink["source"],
        sourceId: r.source_id!, title: null, releaseDate: r.link_release_date,
        rawData: JSON.parse(r.raw_data ?? "{}"), lastSynced: 0,
      });
    }
  }
  return groups;
}

function membershipSignature(userId: string): string {
  const lib = get<{ n: number }>(`SELECT COUNT(*) n FROM user_library WHERE user_id = ?`, [userId]);
  const wl = get<{ n: number }>(`SELECT COUNT(*) n FROM user_watchlist WHERE user_id = ?`, [userId]);
  // Fold in the membership items' link freshness so an enrich/re-sync (which
  // rewrites raw_data without touching membership rows) invalidates the cache —
  // same rationale as librarySignature's D9 term.
  const l = get<{ lmx: number }>(
    `SELECT COALESCE(MAX(ml.last_synced),0) lmx FROM media_links ml
      WHERE ml.media_item_id IN (
        SELECT media_item_id FROM user_library  WHERE user_id = ?
        UNION
        SELECT media_item_id FROM user_watchlist WHERE user_id = ?
      )`,
    [userId, userId]
  );
  return `${lib?.n ?? 0}:${wl?.n ?? 0}:${l?.lmx ?? 0}`;
}

const _memberCache = new Map<string, { sig: string; data: MembershipSignal }>();

export function getMembershipSignal(userId: string): MembershipSignal {
  const sig = membershipSignature(userId);
  const cached = _memberCache.get(userId);
  if (cached && cached.sig === sig) return cached.data;

  const facets = new Map<string, MembershipFacet>();
  const languages = new Map<string, number>();

  const tally = (
    groups: Map<string, { type: MediaType; links: MediaLink[] }>,
    bucket: "libCount" | "wishCount",
    langWeight: number
  ): number => {
    let count = 0;
    for (const { type, links } of groups.values()) {
      count++;
      const merged = mergeLinks(links, type);
      for (const f of extractFacets(links, type, merged)) {
        const id = facetId(f);
        const ex = facets.get(id);
        if (ex) ex[bucket]++;
        else facets.set(id, { kind: f.kind, role: f.role, key: f.key, label: f.label, category: f.category, libCount: 0, wishCount: 0, [bucket]: 1 } as MembershipFacet);
      }
      // Original language (movies/shows only) from the TMDB blob.
      const tmdb = links.find((l) => l.source === "tmdb")?.rawData;
      const lang = tmdb?.original_language;
      if (typeof lang === "string" && lang) languages.set(lang, (languages.get(lang) ?? 0) + langWeight);
    }
    return count;
  };

  const libCount = tally(loadMembershipGroups(userId, "user_library"), "libCount", 1);
  // Wishlist = forward-looking intent → its language preference counts double.
  const wishCount = tally(loadMembershipGroups(userId, "user_watchlist"), "wishCount", 2);

  const data: MembershipSignal = { facets, languages, libCount, wishCount };
  _memberCache.set(userId, { sig, data });
  return data;
}
