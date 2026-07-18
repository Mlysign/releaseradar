// ── D4: versioned migration runner ──────────────────────────────────────────
// Single source of truth for incremental schema changes, keyed on SQLite's
// PRAGMA user_version. Each migration runs once, in order, inside a transaction;
// after it succeeds user_version is bumped to its version number.
//
// Baseline: user_version 1 is the "norm_title backfill" baseline established by
// db.ts's inline NORM_VERSION step (it uses normalizeName(), app-only logic, so
// it stays inline). Every migration here is >= 2, and the SAME list is applied
// either in-process (via getDb()) or standalone against the live data/rr.db by
// scripts/migrate.mjs — no app-logic duplication.
//
// Rules:
//  - Prefer pure SQL. This file was originally "pure SQL only, no app imports" so
//    that plain `node` could load it; migration 7 (H2a) broke that rule to reuse
//    projectRawData(), and the standalone runner silently died on the `@/` alias
//    until scripts/alias-hooks.mjs taught Node to resolve it.
//    The rule is now: an app import is allowed ONLY when the alternative is
//    duplicating real app logic into a migration (projectRawData is ~200 lines
//    that must track normalize.ts; a frozen copy here would drift and re-project
//    the live catalog wrongly). Reaching for one means BOTH paths must still run,
//    so re-verify with `node scripts/migrate.mjs <copy-of-db>` — the in-process
//    path passing proves nothing about the standalone one. Keep imports leaf-like
//    and side-effect-free: pulling in a module that opens a DB or reads env at
//    import time will deadlock or crash the standalone runner.
//  - Idempotent where practical (IF NOT EXISTS / INSERT OR IGNORE) so a partial
//    apply can be safely retried.
//  - Expand-then-contract: add + backfill + switch reads → verify → (later) drop.
//    Never drop a column/table in the same migration that adds its replacement.

import type DatabaseT from "better-sqlite3";
import { projectRawData, PROJECTION_VERSION } from "@/lib/sources/project";
import { DEFAULT_SCORING_CONFIG, DEFAULT_TAG_CATEGORIES } from "@/lib/scoringDefaults";
import type { Source } from "@/types";
type DB = DatabaseT.Database;

export interface Migration {
  version: number;
  name: string;
  up: (db: DB) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    name: "media_external_ids (D5)",
    up: (db) => {
      // Indexed cross-id table so the matcher does an indexed lookup instead of
      // JSON.parse-ing every candidate link's raw_data on the hot sync path.
      // `source` is the id NAMESPACE (a single link can contribute several, e.g.
      // a Trakt link carries both its trakt id and a tmdb id).
      db.exec(`
        CREATE TABLE IF NOT EXISTS media_external_ids (
          media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
          source TEXT NOT NULL,        -- trakt | tmdb | rawg | steam | igdb | letterboxd
          external_id TEXT NOT NULL,
          UNIQUE(media_item_id, source, external_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ext_lookup ON media_external_ids(source, external_id);
        CREATE INDEX IF NOT EXISTS idx_ext_item ON media_external_ids(media_item_id);
      `);

      // Backfill from existing links via json_extract. Mirrors extractCrossIds()
      // in matcher.ts (which remains the write-time source of truth). CAST to TEXT
      // so numeric ids compare equal to the String()-ified ids written at runtime.
      const insertNamespace = (linkSource: string, namespace: string, jsonPath: string) => {
        db.prepare(
          `INSERT OR IGNORE INTO media_external_ids (media_item_id, source, external_id)
           SELECT media_item_id, ?, CAST(json_extract(raw_data, ?) AS TEXT)
           FROM media_links
           WHERE source = ? AND json_extract(raw_data, ?) IS NOT NULL`
        ).run(namespace, jsonPath, linkSource, jsonPath);
      };
      insertNamespace("trakt", "trakt", "$.ids.trakt");
      insertNamespace("trakt", "tmdb", "$.ids.tmdb");
      insertNamespace("tmdb", "tmdb", "$.id");
      insertNamespace("rawg", "rawg", "$.id");
      insertNamespace("steam", "steam", "$.appid");
      insertNamespace("igdb", "igdb", "$.id");
      insertNamespace("letterboxd", "letterboxd", "$.id");
      // Letterboxd's embedded tmdb id lives in a links[] array; rare (provider
      // usually unconfigured) and captured at write time by extractCrossIds, so
      // it's intentionally not backfilled in pure SQL here.
    },
  },
  {
    version: 3,
    name: "user_item_state (D1 + D2)",
    up: (db) => {
      // Normalized, queryable per-source user state — one row per
      // (user, item, source, relation). Replaces JSON-in-a-column: wishlist
      // providers were a JSON array in user_watchlist.platform_sources, and
      // library per-source detail was a JSON blob in user_library.metadata.
      // This single table unifies wishlist + library (D2) and makes per-source
      // ratings/status SQL-queryable (D1). The user_watchlist / user_library
      // rows become caches REBUILT from this table on every write (matcher.ts),
      // so the canonical rating can no longer drift and "clear a rating"
      // propagates. Expand-then-contract: the cache tables are kept (reads still
      // hit them); a later migration may drop their JSON columns.
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_item_state (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
          source TEXT NOT NULL,            -- trakt | tmdb | steam | rawg | ... | local
          relation TEXT NOT NULL,          -- wishlist | library
          status TEXT,                     -- library: watched | played | owned
          rating REAL,                     -- library: per-source 0-10 score
          review TEXT,
          reviewed_at INTEGER,
          added_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          UNIQUE(user_id, media_item_id, source, relation)
        );
        CREATE INDEX IF NOT EXISTS idx_uis_user_item ON user_item_state(user_id, media_item_id);
        CREATE INDEX IF NOT EXISTS idx_uis_user_rel ON user_item_state(user_id, relation);
        CREATE INDEX IF NOT EXISTS idx_uis_item ON user_item_state(media_item_id);
      `);

      // Backfill wishlist rows by expanding the platform_sources JSON array.
      db.prepare(`
        INSERT OR IGNORE INTO user_item_state (id, user_id, media_item_id, source, relation, added_at)
        SELECT lower(hex(randomblob(16))), w.user_id, w.media_item_id, je.value, 'wishlist', w.added_at
        FROM user_watchlist w, json_each(w.platform_sources) je
        WHERE w.platform_sources IS NOT NULL AND json_valid(w.platform_sources)
      `).run();

      // Backfill library rows by expanding the metadata JSON object (key = source).
      db.prepare(`
        INSERT OR IGNORE INTO user_item_state
          (id, user_id, media_item_id, source, relation, status, rating, review, reviewed_at, added_at)
        SELECT lower(hex(randomblob(16))), l.user_id, l.media_item_id, je.key, 'library',
               json_extract(je.value, '$.status'),
               json_extract(je.value, '$.rating'),
               json_extract(je.value, '$.review'),
               json_extract(je.value, '$.reviewedAt'),
               l.added_at
        FROM user_library l, json_each(l.metadata) je
        WHERE l.metadata IS NOT NULL AND json_valid(l.metadata)
      `).run();
    },
  },
  {
    version: 4,
    name: "child-FK indexes (D7)",
    up: (db) => {
      // Index the media_item_id FK on the user cache tables so reverse lookups +
      // ON DELETE CASCADE from media_items don't scan the whole table.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_library_media ON user_library(media_item_id);
        CREATE INDEX IF NOT EXISTS idx_watchlist_media ON user_watchlist(media_item_id);
      `);
    },
  },
  {
    version: 5,
    name: "users.country (T22)",
    up: (db) => {
      // Profile country (ISO 3166-1 alpha-2) driving region-aware release dates +
      // streaming availability. NULL = not set → app falls back to US (the client
      // auto-detects from the browser and persists on first visit). SQLite has no
      // ADD COLUMN IF NOT EXISTS, so guard on the current columns for idempotency.
      const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "country")) {
        db.exec("ALTER TABLE users ADD COLUMN country TEXT");
      }
    },
  },
  {
    version: 6,
    name: "users.session_epoch (S4 session revocation)",
    up: (db) => {
      // Monotonic per-user token generation. Every JWT is minted carrying the
      // epoch current at sign time; getSession() rejects a token whose epoch is
      // behind the user's. Bumping it (logout / disconnect) instantly revokes
      // every outstanding token for that user. DEFAULT 0 = legacy tokens (which
      // carry no epoch, read as 0) stay valid until the first bump → non-breaking.
      const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "session_epoch")) {
        db.exec("ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0");
      }
    },
  },
  {
    version: 7,
    name: "media_links.projection_version + backfill (H2a)",
    up: (db) => {
      // H2a: raw_data stored the ENTIRE provider payload (~92KB/TMDB link,
      // ~94% of the DB) while the app reads a small fixed subset.
      // projectRawData() now trims at write time; this adds the version stamp
      // and re-projects what's already stored.
      //
      // 0 = "written before the projection existed" (a fat, unstamped blob).
      const cols = db.prepare("PRAGMA table_info(media_links)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "projection_version")) {
        db.exec("ALTER TABLE media_links ADD COLUMN projection_version INTEGER NOT NULL DEFAULT 0");
      }

      // Backfill by projecting the STORED blob in place — NO network. The fat
      // rows already contain everything the projection keeps, so this is a pure
      // local transform. That's what makes the migration safe to run against the
      // live volume: no provider calls, no rate limits, no partial-fetch risk.
      const rows = db
        .prepare(
          `SELECT ml.id, ml.source, ml.raw_data
             FROM media_links ml
            WHERE ml.projection_version < ?`
        )
        .all(PROJECTION_VERSION) as { id: string; source: string; raw_data: string }[];

      const upd = db.prepare(
        "UPDATE media_links SET raw_data = ?, projection_version = ? WHERE id = ?"
      );
      for (const r of rows) {
        let raw: unknown;
        try {
          raw = JSON.parse(r.raw_data);
        } catch {
          // Unparseable blob: stamp it so it isn't retried forever, but leave
          // the bytes alone rather than destroying data we can't read.
          upd.run(r.raw_data, PROJECTION_VERSION, r.id);
          continue;
        }
        const projected = JSON.stringify(projectRawData(r.source as Source, raw));
        upd.run(projected, PROJECTION_VERSION, r.id);
      }
    },
  },
  {
    version: 8,
    name: "media_items.browsed (H2b discover-persists provenance)",
    up: (db) => {
      // H2b — /discover now writes a media_items row for every item it returns,
      // so media_items stops being "the library" and becomes "library + ingested
      // pool + everything anyone browsed".
      //
      // The catalog surfaces (find / Best-match, Insights, searchTitles) and the
      // IDF weights read media_items and MUST NOT see the browsed tail: they'd
      // list titles the user never added and dilute facet rarity with whatever
      // happened to be popular this week.
      //
      // Membership (user_item_state) is the obvious filter and it is WRONG:
      // recommendIngest deliberately persists unowned titles "so the recommender
      // has a real pool to rank — not just the watchlist". Filtering on
      // membership would silently empty that pool. So the discriminator is
      // provenance — how the row got here — not who owns it.
      //
      // 0 = library / ingested / synced (the catalog pool). 1 = browsed only.
      // Every row that exists NOW predates discover-persist, so the DEFAULT 0
      // backfills them correctly with no data pass.
      const cols = db.prepare("PRAGMA table_info(media_items)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "browsed")) {
        db.exec("ALTER TABLE media_items ADD COLUMN browsed INTEGER NOT NULL DEFAULT 0");
      }
      // The pool query filters on this on every cache rebuild.
      db.exec("CREATE INDEX IF NOT EXISTS idx_media_items_browsed ON media_items(browsed)");
    },
  },
  {
    version: 9,
    name: "scoring_config + tag_category + tag_category_override (H5.1)",
    up: (db) => {
      // Fandex Score config core (docs/fandex-score.md §6). All three tables
      // are brand new, so — unlike migrations 5-8 — there is no pre-existing
      // column to guard: CREATE TABLE + its indexes can live together here,
      // same as migration 2 (media_external_ids).
      db.exec(`
        CREATE TABLE IF NOT EXISTS scoring_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),  -- single-row config blob
          config TEXT NOT NULL,                   -- JSON: ScoringConfigValues
          version INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS tag_category (
          id TEXT PRIMARY KEY,           -- e.g. genre, setting, or a custom slug
          label TEXT NOT NULL,
          color TEXT NOT NULL,
          weight REAL NOT NULL DEFAULT 1,
          ignored INTEGER NOT NULL DEFAULT 0,      -- excluded from the score entirely
          sort_order INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        -- tag_key → category_id: backend reassignment wins over the code
        -- heuristic (categorizeTag() in tags.ts). D6: one shared taxonomy,
        -- used by both scoring and Insights.
        CREATE TABLE IF NOT EXISTS tag_category_override (
          tag_key TEXT PRIMARY KEY,
          category_id TEXT NOT NULL REFERENCES tag_category(id) ON DELETE CASCADE,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tag_override_category ON tag_category_override(category_id);
      `);

      // Seed scoring_config with the values that mirror current live behavior
      // (discovery.ts's ROLE_WEIGHT + K_SHRINK) — this migration changes no
      // scoring output, only makes the numbers backend-editable later (H5.2+).
      db.prepare(
        `INSERT OR IGNORE INTO scoring_config (id, config, version) VALUES (1, ?, 1)`
      ).run(JSON.stringify(DEFAULT_SCORING_CONFIG));

      // Seed tag_category from tags.ts's CATEGORIES so the backend starts as a
      // faithful mirror of the hardcoded taxonomy — nothing regresses.
      const insertCat = db.prepare(
        `INSERT OR IGNORE INTO tag_category (id, label, color, weight, ignored, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const c of DEFAULT_TAG_CATEGORIES) {
        insertCat.run(c.id, c.label, c.color, c.weight, c.ignored ? 1 : 0, c.sortOrder);
      }
      // tag_category_override starts empty: no reassignments yet, so
      // categorizeTag()'s existing heuristics are the only source until the
      // taxonomy editor (H5.4) writes overrides here.
    },
  },
];

// Apply all pending migrations (version > current user_version), each in its own
// transaction, bumping user_version as it goes. Returns the versions applied.
export function runMigrations(db: DB): number[] {
  const current = db.pragma("user_version", { simple: true }) as number;
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const tx = db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    });
    tx();
    applied.push(m.version);
  }
  return applied;
}
