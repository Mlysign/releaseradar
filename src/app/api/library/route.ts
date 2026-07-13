import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { query, get } from "@/lib/db";
import { mergeLinks } from "@/lib/merge";
import { getUserCountry } from "@/lib/userCountry";
import { getUserStateMap, resolveMediaItemFromIds } from "@/lib/userState";
import { MediaLink, EnrichedItem, MediaType } from "@/types";
import { sourcesForType } from "@/lib/sources/registry";
import { upsertMediaItem, recordLibraryRating, clearLibrary } from "@/lib/matcher";
import { persistItemFromIds } from "@/lib/persistItem";
import { parseRatings, averageRating } from "@/lib/ratings";
import { parseJsonBody } from "@/lib/validate";
import { LibraryPostSchema, LibraryDeleteSchema } from "@/lib/schemas";

export const GET = withUser(async (req: NextRequest, session) => {
    const { searchParams } = req.nextUrl;
    const typeFilter = searchParams.get("type") as MediaType | null;

    let sql = `
      SELECT
        mi.id, mi.type, mi.title, mi.release_date, mi.poster_url,
        ul.platform_sources, ul.status, ul.rating, ul.review, ul.reviewed_at, ul.metadata,
        ml.source, ml.source_id, ml.raw_data, ml.release_date as link_release_date
      FROM user_library ul
      JOIN media_items mi ON mi.id = ul.media_item_id
      LEFT JOIN media_links ml ON ml.media_item_id = mi.id
      WHERE ul.user_id = ?
    `;
    const params: any[] = [session.userId];
    if (typeFilter) { sql += " AND mi.type = ?"; params.push(typeFilter); }

    const rows = query<any>(sql, params);

    // Group rows by media_item id
    const itemMap = new Map<string, { item: any; links: MediaLink[] }>();
    for (const row of rows) {
      if (!itemMap.has(row.id)) {
        itemMap.set(row.id, {
          item: {
            id: row.id,
            type: row.type,
            title: row.title,
            releaseDate: row.release_date,
            posterUrl: row.poster_url,
            platformSources: JSON.parse(row.platform_sources ?? "[]"),
            status: row.status,
            rating: row.rating,
            ratings: parseRatings(row.metadata),
            review: row.review,
            reviewedAt: row.reviewed_at,
          },
          links: [],
        });
      }
      if (row.source) {
        itemMap.get(row.id)!.links.push({
          id: "",
          mediaItemId: row.id,
          source: row.source,
          sourceId: row.source_id,
          title: null,
          releaseDate: row.link_release_date,
          rawData: JSON.parse(row.raw_data ?? "{}"),
          lastSynced: 0,
        });
      }
    }

    const country = getUserCountry(session.userId);
    const enriched: (EnrichedItem & { reviewedAt: number | null })[] = [];
    for (const { item, links } of itemMap.values()) {
      const merged = mergeLinks(links, item.type, country);
      // `releaseDate` is the real release date (from the merged links) so the
      // "release" sort actually sorts by release. When the user watched/played it
      // is carried separately as `reviewedAt`.
      enriched.push({
        id: item.id,
        type: item.type,
        platformSources: item.platformSources,
        ...merged,
        rating: averageRating(item.ratings) ?? item.rating,
        ratings: item.ratings,
        review: item.review,
        reviewedAt: item.reviewedAt,
        libraryStatus: item.status,
      });
    }

    // Canonical user-state: `platformSources` means WISHLIST providers
    // everywhere, so a library item also shows whether it's wishlisted (the
    // library's own source list stays reflected via libraryStatus/rating).
    const stateMap = getUserStateMap(session.userId, enriched.map((e) => e.id));
    for (const e of enriched) {
      e.platformSources = stateMap.get(e.id)?.platformSources ?? [];
    }

    // Newest watched first; items with no date sink to the bottom.
    enriched.sort((a, b) => {
      const da = a.reviewedAt ?? 0;
      const db = b.reviewedAt ?? 0;
      if (da !== db) return db - da;
      if (!a.releaseDate && !b.releaseDate) return 0;
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return b.releaseDate.localeCompare(a.releaseDate);
    });

    return NextResponse.json({ items: enriched });
});

// POST /api/library — rate an item and/or mark it as watched/played.
// Body: { mediaItemId, rating?, status? }                      — for items already in the DB
//   OR: { type, title?, releaseDate?, posterUrl?, ids, rating?, status? } — for a
//       discover/search item not yet persisted; it is created on the fly so it
//       can be rated without first adding it to a wishlist.
export const POST = withUser(async (req: NextRequest, session) => {
    const body = await parseJsonBody(req, LibraryPostSchema);
    const { rating, status } = body;

    // Resolve the media_item: use the given id, else create it from identity.
    let mediaItemId = body.mediaItemId ?? null;
    if (!mediaItemId) {
      if (!body.ids || !body.type) {
        return NextResponse.json({ error: "mediaItemId or item identity (type + ids) required" }, { status: 400 });
      }
      mediaItemId = await persistItemFromIds({
        type: body.type, title: body.title, releaseDate: body.releaseDate, posterUrl: body.posterUrl, ids: body.ids,
      });
      if (!mediaItemId) return NextResponse.json({ error: "Could not resolve item" }, { status: 400 });
    }

    const mediaItem = get<{ type: string; title: string; release_date: string | null }>(
      "SELECT type, title, release_date FROM media_items WHERE id = ?",
      [mediaItemId]
    );
    if (!mediaItem) return NextResponse.json({ error: "Item not found" }, { status: 404 });

    const itemType = mediaItem.type;

    const inferredStatus: string | null =
      status !== undefined ? (status ?? null)
      : rating != null ? (itemType === "game" ? "played" : "watched")
      : null;

    const platformErrors: string[] = [];
    const links = query<{ source: string; source_id: string }>(
      "SELECT source, source_id FROM media_links WHERE media_item_id = ?",
      [mediaItemId]
    );

    // ── Write-back to EVERY connected, writable provider ─────────────
    // Rating/marking-watched should propagate to all connected platforms, not
    // just the ones already linked. So we iterate every writable provider for
    // this type and resolve its own id from the item's cross-reference links
    // (e.g. a TMDB-sourced movie resolves its Trakt id via TMDB), persist the
    // resolved link, then push. pushRating also marks the item consumed.
    const crossIds: Record<string, string> = {};
    for (const l of links) crossIds[l.source] = l.source_id;
    const year = mediaItem.release_date ? parseInt(String(mediaItem.release_date).slice(0, 4)) : undefined;
    // Platforms a rating was actually pushed to — used to record the per-platform value.
    const ratedSources: string[] = [];

    for (const src of sourcesForType(itemType)) {
      if (!src.capabilities.rating.write && !src.capabilities.status.write) continue;
      try {
        const ctx = await src.context(session.userId);
        if (!ctx?.token) continue;
        let sourceId = src.resolveSourceId
          ? await src.resolveSourceId(ctx, itemType as MediaType, crossIds, { title: mediaItem.title, year })
          : (crossIds[src.id] != null ? String(crossIds[src.id]) : null);
        // `crossIds` only covers linked sources (media_links); a Trakt-only item
        // has no tmdb link, so TMDB's resolveSourceId returns null and the rating
        // write-back was silently skipped. Fall back to the cross-source ids
        // captured at merge time (media_external_ids).
        if (!sourceId) {
          const ext = get<{ external_id: string }>(
            "SELECT external_id FROM media_external_ids WHERE media_item_id = ? AND source = ? LIMIT 1",
            [mediaItemId, src.id]
          );
          if (ext?.external_id) sourceId = ext.external_id;
        }
        if (!sourceId) continue;
        // Persist a newly-resolved cross-ref link (e.g. Trakt id found via TMDB)
        // so subsequent reads/writes find it directly.
        if (crossIds[src.id] == null) {
          upsertMediaItem({
            source: src.id, sourceId, type: itemType as MediaType,
            title: mediaItem.title, releaseDate: mediaItem.release_date ?? null,
            rawData: { title: mediaItem.title, ids: { ...crossIds, [src.id]: sourceId } },
          });
        }
        if (rating != null && src.capabilities.rating.write && src.pushRating) {
          await src.pushRating(ctx, sourceId, itemType as MediaType, rating);
          ratedSources.push(src.id);
        } else if (rating === null && src.capabilities.rating.write && src.clearRating) {
          // User removed their score but kept the item watched → clear the
          // rating on the platform only (don't touch watched history).
          await src.clearRating(ctx, sourceId, itemType as MediaType);
        } else if (inferredStatus && src.capabilities.status.write && src.pushStatus) {
          await src.pushStatus(ctx, sourceId, itemType as MediaType, inferredStatus);
        }
      } catch (e: any) {
        platformErrors.push(`${src.id}: ${e.message}`);
      }
    }

    // ── Record into user_item_state (truth); caches rebuilt by the helper ──────
    // Per-source rating lives in user_item_state keyed by the platforms it was
    // pushed to; the canonical user_library.rating is the AVERAGE across them.
    const nowSec = Math.floor(Date.now() / 1000);
    const { rating: canonicalRating, metadata } = recordLibraryRating(session.userId, mediaItemId, {
      rating,                       // undefined = status-only · null = clear · number = set
      status: inferredStatus,
      sources: ratedSources,
      reviewedAt: nowSec,
    });

    return NextResponse.json({
      ok: true,
      mediaItemId,
      rating: canonicalRating,
      ratings: parseRatings(JSON.stringify(metadata)),
      ...(platformErrors.length > 0 && { warnings: platformErrors }),
    });
});

// Remove an item from the library (clears status + rating). Used by the card
// "watched" toggle when turning it off. Body: { mediaItemId }.
export const DELETE = withUser(async (req: NextRequest, session) => {
  const body = await parseJsonBody(req, LibraryDeleteSchema, { allowEmpty: true });
  // Prefer the explicit UUID; fall back to resolving it from source ids (a card
  // that never carried the local UUID). Nothing resolvable → nothing to remove.
  const mediaItemId: string | null = body.mediaItemId ?? resolveMediaItemFromIds(body.ids);
  if (!mediaItemId) return NextResponse.json({ ok: true });

  // Propagate the removal to every connected platform BEFORE clearing locally.
  // Otherwise the rating/watched state lingers on Trakt/TMDB and the next sync
  // re-pulls it (the reported bug). Mirrors the POST write-back's id resolution:
  // media_links cross-ids + the media_external_ids fallback for cross-referenced
  // items (e.g. a Trakt-only item resolving its tmdb id).
  const mediaItem = get<{ type: string; title: string; release_date: string | null }>(
    "SELECT type, title, release_date FROM media_items WHERE id = ?",
    [mediaItemId]
  );
  if (mediaItem) {
    const itemType = mediaItem.type as MediaType;
    const links = query<{ source: string; source_id: string }>(
      "SELECT source, source_id FROM media_links WHERE media_item_id = ?",
      [mediaItemId]
    );
    const crossIds: Record<string, string> = {};
    for (const l of links) crossIds[l.source] = l.source_id;
    const year = mediaItem.release_date ? parseInt(String(mediaItem.release_date).slice(0, 4)) : undefined;
    for (const src of sourcesForType(itemType)) {
      if (!src.removeFromLibrary || (!src.capabilities.rating.write && !src.capabilities.status.write)) continue;
      try {
        const ctx = await src.context(session.userId);
        if (!ctx?.token) continue;
        let sourceId = src.resolveSourceId
          ? await src.resolveSourceId(ctx, itemType, crossIds, { title: mediaItem.title, year })
          : (crossIds[src.id] != null ? String(crossIds[src.id]) : null);
        if (!sourceId) {
          const ext = get<{ external_id: string }>(
            "SELECT external_id FROM media_external_ids WHERE media_item_id = ? AND source = ? LIMIT 1",
            [mediaItemId, src.id]
          );
          if (ext?.external_id) sourceId = ext.external_id;
        }
        if (!sourceId) continue;
        await src.removeFromLibrary(ctx, sourceId, itemType);
        console.log(`[library] Removed from ${src.id}: ${sourceId}`);
      } catch (e) {
        console.error(`[library] ${src.id} remove-from-library failed:`, e);
      }
    }
  }

  clearLibrary(session.userId, mediaItemId);
  return NextResponse.json({ ok: true });
});
