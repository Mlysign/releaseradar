import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { normalizeName } from "./normalize";
import { runMigrations } from "./migrations";

// Bump whenever normalizeName()'s rule changes — forces a one-time norm_title
// re-backfill (guarded by SQLite's user_version) so existing rows match the new
// rule. A later migration runner (D4) can adopt this same user_version baseline.
const NORM_VERSION = 1;

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "rr.db");
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let _db: Database.Database | null = null;
let _initialized = false;

export function getDb(): Database.Database {
  if (_db) return _db;
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Only cache a connection whose schema setup SUCCEEDED. This used to assign
  // _db before calling ensureSchema, so a throw in there left a usable but
  // UNMIGRATED connection cached forever: the first request 500s, every request
  // after it returns the cached handle and skips ensureSchema entirely — the app
  // then runs indefinitely against an old schema, failing one write at a time
  // instead of failing to boot. A migration that can't apply must be loud.
  try {
    ensureSchema(db);
  } catch (e) {
    db.close();
    throw e;
  }
  _db = db;
  return _db;
}

export function query<T = any>(sql: string, params: any[] = []): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function run(sql: string, params: any[] = []) {
  return getDb().prepare(sql).run(...params);
}

export function get<T = any>(sql: string, params: any[] = []): T | null {
  return (getDb().prepare(sql).get(...params) as T) ?? null;
}

export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

// Schema setup runs implicitly the first time getDb() opens the connection, so
// callers never have to remember to call it. Kept idempotent and guarded by
// _initialized; takes the db handle directly to avoid recursing through getDb().
function ensureSchema(db: Database.Database) {
  // Only run schema setup once per process
  if (_initialized) return;

  db.exec(`
    -- Users: identity-less, just a container
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    -- One row per platform identity per user
    CREATE TABLE IF NOT EXISTS user_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,         -- steam | trakt | rawg
      provider_user_id TEXT NOT NULL, -- steam64id, trakt username, etc.
      display_name TEXT,
      avatar_url TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at INTEGER,
      metadata TEXT,                  -- JSON: extra provider-specific data
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(provider, provider_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id);

    -- Canonical media items (merged result)
    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,             -- game | movie | show
      title TEXT NOT NULL,            -- merged title (priority order)
      norm_title TEXT,                -- normalized title for fast matching
      release_date TEXT,              -- merged date (priority order)
      poster_url TEXT,                -- best poster URL
      -- H2b provenance: 0 = library / ingested / synced (the catalog pool),
      -- 1 = only ever seen in a /discover feed. The catalog surfaces and the IDF
      -- weights read the pool only; see migration 8 and discovery.ts.
      browsed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(type);
    CREATE INDEX IF NOT EXISTS idx_media_release ON media_items(release_date);
    -- NOTE: no index on browsed here, deliberately. This block runs BEFORE
    -- runMigrations, so it only ever sees the columns an EXISTING db already has.
    -- browsed is added by migration 8, so indexing it here throws
    -- "no such column: browsed" on every pre-migration-8 database, which aborts
    -- ensureSchema before the very migrations it was about to run. Migration 8
    -- owns that index. Same rule for any future column: CREATE TABLE describes a
    -- FRESH db; the indexes here must also hold for an OLD one.

    -- Raw data per source, linked to canonical item
    CREATE TABLE IF NOT EXISTS media_links (
      id TEXT PRIMARY KEY,
      media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      source TEXT NOT NULL,           -- steam | rawg | tmdb | trakt | igdb
      source_id TEXT NOT NULL,        -- ID in that source system
      title TEXT,                     -- source's own title
      release_date TEXT,              -- source's own date
      raw_data TEXT NOT NULL,         -- full JSON from source
      last_synced INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(source, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_links_item ON media_links(media_item_id);
    CREATE INDEX IF NOT EXISTS idx_links_source ON media_links(source, source_id);

    -- User watchlist: what the user is tracking
    CREATE TABLE IF NOT EXISTS user_watchlist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      platform_sources TEXT NOT NULL DEFAULT '[]', -- JSON: ["steam","rawg"]
      added_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      notes TEXT,
      UNIQUE(user_id, media_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_watchlist_user ON user_watchlist(user_id);

    -- User library: items the user has already watched / played / owns,
    -- with an optional personal review score and the date it was logged.
    CREATE TABLE IF NOT EXISTS user_library (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      platform_sources TEXT NOT NULL DEFAULT '[]', -- JSON: ["trakt","letterboxd"]
      status TEXT,                                  -- watched | played | owned
      rating REAL,                                  -- personal score, 0-10 scale
      review TEXT,                                  -- review text, if any
      reviewed_at INTEGER,                          -- unix: when watched/rated
      metadata TEXT,                                -- JSON: per-source detail
      added_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, media_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_library_user ON user_library(user_id);

    -- Sync log
    CREATE TABLE IF NOT EXISTS sync_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      synced_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      item_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ok',
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_log_user ON sync_log(user_id, provider);
  `);

  // ── Lightweight migrations for existing databases ──────────────
  // The composite index on norm_title is created HERE (not in the schema block
  // above) because an existing media_items table won't have the norm_title
  // column until the ALTER below runs. Creating the index in the schema block
  // would fail with "no such column: norm_title" on older databases.
  const cols = db.prepare("PRAGMA table_info(media_items)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "norm_title")) {
    db.exec("ALTER TABLE media_items ADD COLUMN norm_title TEXT");
  }
  // Safe to run every time – IF NOT EXISTS guards it, and the column now exists.
  db.exec("CREATE INDEX IF NOT EXISTS idx_media_type_norm ON media_items(type, norm_title)");

  // norm_title is derived from title via normalizeName() (the single source of
  // truth in normalize.ts). When that rule changes — or a row is missing it — every
  // row must be recomputed, or the matcher's indexed lookup (WHERE type = ? AND
  // norm_title = ?) misses pre-existing rows and creates duplicate canonical items.
  // Guarded by user_version so this full re-backfill runs once per rule version.
  const normVersion = db.pragma("user_version", { simple: true }) as number;
  if (normVersion < NORM_VERSION) {
    const rows = db.prepare("SELECT id, title FROM media_items").all() as { id: string; title: string }[];
    const upd = db.prepare("UPDATE media_items SET norm_title = ? WHERE id = ?");
    const tx = db.transaction((rs: { id: string; title: string }[]) => {
      for (const r of rs) upd.run(normalizeName(r.title ?? ""), r.id);
    });
    tx(rows);
    db.pragma(`user_version = ${NORM_VERSION}`);
  }

  // ── Versioned migrations (D4) ───────────────────────────────────
  // Everything beyond the norm_title baseline (user_version >= 2) is applied by
  // the ordered runner in migrations.ts. Runs in-process here; the same list can
  // be applied standalone to the live DB via scripts/migrate.mjs.
  const applied = runMigrations(db);

  // H2a: reclaim the freed pages. A migration that rewrites raw_data (the
  // projection backfill) frees a LOT — measured 29,116 pages / ~117MB — but
  // SQLite keeps them on the freelist and the FILE never shrinks (159.5MB after
  // the backfill vs 42.4MB once vacuumed). Only worth the cost when a migration
  // actually ran, and it MUST be outside the runner: VACUUM cannot execute
  // inside a transaction, and runMigrations wraps each migration in one.
  //
  // Measured at 0.4s for a 160MB DB. Note for the live volume: VACUUM rewrites
  // the whole file, so Litestream will re-replicate it once.
  if (applied.length) {
    try {
      db.exec("VACUUM");
    } catch {
      // Non-fatal: the data is already correct and the freelist gets reused by
      // later writes, so a failed VACUUM only means the file stays large.
    }
  }

  _initialized = true;
}

/**
 * @deprecated Schema setup is now implicit in getDb(); this is a no-op-safe
 * alias kept only for standalone scripts/tests that import it directly.
 */
export function initDb() {
  getDb();
}
