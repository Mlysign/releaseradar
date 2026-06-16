import { query } from "@/lib/db";
import { linkSourceToItem } from "@/lib/matcher";
import { METADATA } from "@/lib/metadata/registry";
import { Source } from "@/types";

// D9 — game *list* payloads (Steam owned-games = appid/name/playtime, RAWG
// played-list) omit developer/publisher, so Insights/facets have no studio data
// for them (only ~3% of library games carried it). Each of these sources DOES
// expose dev/pub on its per-game *detail* endpoint. This refetches a game's links
// from their own detail endpoints and persists the richer payload — making the
// studio facets queryable from stored raw_data without any read-time fetch.
//
// Idempotent: a link that already carries dev/pub is skipped, so re-running after
// adding games is cheap. The matcher's merge-preserve keeps the fetched detail
// from being dropped when a later list-payload sync re-upserts the same link.

// Sources whose detail endpoint carries developer/publisher.
const DETAIL_SOURCES = new Set<string>(["rawg", "steam", "igdb"]);

export function rawHasDevPub(source: string, raw: any): boolean {
  if (!raw || typeof raw !== "object") return false;
  if (source === "rawg") return (raw.developers?.length ?? 0) > 0 || (raw.publishers?.length ?? 0) > 0;
  if (source === "steam") return (raw.basic_info?.developers?.length ?? 0) > 0 || (raw.basic_info?.publishers?.length ?? 0) > 0;
  if (source === "igdb") return (raw.involved_companies?.length ?? 0) > 0;
  return false;
}

export type GameEnrichStatus = "enriched" | "had-detail" | "no-provider" | "no-data" | "error";
export interface GameEnrichResult { source: string; sourceId: string; status: GameEnrichStatus; }

// Refetch + persist detail for one game item's links. Returns one result per
// detail-capable link so a backfill can report coverage.
export async function enrichStoredGameDetail(mediaItemId: string): Promise<GameEnrichResult[]> {
  const links = query<{ source: string; source_id: string; title: string; release_date: string | null; raw_data: string }>(
    "SELECT source, source_id, title, release_date, raw_data FROM media_links WHERE media_item_id = ?",
    [mediaItemId],
  );
  const results: GameEnrichResult[] = [];
  for (const l of links) {
    if (!DETAIL_SOURCES.has(l.source)) continue;
    let raw: any;
    try { raw = JSON.parse(l.raw_data); } catch { raw = null; }
    if (rawHasDevPub(l.source, raw)) { results.push({ source: l.source, sourceId: l.source_id, status: "had-detail" }); continue; }

    const provider = METADATA[l.source as Source];
    if (!provider?.fetchById) { results.push({ source: l.source, sourceId: l.source_id, status: "no-provider" }); continue; }
    try {
      const fresh = await provider.fetchById(l.source_id, "game");
      if (!fresh) { results.push({ source: l.source, sourceId: l.source_id, status: "no-data" }); continue; }
      linkSourceToItem(mediaItemId, {
        source: l.source as Source,
        sourceId: l.source_id,
        type: "game",
        title: fresh.title ?? l.title,
        releaseDate: fresh.releaseDate ?? l.release_date,
        rawData: fresh.rawData,
      });
      results.push({ source: l.source, sourceId: l.source_id, status: "enriched" });
    } catch {
      results.push({ source: l.source, sourceId: l.source_id, status: "error" });
    }
  }
  return results;
}
