import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

// THE UPGRADE PATH — applying this schema to a database that already exists.
//
// Every other DB test starts from a FRESH in-memory database, where ensureSchema's
// CREATE TABLE block creates every column before anything references it. That
// hides an entire class of bug, and it hid a real one: H2b added
// `CREATE INDEX ... ON media_items(browsed)` to that block, which runs BEFORE
// runMigrations. Fresh db → the CREATE TABLE already added `browsed` → fine, all
// tests green. EXISTING db → no such column → the index throws → ensureSchema
// aborts BEFORE the migrations that would have added it → the database is never
// migrated. Unit tests, typecheck, lint and a production build all passed; only
// loading the real app against the real db surfaced it.
//
// So: build an OLD database (the pre-H2b shape), then run the CURRENT schema
// setup over it, exactly as a deploy does to the live volume.

// media_items as it existed BEFORE migration 8 — no `browsed`.
const OLD_SCHEMA = `
  CREATE TABLE media_items (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    norm_title TEXT,
    release_date TEXT,
    poster_url TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE media_links (
    id TEXT PRIMARY KEY,
    media_item_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    title TEXT,
    release_date TEXT,
    raw_data TEXT,
    last_synced INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
`;

function oldDb(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "upgrade-")), "old.db");
  const db = new Database(file);
  db.exec(OLD_SCHEMA);
  db.prepare("INSERT INTO media_items (id, type, title) VALUES ('i1','movie','Existing Title')").run();
  db.prepare(
    "INSERT INTO media_links (id, media_item_id, source, source_id, raw_data) VALUES ('l1','i1','tmdb','1',?)"
  ).run(JSON.stringify({ id: 1, title: "Existing Title" }));
  db.pragma("user_version = 6"); // pre-H2a/H2b
  db.close();
  return file;
}

describe("schema upgrade over an existing database", () => {
  it("migrates a pre-H2b db (the bug: an index on a not-yet-added column aborted ensureSchema)", () => {
    const file = oldDb();
    const db = new Database(file);

    // This is the ordering that broke: the app's CREATE TABLE/INDEX block runs
    // first and must be safe against the OLD column set, THEN migrations run.
    expect(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS media_items (
          id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, norm_title TEXT,
          release_date TEXT, poster_url TEXT, browsed INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(type);
        CREATE INDEX IF NOT EXISTS idx_media_release ON media_items(release_date);
      `);
      runMigrations(db as any);
    }).not.toThrow();

    // The migration must have actually landed (through whatever the latest
    // migration version is — currently 9, H5.1's scoring_config core).
    expect(db.pragma("user_version", { simple: true })).toBe(9);
    const cols = db.prepare("PRAGMA table_info(media_items)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "browsed")).toBe(true);
    // The pre-existing row belongs to the pool, not the browsed tail.
    expect((db.prepare("SELECT browsed FROM media_items WHERE id='i1'").get() as any).browsed).toBe(0);
    // And migration 8's index exists — it's the schema block's job no longer.
    const idx = db.prepare("PRAGMA index_list(media_items)").all() as { name: string }[];
    expect(idx.some((i) => i.name === "idx_media_items_browsed")).toBe(true);
    db.close();
  });

  it("indexing a column that only a migration adds throws on an existing db", () => {
    // The exact failure, pinned: this is why that index cannot live in the
    // CREATE TABLE block. If someone moves it back, this fails.
    const db = new Database(oldDb());
    expect(() => db.exec("CREATE INDEX IF NOT EXISTS x ON media_items(browsed)")).toThrow(/no such column/);
    db.close();
  });
});
