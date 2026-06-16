import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { get, run, query } from "@/lib/db";
import { upsertMediaItem, upsertWatchlistEntry, removeWatchlistSource } from "@/lib/matcher";
import { persistItemFromIds } from "@/lib/persistItem";
import { SOURCES, sourcesForType } from "@/lib/sources/registry";
import { MediaType, Source } from "@/types";

export const POST = withUser(async (req: NextRequest, session) => {
    const body = await req.json();
    const { type, title, releaseDate, posterUrl, ids, targetProvider } = body;

    if (!ids || !type) return NextResponse.json({ error: "ids and type required" }, { status: 400 });

    // Fetch + store the canonical media_item from the provided source ids.
    const mediaItemId = await persistItemFromIds({ type, title, releaseDate, posterUrl, ids });
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
        const sourceId = src.resolveSourceId
          ? await src.resolveSourceId(ctx, type, ids, { title, year })
          : (ids[src.id] != null ? String(ids[src.id]) : null);
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
    const { mediaItemId, source } = await req.json();

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
