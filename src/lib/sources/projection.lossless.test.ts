import { describe, it, expect } from "vitest";
import fs from "fs";
import Database from "better-sqlite3";
import { normalizeSource } from "./normalize";
import { projectRawData } from "./project";
import { COUNTRIES } from "@/lib/countries";
import { Source, MediaType } from "@/types";

// H2a guard: the raw_data projection must be LOSSLESS with respect to what the
// app actually reads.
//
// normalize.ts is the app's entire view of an item, so if
// normalize(original) === normalize(projected) for every link in the real
// catalog, the projection dropped nothing that matters. Field lists lie; this
// doesn't — it caught four real losses that reading the code did not:
//   • rawg `background_image_additional` → wrong `images` on 704/722 links
//   • tmdb `videos` filtering → a DIFFERENT trailer on 289 titles (the pick is
//     an order-dependent `find` with an "any YouTube video" fallback)
//   • tmdb `last_episode_to_air` → null show runtimes
//   • tmdb `origin_country` → null country
//
// Runs against the developer's local data/rr.db and SKIPS when absent (CI has no
// DB, and this is a data-shape check, not a logic check). Re-run it after ANY
// change to project.ts or normalize.ts:
//     npx vitest run src/lib/sources/projection.lossless.test.ts

const DB = "data/rr.db";
const KEPT = new Set(COUNTRIES.map((c) => c.code));

// Region maps are only ever read via the user's country (merge.ts) or
// pickRegion's `country ?? US ?? GB` chain, and users.country is validated
// against COUNTRIES — so a dropped non-curated region is unreachable, not lost.
const REGION_MAPS = ["releaseDatesByRegion", "streamingByRegion"];

// KNOWN + ACCEPTED: pickRegion / the legacy streamingProviders fall back to
// `map[Object.keys(map)[0]]` — an arbitrary first key. Dropping non-curated
// regions changes which key is first, but ONLY for titles where the user's
// country, US and GB all have no providers — where the value was already
// arbitrary (and arguably improves: the fallback now lands on a curated
// country). Measured across the whole catalog: 2 titles of 4,012 links, on
// `streamingProviders`/`streamingByRegion`, which normalize keeps for the debug
// explainer (the user-facing path is streamingByRegion → merge's pickRegion).
//
// Counts differing KEYS, not rows — one of those 2 titles differs on both keys.
const ACCEPTED_MISMATCHES = 3;

const hasDb = fs.existsSync(DB);

describe.skipIf(!hasDb)("H2a projection is lossless w.r.t. normalize()", () => {
  it("normalize(original) === normalize(projected) across the real catalog", () => {
    const db = new Database(DB, { readonly: true });
    const rows = db
      .prepare(
        `SELECT ml.source, ml.raw_data, mi.type
           FROM media_links ml JOIN media_items mi ON mi.id = ml.media_item_id`
      )
      .all() as { source: string; raw_data: string; type: string }[];
    db.close();

    const reachable = (v: any) =>
      v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).filter(([k]) => KEPT.has(k)))
        : v;

    const failures: string[] = [];

    for (const r of rows) {
      let raw: any;
      try { raw = JSON.parse(r.raw_data); } catch { continue; }
      const projected = projectRawData(r.source as Source, raw);

      const a = normalizeSource(r.source as Source, raw, r.type as MediaType) as any;
      const b = normalizeSource(r.source as Source, projected, r.type as MediaType) as any;

      for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
        const isRegion = REGION_MAPS.includes(k);
        const av = JSON.stringify(isRegion ? reachable(a?.[k]) : a?.[k]);
        const bv = JSON.stringify(isRegion ? reachable(b?.[k]) : b?.[k]);
        if (av !== bv) failures.push(`${r.source}/${k}: ${String(av).slice(0, 60)} → ${String(bv).slice(0, 60)}`);
      }
    }

    // NOTE: this used to also assert the projection shrinks the catalog >50%.
    // That was a one-time H2a MEASUREMENT against a pre-projection database, not
    // an invariant — and it stopped being true the moment the local db was itself
    // migrated (projecting an already-projected blob is correctly a no-op, so the
    // "shrink" is 0% and the assertion failed forever after). The size result is
    // recorded in TASKS.md/H2a; the shrink is re-measured against an unmigrated
    // snapshot by migration7.dryrun.test.ts, where it actually means something.
    //
    // What's left IS the invariant, and it's the part that guards future edits:
    // projecting must not change what normalize() sees.
    expect(failures.length, `losses:\n${failures.slice(0, 10).join("\n")}`).toBeLessThanOrEqual(ACCEPTED_MISMATCHES);
  });
});
