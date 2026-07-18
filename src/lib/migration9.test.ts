import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { DEFAULT_SCORING_CONFIG, DEFAULT_TAG_CATEGORIES } from "./scoringDefaults";

// Migration 9 (H5.1): scoring_config + tag_category + tag_category_override.
// All three tables are brand new (no ALTER on an existing table), so the real
// risk isn't the upgrade path — it's the seed being wrong or non-idempotent.

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // Migrations run against whatever pre-9 shape exists; an empty in-memory db
  // with no tables at all is fine since every earlier migration is idempotent
  // (CREATE TABLE IF NOT EXISTS) except where it ALTERs a table this test
  // never creates — those migrations already guard on PRAGMA table_info and
  // no-op when the table is absent... except migration 2/3/7 reference
  // media_items/media_links/user_watchlist/user_library, which don't exist
  // here. So seed the minimal pre-existing schema those migrations expect.
  db.exec(`
    CREATE TABLE media_items (id TEXT PRIMARY KEY, type TEXT, title TEXT, release_date TEXT, poster_url TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE media_links (id TEXT PRIMARY KEY, media_item_id TEXT, source TEXT, source_id TEXT, title TEXT, release_date TEXT, raw_data TEXT, last_synced INTEGER);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE user_watchlist (id TEXT PRIMARY KEY, user_id TEXT, media_item_id TEXT, platform_sources TEXT, added_at INTEGER, notes TEXT);
    CREATE TABLE user_library (id TEXT PRIMARY KEY, user_id TEXT, media_item_id TEXT, platform_sources TEXT, status TEXT, rating REAL, review TEXT, reviewed_at INTEGER, metadata TEXT, added_at INTEGER);
  `);
  return db;
}

describe("migration 9 — scoring_config + tag_category + tag_category_override", () => {
  it("creates all three tables and lands at user_version 9", () => {
    const db = freshDb();
    runMigrations(db);
    expect(db.pragma("user_version", { simple: true })).toBe(9);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = new Set(tables.map((t) => t.name));
    expect(names.has("scoring_config")).toBe(true);
    expect(names.has("tag_category")).toBe(true);
    expect(names.has("tag_category_override")).toBe(true);

    const idx = db.prepare("PRAGMA index_list(tag_category_override)").all() as { name: string }[];
    expect(idx.some((i) => i.name === "idx_tag_override_category")).toBe(true);
    db.close();
  });

  it("seeds scoring_config with a single row matching DEFAULT_SCORING_CONFIG", () => {
    const db = freshDb();
    runMigrations(db);

    const rows = db.prepare("SELECT id, config, version FROM scoring_config").all() as { id: number; config: string; version: number }[];
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(1);
    expect(rows[0].version).toBe(1);
    expect(JSON.parse(rows[0].config)).toEqual(DEFAULT_SCORING_CONFIG);
    db.close();
  });

  it("seeds tag_category as a faithful mirror of tags.ts's CATEGORIES", () => {
    const db = freshDb();
    runMigrations(db);

    const rows = db.prepare("SELECT id, label, color, weight, ignored, sort_order FROM tag_category ORDER BY sort_order").all() as
      { id: string; label: string; color: string; weight: number; ignored: number; sort_order: number }[];
    expect(rows.length).toBe(DEFAULT_TAG_CATEGORIES.length);
    rows.forEach((r, i) => {
      const expected = DEFAULT_TAG_CATEGORIES[i];
      expect(r.id).toBe(expected.id);
      expect(r.label).toBe(expected.label);
      expect(r.color).toBe(expected.color);
      expect(r.weight).toBe(expected.weight);
      expect(!!r.ignored).toBe(expected.ignored);
    });

    // meta is the one category that starts ignored/weight 0 (defaultIgnored in tags.ts).
    const meta = rows.find((r) => r.id === "meta")!;
    expect(meta.weight).toBe(0);
    expect(!!meta.ignored).toBe(true);

    // Every other category defaults to weight 1, not ignored.
    const nonMeta = rows.filter((r) => r.id !== "meta");
    expect(nonMeta.every((r) => r.weight === 1 && !r.ignored)).toBe(true);
    db.close();
  });

  it("leaves tag_category_override empty (no reassignments until the taxonomy editor writes them)", () => {
    const db = freshDb();
    runMigrations(db);
    const n = (db.prepare("SELECT COUNT(*) c FROM tag_category_override").get() as { c: number }).c;
    expect(n).toBe(0);
    db.close();
  });

  it("is idempotent: re-running applies nothing and does not duplicate the seed row", () => {
    const db = freshDb();
    runMigrations(db);
    expect(runMigrations(db)).toEqual([]);

    const configRows = (db.prepare("SELECT COUNT(*) c FROM scoring_config").get() as { c: number }).c;
    const categoryRows = (db.prepare("SELECT COUNT(*) c FROM tag_category").get() as { c: number }).c;
    expect(configRows).toBe(1);
    expect(categoryRows).toBe(DEFAULT_TAG_CATEGORIES.length);
    db.close();
  });
});
