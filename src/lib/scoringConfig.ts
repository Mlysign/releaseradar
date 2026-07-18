// Fandex Score config loader (H5.1) — reads scoring_config + tag_category +
// tag_category_override (migration 9), cache-busted per-process. Nothing in
// the app calls these yet: buildProfile()/scoreFacets() still read the
// hardcoded ROLE_WEIGHT/tags.ts sets directly. That swap is H5.2 — this file
// only makes the DB-backed values loadable ahead of it.

import { get, query, run } from "@/lib/db";
import { DEFAULT_SCORING_CONFIG, ScoringConfigValues } from "@/lib/scoringDefaults";

export interface TagCategoryConfig {
  id: string;
  label: string;
  color: string;
  weight: number;
  ignored: boolean;
  sortOrder: number;
}

// ── scoring_config (single row) ─────────────────────────────────────
let _configCache: { sig: string; value: ScoringConfigValues } | null = null;

function configSignature(): string {
  const r = get<{ version: number; updated_at: number }>(
    `SELECT version, updated_at FROM scoring_config WHERE id = 1`
  );
  return `${r?.version ?? 0}:${r?.updated_at ?? 0}`;
}

// Merges the stored blob over the defaults (not the reverse) so a config row
// saved before a new knob existed still gets that knob's default rather than
// `undefined` — forward-compatible with H5.4 adding fields to the JSON shape.
export function getScoringConfig(): ScoringConfigValues {
  const sig = configSignature();
  if (_configCache && _configCache.sig === sig) return _configCache.value;

  const row = get<{ config: string }>(`SELECT config FROM scoring_config WHERE id = 1`);
  const stored = row ? (JSON.parse(row.config) as Partial<ScoringConfigValues>) : {};
  const value: ScoringConfigValues = {
    ...DEFAULT_SCORING_CONFIG,
    ...stored,
    roleWeights: { ...DEFAULT_SCORING_CONFIG.roleWeights, ...stored.roleWeights },
  };
  _configCache = { sig, value };
  return value;
}

export function saveScoringConfig(value: ScoringConfigValues): void {
  run(
    `UPDATE scoring_config SET config = ?, version = version + 1, updated_at = strftime('%s','now') WHERE id = 1`,
    [JSON.stringify(value)]
  );
  _configCache = null;
}

// ── tag_category ─────────────────────────────────────────────────────
let _categoryCache: { sig: string; value: TagCategoryConfig[] } | null = null;

function categorySignature(): string {
  const r = get<{ n: number; mx: number }>(
    `SELECT COUNT(*) n, COALESCE(MAX(updated_at),0) mx FROM tag_category`
  );
  return `${r?.n ?? 0}:${r?.mx ?? 0}`;
}

interface TagCategoryRow {
  id: string; label: string; color: string; weight: number; ignored: number; sort_order: number;
}

export function getTagCategories(): TagCategoryConfig[] {
  const sig = categorySignature();
  if (_categoryCache && _categoryCache.sig === sig) return _categoryCache.value;

  const rows = query<TagCategoryRow>(`SELECT id, label, color, weight, ignored, sort_order FROM tag_category ORDER BY sort_order`);
  const value: TagCategoryConfig[] = rows.map((r) => ({
    id: r.id, label: r.label, color: r.color, weight: r.weight, ignored: !!r.ignored, sortOrder: r.sort_order,
  }));
  _categoryCache = { sig, value };
  return value;
}

// H5.4 — create or edit a category (the taxonomy editor's CRUD). `sortOrder`
// defaults to putting a brand-new category at the end of the existing list.
export function saveTagCategory(cat: { id: string; label: string; color: string; weight: number; ignored: boolean; sortOrder?: number }): void {
  const existing = get<{ sort_order: number }>(`SELECT sort_order FROM tag_category WHERE id = ?`, [cat.id]);
  const sortOrder = cat.sortOrder ?? existing?.sort_order ?? getTagCategories().length;
  run(
    `INSERT INTO tag_category (id, label, color, weight, ignored, sort_order, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, color = excluded.color,
       weight = excluded.weight, ignored = excluded.ignored, sort_order = excluded.sort_order,
       updated_at = excluded.updated_at`,
    [cat.id, cat.label, cat.color, cat.weight, cat.ignored ? 1 : 0, sortOrder]
  );
  _categoryCache = null;
}

// Batch weight/ignored update for the Weights panel (leaves label/color/sortOrder
// untouched — that's the Taxonomy panel's job).
export function saveCategoryWeights(updates: { id: string; weight: number; ignored: boolean }[]): void {
  for (const u of updates) {
    run(`UPDATE tag_category SET weight = ?, ignored = ?, updated_at = strftime('%s','now') WHERE id = ?`, [u.weight, u.ignored ? 1 : 0, u.id]);
  }
  _categoryCache = null;
}

// ON DELETE CASCADE on tag_category_override.category_id means any tag
// reassigned to this category reverts to categorizeTag()'s code heuristic
// (via getEffectiveCategory's ?? fallback) rather than pointing at nothing.
export function deleteTagCategory(id: string): void {
  run(`DELETE FROM tag_category WHERE id = ?`, [id]);
  _categoryCache = null;
  _overrideCache = null;
}

// ── tag_category_override ────────────────────────────────────────────
let _overrideCache: { sig: string; value: Map<string, string> } | null = null;

function overrideSignature(): string {
  const r = get<{ n: number; mx: number }>(
    `SELECT COUNT(*) n, COALESCE(MAX(updated_at),0) mx FROM tag_category_override`
  );
  return `${r?.n ?? 0}:${r?.mx ?? 0}`;
}

export function getTagCategoryOverrides(): Map<string, string> {
  const sig = overrideSignature();
  if (_overrideCache && _overrideCache.sig === sig) return _overrideCache.value;

  const rows = query<{ tag_key: string; category_id: string }>(`SELECT tag_key, category_id FROM tag_category_override`);
  const value = new Map(rows.map((r) => [r.tag_key, r.category_id]));
  _overrideCache = { sig, value };
  return value;
}

// List form for the taxonomy editor's "current overrides" view.
export function listTagCategoryOverrides(): { tagKey: string; categoryId: string }[] {
  return [...getTagCategoryOverrides().entries()].map(([tagKey, categoryId]) => ({ tagKey, categoryId }));
}

export function setTagCategoryOverride(tagKey: string, categoryId: string): void {
  run(
    `INSERT INTO tag_category_override (tag_key, category_id, updated_at) VALUES (?, ?, strftime('%s','now'))
     ON CONFLICT(tag_key) DO UPDATE SET category_id = excluded.category_id, updated_at = excluded.updated_at`,
    [tagKey, categoryId]
  );
  _overrideCache = null;
}

export function deleteTagCategoryOverride(tagKey: string): void {
  run(`DELETE FROM tag_category_override WHERE tag_key = ?`, [tagKey]);
  _overrideCache = null;
}

// Exposed for tests / the H5.4 write routes to force a re-read without
// waiting on the next signature check.
export function invalidateScoringConfigCaches(): void {
  _configCache = null;
  _categoryCache = null;
  _overrideCache = null;
}

// H5.4 §5: "All config lives in the DB and cache-busts the profile/score
// caches on save." buildProfile()'s cache is keyed on the user's library
// signature only — a scoring_config/tag_category/tag_category_override edit
// changes nothing about the library, so without this, every cached profile
// (for EVERY user) would keep scoring with the pre-edit weights until each
// user's library happened to change. Folding this into buildProfile's cache
// key makes any admin save invalidate every cached profile at once.
export function scoringConfigSignature(): string {
  return `${configSignature()}|${categorySignature()}|${overrideSignature()}`;
}
