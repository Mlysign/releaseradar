import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { query } from "@/lib/db";
import { mergeLinks } from "@/lib/merge";
import { getUserStateMap } from "@/lib/userState";
import { MediaLink, EnrichedItem, MediaType, Source } from "@/types";

export const GET = withUser(async (req: NextRequest, session) => {
    const { searchParams } = req.nextUrl;
    const typeFilter = searchParams.get("type") as MediaType | null;
    const sourceFilter = searchParams.get("source") as Source | null;

    // Fetch user's watchlist with all linked source data
    let sql = `
      SELECT
        mi.id, mi.type, mi.title, mi.release_date, mi.poster_url,
        uw.platform_sources, uw.added_at,
        ml.source, ml.source_id, ml.raw_data, ml.release_date as link_release_date
      FROM user_watchlist uw
      JOIN media_items mi ON mi.id = uw.media_item_id
      LEFT JOIN media_links ml ON ml.media_item_id = mi.id
      WHERE uw.user_id = ?
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
            addedAt: row.added_at,
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

    // Build enriched items
    const enriched: EnrichedItem[] = [];
    for (const { item, links } of itemMap.values()) {
      // Source filter
      if (sourceFilter && !item.platformSources.includes(sourceFilter)) continue;

      const merged = mergeLinks(links, item.type);
      enriched.push({
        id: item.id,
        type: item.type,
        platformSources: item.platformSources,
        ...merged,
      });
    }

    // Canonical user-state: these are wishlist items, but also surface the
    // library state (watched/played + rating) so the same item looks identical
    // here and on the Library page.
    const stateMap = getUserStateMap(session.userId, enriched.map((e) => e.id));
    for (const e of enriched) {
      const st = stateMap.get(e.id);
      if (st) { e.libraryStatus = st.libraryStatus; e.rating = st.rating; e.reviewedAt = st.reviewedAt; }
    }

    // Sort by release date, TBA last
    enriched.sort((a, b) => {
      if (!a.releaseDate && !b.releaseDate) return 0;
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return a.releaseDate.localeCompare(b.releaseDate);
    });

    return NextResponse.json({ items: enriched });
});
