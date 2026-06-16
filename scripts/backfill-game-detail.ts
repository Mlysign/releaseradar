// D9 backfill — persist developer/publisher (and the rest of the detail payload)
// for library games whose stored raw_data is only a *list* payload (Steam owned-
// games, RAWG played-list), so Insights/facets have studio data. Idempotent:
// links that already carry dev/pub are skipped, so re-running after adding games
// only fetches the new ones. Rate-limited; mutates data/rr.db (back it up first).
//
//   npx tsx --env-file=.env scripts/backfill-game-detail.ts --dry-run
//   npx tsx --env-file=.env scripts/backfill-game-detail.ts --limit 25
//   npx tsx --env-file=.env scripts/backfill-game-detail.ts            # full run
//
// Env: DB_PATH (defaults to ./data/rr.db) + RAWG key for game detail fetches.
import { query } from "@/lib/db";
import { enrichStoredGameDetail, rawHasDevPub, GameEnrichStatus } from "@/lib/enrichGameDetail";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? parseInt(args[limitArg + 1] ?? "0", 10) : 0;
const SLEEP_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function main() {
  // Game links from sources whose detail endpoint carries dev/pub.
  const links = query<{ media_item_id: string; source: string; raw_data: string }>(
    `SELECT ml.media_item_id, ml.source, ml.raw_data
       FROM media_links ml JOIN media_items mi ON mi.id = ml.media_item_id
      WHERE mi.type = 'game' AND ml.source IN ('rawg','steam','igdb')`,
  );

  const needBySource: Record<string, number> = {};
  const needItems = new Set<string>();
  for (const l of links) {
    let raw: any; try { raw = JSON.parse(l.raw_data); } catch { raw = null; }
    if (!rawHasDevPub(l.source, raw)) {
      needBySource[l.source] = (needBySource[l.source] ?? 0) + 1;
      needItems.add(l.media_item_id);
    }
  }

  const totalGames = new Set(links.map((l) => l.media_item_id)).size;
  console.log(`Game items with a detail-capable link: ${totalGames}`);
  console.log(`Links missing dev/pub by source:`, needBySource);
  console.log(`Distinct game items needing enrichment: ${needItems.size}`);

  return needItems;
}

(async () => {
  const needItems = main();
  if (dryRun) { console.log("\n[dry-run] no fetches performed."); return; }

  let ids = [...needItems];
  if (limit > 0) { ids = ids.slice(0, limit); console.log(`\nLimiting this run to ${ids.length} items.`); }

  const tally: Record<GameEnrichStatus, number> = { enriched: 0, "had-detail": 0, "no-provider": 0, "no-data": 0, error: 0 };
  let done = 0;
  for (const id of ids) {
    try {
      const results = await enrichStoredGameDetail(id);
      for (const r of results) tally[r.status]++;
    } catch (e) {
      tally.error++;
      console.error(`  item ${id} failed:`, (e as Error).message);
    }
    done++;
    if (done % 25 === 0 || done === ids.length) console.log(`  …${done}/${ids.length}  (enriched=${tally.enriched}, no-data=${tally["no-data"]}, error=${tally.error})`);
    await sleep(SLEEP_MS);
  }

  console.log("\nDone. Per-link outcomes:", tally);
})();
