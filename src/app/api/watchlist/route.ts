import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { get, run, query } from "@/lib/db";
import { upsertMediaItem, upsertWatchlistEntry, removeWatchlistSource } from "@/lib/matcher";
import { persistItemFromIds } from "@/lib/persistItem";
import { resolveMediaItemFromIds } from "@/lib/userState";
import { sanitizePosterUrl } from "@/lib/posterUrl";
import { parseJsonBody } from "@/lib/validate";
import { WatchlistPostSchema, WatchlistDeleteSchema } from "@/lib/schemas";
import { SOURCES, sourcesForType } from "@/lib/sources/registry";
import { MediaType, Source } from "@/types";

export const POST = withUser(async (req: NextRequest, session) => {
    const { type, title, releaseDate, posterUrl, ids, targetProvider } =
      await parseJsonBody(req, WatchlistPostSchema);

    // S12: only persist/reflect a poster URL from a trusted media-CDN host.
    const safePosterUrl = sanitizePosterUrl(posterUrl);

    // Fetch + store the canonical media_item from the provided source ids.
    const mediaItemId = await persistItemFromIds({ type, title, releaseDate, posterUrl: safePosterUrl, ids });
    if (!mediaItemId) return NextResponse.json({ error: "Could not resolve item" }, { status: 400 });

    // Mark all found sources in watchlist
    const sources = Object.keys(ids).filter((k) => ids[k]);
    for (const source of sources) {
      upsertWatchlistEntry(session.userId, mediaItemId, source as any);
    }

    // ── Platform write-backs via the MediaSource registry ───────────
    // For each writable provider that handles this type, resolve the provider's
    // own id (natively or by cross-referencing TMDB), persist the resolved link
    // so status/remove can find it, then push to the platform. `targetProvider`
    // (if set) narrows the write-back to a single provider.
    const shouldWriteTo = (p: string) => !targetProvider || targetProvider === p;
    const year = releaseDate ? parseInt(String(releaseDate).slice(0, 4)) : undefined;

    for (const src of sourcesForType(type)) {
      if (!src.capabilities.wishlist.write || !shouldWriteTo(src.id)) continue;
      try {
        const ctx = await src.context(session.userId);
        if (!ctx?.token) continue;
        let sourceId = src.resolveSourceId
          ? await src.resolveSourceId(ctx, type, ids, { title, year })
          : (ids[src.id] != null ? String(ids[src.id]) : null);
        // The client payload often lacks a provider's own id — e.g. adding a
        // Trakt title sends only its trakt id, so TMDB's resolveSourceId (which
        // reads ids.tmdb) returns null and the write-back was silently skipped.
        // We captured cross-source ids at merge time (extractCrossIds →
        // media_external_ids), so resolve the provider's id from there.
        if (!sourceId) {
          const ext = get<{ external_id: string }>(
            "SELECT external_id FROM media_external_ids WHERE media_item_id = ? AND source = ? LIMIT 1",
            [mediaItemId, src.id]
          );
          if (ext?.external_id) sourceId = ext.external_id;
        }
        if (!sourceId) continue;
        // Persist the resolved link (esp. when resolved via TMDB) so the item's
        // status and later removal can find this provider.
        if (ids[src.id] == null) {
          upsertMediaItem({
            source: src.id, sourceId, type,
            title: title ?? "", releaseDate: releaseDate ?? null,
            rawData: { title, ids: { ...ids, [src.id]: sourceId } },
          });
        }
        await src.pushWishlist!(ctx, sourceId, type, true);
        upsertWatchlistEntry(session.userId, mediaItemId, src.id);
        console.log(`[watchlist] Added to ${src.id}: ${sourceId}`);
      } catch (e) { console.error(`[watchlist] ${src.id} write-back failed:`, e); }
    }

    return NextResponse.json({ ok: true, mediaItemId });
});

export const DELETE = withUser(async (req: NextRequest, session) => {
    const body = await parseJsonBody(req, WatchlistDeleteSchema, { allowEmpty: true });
    const source = body.source;
    // Prefer the explicit UUID; fall back to resolving it from source ids (a card
    // that never carried the local UUID). Nothing resolvable → nothing to remove.
    const mediaItemId: string | null = body.mediaItemId ?? resolveMediaItemFromIds(body.ids);
    if (!mediaItemId) return NextResponse.json({ ok: true });

    // S7: scope the whole operation to the caller's own data. The platform
    // write-back loop below acts on every link of `mediaItemId` using the
    // caller's tokens — only proceed if this item is actually on THIS user's
    // watchlist. Otherwise a caller could drive removals for items they never
    // added. Not-on-your-watchlist → no-op (idempotent success).
    const owned = get<{ n: number }>(
      "SELECT 1 AS n FROM user_watchlist WHERE user_id = ? AND media_item_id = ? LIMIT 1",
      [session.userId, mediaItemId]
    );
    if (!owned) return NextResponse.json({ ok: true });

    const mediaItem = get<{ type: string }>("SELECT type FROM media_items WHERE id = ?", [mediaItemId]);
    const itemType = (mediaItem?.type ?? null) as MediaType | null;

    // ── Platform write-back removal via the MediaSource registry ──
    // For each linked, writable provider (optionally narrowed to `source`),
    // remove the item from that platform's wishlist through its adapter.
    const links = query<{ source: string; source_id: string }>(
      "SELECT source, source_id FROM media_links WHERE media_item_id = ?",
      [mediaItemId]
    );
    for (const link of links) {
      if (source && source !== link.source) continue;
      const src = SOURCES[link.source as Source];
      if (!src || !src.capabilities.wishlist.write) continue;
      try {
        const ctx = await src.context(session.userId);
        if (!ctx?.token) continue;
        await src.pushWishlist!(ctx, link.source_id, (itemType ?? src.mediaTypes[0]), false);
        console.log(`[watchlist] Removed from ${link.source}: ${link.source_id}`);
      } catch (e) { console.error(`[watchlist] ${link.source} remove failed:`, e); }
    }

    // ── Local DB removal ──────────────────────────────────────────
    if (source) {
      removeWatchlistSource(session.userId, mediaItemId, source as any);
    } else {
      run("DELETE FROM user_watchlist WHERE user_id = ? AND media_item_id = ?", [session.userId, mediaItemId]);
    }

    return NextResponse.json({ ok: true });
});
