import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { get, query } from "@/lib/db";
import { getPlatformStatus } from "@/lib/watchlistStatus";
import { refreshItemFromProviders, ItemIds } from "@/lib/refreshItem";
import { parseRatings, averageRating } from "@/lib/ratings";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-item live refresh: re-check this one item against the user's connected
// providers, update local DB, and return the fresh wishlist + library state.
// Metadata is unchanged, so this returns only the user-state delta.
export const POST = withUser(async (req: NextRequest, session) => {
    const sp = req.nextUrl.searchParams;

    const id = sp.get("id");
    const type = sp.get("type");
    if (!id || !type) return NextResponse.json({ error: "id and type required" }, { status: 400 });

    const ids: ItemIds = {
      tmdb:       sp.get("tmdbId"),
      trakt:      sp.get("traktId"),
      letterboxd: sp.get("letterboxdId"),
      rawg:       sp.get("rawgId"),
      steam:      sp.get("steamId"),
    };

    // Resolve the canonical item (UUID or any source id) and backfill ids from
    // its stored links so every provider can be matched.
    let mediaItemId: string | null = UUID_RE.test(id) ? id : resolveBySourceIds(ids);
    if (mediaItemId) {
      const links = query<{ source: string; source_id: string }>(
        "SELECT source, source_id FROM media_links WHERE media_item_id = ?",
        [mediaItemId]
      );
      for (const l of links) {
        if      (l.source === "tmdb"       && !ids.tmdb)       ids.tmdb = l.source_id;
        else if (l.source === "trakt"      && !ids.trakt)      ids.trakt = l.source_id;
        else if (l.source === "letterboxd" && !ids.letterboxd) ids.letterboxd = l.source_id;
        else if (l.source === "rawg"       && !ids.rawg)       ids.rawg = l.source_id;
        else if (l.source === "steam"      && !ids.steam)      ids.steam = l.source_id;
      }
    }

    mediaItemId = await refreshItemFromProviders(session.userId, type, ids, mediaItemId);

    const libraryRow = mediaItemId
      ? get<any>(
          "SELECT status, rating, review, reviewed_at, metadata FROM user_library WHERE media_item_id = ? AND user_id = ?",
          [mediaItemId, session.userId]
        )
      : null;

    const { platforms, onAnyList } = getPlatformStatus(session.userId, mediaItemId, type);

    return NextResponse.json({
      platforms,
      onAnyList,
      resolvedMediaItemId: mediaItemId,
      library: libraryRow
        ? (() => {
            const r = parseRatings(libraryRow.metadata);
            return { libraryStatus: libraryRow.status, rating: averageRating(r) ?? libraryRow.rating, ratings: r, review: libraryRow.review, reviewedAt: libraryRow.reviewed_at };
          })()
        : null,
    });
});

function resolveBySourceIds(ids: ItemIds): string | null {
  const candidates: [string, string | null | undefined][] = [
    ["rawg", ids.rawg], ["tmdb", ids.tmdb], ["trakt", ids.trakt],
    ["steam", ids.steam], ["letterboxd", ids.letterboxd],
  ];
  for (const [source, sid] of candidates) {
    if (!sid) continue;
    const link = get<{ media_item_id: string }>(
      "SELECT media_item_id FROM media_links WHERE source = ? AND source_id = ?",
      [source, sid]
    );
    if (link) return link.media_item_id;
  }
  return null;
}
