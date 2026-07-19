import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { get } from "@/lib/db";
import { mergeLinks, explainMerge } from "@/lib/merge";
import { getUserCountry } from "@/lib/userCountry";
import { extractFacets } from "@/lib/facets";
import { buildProfile, computeFandexScore, MIN_RATED_FOR_FANDEX_SCORE } from "@/lib/discovery";
import { MediaLink, EnrichedItem, Source, MediaType } from "@/types";
import { parseRatings, averageRating } from "@/lib/ratings";
import { getPlatformStatus } from "@/lib/watchlistStatus";
// The catalog-enrichment half lives in lib/detail/enrich.ts, shared with the
// PUBLIC page (/{type}/{uuid}/{slug}) so the two can't drift apart — the public
// page previously had its own thinner path and silently rendered far less. What
// stays HERE is the per-user overlay (wishlist/library/rating), which must never
// move down into the shared module.
import {
  UUID_RE, SourceIds, readSourceIds, resolveBySourceIds, loadLinks,
  buildLiveLinks, ensureTmdbDetail, ensureGameDetail, enrichMissingSources,
  applyOmdbScores,
} from "@/lib/detail/enrich";

// ── Canonical detail resolver ─────────────────────────────────────────────────
// One flow for every entry point (dashboard / library / discover). Given any item
// identity it always returns the SAME shape: live-enriched metadata + wishlist
// status across providers + library (watched/played + rating). This is the single
// mechanic that gathers everything the detail panel needs.
export const GET = withUser(async (req: NextRequest, session) => {
    const { searchParams } = req.nextUrl;

    const id = searchParams.get("id");
    const type = searchParams.get("type") as MediaType | null;
    const title = searchParams.get("title");
    const sourceIds = readSourceIds(searchParams);
    const debugMode = searchParams.get("debug") === "1";

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    // 1. Resolve the canonical media_item — by UUID, else by any provided source id.
    let mediaItemId: string | null = UUID_RE.test(id) ? id : resolveBySourceIds(type, sourceIds);

    const item = mediaItemId ? get<any>("SELECT * FROM media_items WHERE id = ?", [mediaItemId]) : null;
    if (mediaItemId && !item) mediaItemId = null; // stale id → treat as live-only

    const resolvedVia: "uuid" | "source-id" | "live" = item ? (UUID_RE.test(id) ? "uuid" : "source-id") : "live";
    const itemType: MediaType = (item?.type ?? type ?? "game") as MediaType;

    // 2. Build the source links — from DB when stored, else live from the sources.
    let links: MediaLink[];
    if (item) {
      links = loadLinks(mediaItemId!);
    } else {
      links = await buildLiveLinks(id, itemType, title, sourceIds);
    }
    const dbSources = new Set(item ? links.map((l) => l.source) : []);

    // Older stored items predate the richer payloads — refresh their stored
    // links in-memory so the new fields are always available.
    const tmdbRefreshed = await ensureTmdbDetail(links, itemType);
    await ensureGameDetail(links, itemType);

    // 3. Live-enrich any missing sources (always checks the other online DBs).
    const hasSources = new Set(links.map((l) => l.source));
    const enrichment = await enrichMissingSources(itemType, item?.title ?? title ?? "", mediaItemId ?? id, links, hasSources);

    if (links.length === 0 && !item) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // 4. Merge canonical metadata (region-aware release date + streaming, T22).
    const merged = mergeLinks(links, itemType, getUserCountry(session.userId));

    // H5.3 — the Fandex Score + its breakdown. Works for a live (not-yet-persisted)
    // item too: extractFacets only needs links/type/merged, not a mediaItemId.
    const fandexProfile = buildProfile(session.userId);
    const fandex = computeFandexScore(extractFacets(links, itemType, merged), fandexProfile);
    const fandexColdStart = fandexProfile.ratedItemCount < MIN_RATED_FOR_FANDEX_SCORE;

    // 5. Attach the user's wishlist + library state (empty when not in DB).
    const watchlistRow = mediaItemId
      ? get<{ platform_sources: string }>(
          "SELECT platform_sources FROM user_watchlist WHERE media_item_id = ? AND user_id = ?",
          [mediaItemId, session.userId]
        )
      : null;
    const libraryRow = mediaItemId
      ? get<any>(
          "SELECT platform_sources, status, rating, review, reviewed_at, metadata FROM user_library WHERE media_item_id = ? AND user_id = ?",
          [mediaItemId, session.userId]
        )
      : null;

    const platformSources: Source[] = Array.from(new Set<Source>([
      ...JSON.parse(watchlistRow?.platform_sources ?? "[]"),
      ...JSON.parse(libraryRow?.platform_sources ?? "[]"),
    ]));

    const enriched: EnrichedItem = {
      id: mediaItemId ?? id,
      type: itemType,
      platformSources,
      ...merged,
      ...(libraryRow ? (() => {
        const r = parseRatings(libraryRow.metadata);
        return {
          rating: averageRating(r) ?? libraryRow.rating,
          ratings: r,
          review: libraryRow.review,
          reviewedAt: libraryRow.reviewed_at,
          libraryStatus: libraryRow.status,
        };
      })() : {}),
      fandexScore: fandex?.score ?? null,
    };
    await applyOmdbScores(enriched);

    // 6. Provider wishlist status (shared helper — same shape everywhere).
    const { platforms, onAnyList } = getPlatformStatus(session.userId, mediaItemId, itemType);

    // 7. Debug payload (only when ?debug=1): merge provenance for the debug panel.
    const debug = debugMode
      ? {
          resolvedVia,
          mediaItemId,
          links: links.map((l) => ({
            source: l.source,
            sourceId: l.sourceId,
            origin: dbSources.has(l.source) ? "db" : hasSources.has(l.source) ? "live-id" : "live-search",
            title: l.title,
            releaseDate: l.releaseDate,
            lastSynced: l.lastSynced,
            rawBytes: JSON.stringify(l.rawData).length,
            ...(l.source === "tmdb" && tmdbRefreshed ? { tmdbRefreshed: true } : {}),
          })),
          enrichment,
          matrix: explainMerge(links, itemType),
        }
      : undefined;

    return NextResponse.json({
      item: enriched,
      platforms,
      resolvedMediaItemId: mediaItemId,
      onAnyList,
      fandexReasons: fandex?.reasons ?? [],
      fandexCenter: fandex?.center ?? null,
      fandexColdStart,
      ...(debug ? { debug } : {}),
    });
});
