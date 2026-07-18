import { describe, it, expect } from "vitest";
import fs from "fs";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { PROJECTION_VERSION } from "./sources/project";

// Migration DRY RUN against a COPY of the real database — the pre-deploy check.
//
// Per the project's live-migration procedure: never touch the original, run
// against a copy, verify, then measure. Skips when data/rr.db is absent, so CI
// stays green — this is a data check, not a logic check.
//
// It makes its OWN fresh copy every run. The first version reused a copy made by
// hand, which the previous run had already migrated — so the re-run measured a
// 0% shrink and failed. The migration is correctly idempotent; the TEST was the
// thing that wasn't repeatable.
//
// NOTE this runs the WHOLE MIGRATIONS list, not just 7 — it is the closest thing
// to a rehearsal of what happens on the live volume at boot.
//
// It covers the IN-PROCESS path only (vitest resolves `@`, as Next does). That is
// NOT the path `scripts/migrate.mjs` takes: this test passing while that runner
// was dead on an unresolvable `@/` import is exactly how it stayed broken from
// H2a until the fix. Both paths are real; green here says nothing about the
// other one, so verify a migration under both.

const SOURCE = "data/rr.db";
const COPY = `${process.env.TEMP ?? "/tmp"}/mig-dryrun.db`;
const hasDb = fs.existsSync(SOURCE);

// Snapshot the source the way the project's procedure says to ("build a clean
// test copy via VACUUM INTO"), NOT with copyFileSync.
//
// This harness used to copyFileSync, which is wrong for a WAL database: it copies
// the main file only, so every commit still sitting in the -wal is missing from
// the copy. It silently under-reported — the m8 case below "passed" against a
// snapshot that predated 57 rows the running dev server had just written.
// VACUUM INTO reads through a proper read transaction, so the copy is the real
// committed state.
function snapshot(): Database.Database {
  fs.rmSync(COPY, { force: true });
  const src = new Database(SOURCE, { readonly: true });
  src.exec(`VACUUM INTO '${COPY.replace(/\\/g, "/")}'`);
  src.close();
  return new Database(COPY);
}

// The source's schema version decides which checks are meaningful. Once the local
// db has itself been migrated (which is the normal steady state after running the
// app), "does migration 7 shrink it" can never be true again.
const sourceVersion = (): number => {
  const d = new Database(SOURCE, { readonly: true });
  const v = d.pragma("user_version", { simple: true }) as number;
  d.close();
  return v;
};

describe.skipIf(!hasDb)("migrations on a live-DB copy", () => {
  // Skips against an already-projected source: re-projecting is a no-op by
  // design, so there'd be nothing to measure. Run it against a pre-H2a snapshot
  // (e.g. a .bak) to reproduce the number.
  it.skipIf(hasDb && sourceVersion() >= 7)("m7: shrinks raw_data, stamps every row, and needs no network", () => {
    const db = snapshot();
    const before = db.prepare("SELECT SUM(LENGTH(raw_data)) b, COUNT(*) c FROM media_links").get() as { b: number; c: number };

    const applied = runMigrations(db as any);

    const after = db.prepare("SELECT SUM(LENGTH(raw_data)) b, COUNT(*) c FROM media_links").get() as { b: number; c: number };
    const unstamped = db
      .prepare("SELECT COUNT(*) c FROM media_links WHERE projection_version < ?")
      .get(PROJECTION_VERSION) as { c: number };

    const lines = [
      `applied migrations: ${applied.join(", ")}`,
      `raw_data: ${(before.b / 1048576).toFixed(1)}MB → ${(after.b / 1048576).toFixed(1)}MB ` +
        `(-${(100 * (1 - after.b / before.b)).toFixed(1)}%)`,
      `links: ${before.c} → ${after.c} (must not change)`,
      `rows still unstamped: ${unstamped.c} (must be 0, else ensure*Detail would refetch them)`,
      `user_version: ${db.pragma("user_version", { simple: true })}`,
    ];
    fs.writeFileSync("migration7-out.txt", lines.join("\n"));
    db.close();

    // The migration must not lose or duplicate links.
    expect(after.c).toBe(before.c);
    // Every row must be stamped: an unstamped row reads as stale, and
    // ensureTmdbDetail would refetch it from TMDB on the next detail view.
    expect(unstamped.c).toBe(0);
    // It must actually reclaim space — that's the entire point.
    expect(1 - after.b / before.b).toBeGreaterThan(0.5);
  });

  // H2b — migration 8 adds media_items.browsed. It's additive with a DEFAULT, so
  // the risk isn't the ALTER, it's the backfill semantics: every row that exists
  // when it runs predates discover-persist and is therefore pool (browsed = 0).
  // If the DEFAULT were ever wrong, the whole live catalog would silently vanish
  // from Best-match/Insights — a total, quiet loss of the catalog surfaces.
  it("m8: adds the column and leaves the catalog intact", () => {
    const db = snapshot();
    const total = (db.prepare("SELECT COUNT(*) c FROM media_items").get() as { c: number }).c;
    const preMigration = (db.pragma("user_version", { simple: true }) as number) < 8;

    runMigrations(db as any);

    // Through whatever the latest migration version is — currently 9 (H5.1).
    expect(db.pragma("user_version", { simple: true })).toBe(9);
    const cols = db.prepare("PRAGMA table_info(media_items)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "browsed")).toBe(true);
    // The migration must not add or drop items.
    expect((db.prepare("SELECT COUNT(*) c FROM media_items").get() as { c: number }).c).toBe(total);

    // The backfill claim, and the only one that can silently destroy the catalog
    // surfaces: everything that existed BEFORE migration 8 predates
    // discover-persist and must land in the pool. Only checkable on a source that
    // hasn't been migrated yet — afterwards, `browsed = 1` rows are legitimately
    // present (real browsed items), and asserting zero would just be wrong.
    if (preMigration) {
      const browsed = (db.prepare("SELECT COUNT(*) c FROM media_items WHERE browsed <> 0").get() as { c: number }).c;
      expect(browsed).toBe(0);
    }

    // Idempotent: re-running is a no-op, not a second ALTER (which would throw).
    expect(runMigrations(db as any)).toEqual([]);
    db.close();
  });
});
