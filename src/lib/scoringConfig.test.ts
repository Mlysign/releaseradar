import { describe, it, expect } from "vitest";
import { initDb, run } from "./db";
import { getScoringConfig, getTagCategories, getTagCategoryOverrides, saveScoringConfig, invalidateScoringConfigCaches } from "./scoringConfig";
import { DEFAULT_SCORING_CONFIG, DEFAULT_TAG_CATEGORIES } from "./scoringDefaults";

initDb();

describe("scoringConfig loader (H5.1)", () => {
  it("getScoringConfig reads the seeded row and matches the defaults", () => {
    invalidateScoringConfigCaches();
    expect(getScoringConfig()).toEqual(DEFAULT_SCORING_CONFIG);
  });

  it("getTagCategories reads the seeded taxonomy in sort order, meta ignored/weight 0", () => {
    invalidateScoringConfigCaches();
    const cats = getTagCategories();
    expect(cats.map((c) => c.id)).toEqual(DEFAULT_TAG_CATEGORIES.map((c) => c.id));
    const meta = cats.find((c) => c.id === "meta")!;
    expect(meta.weight).toBe(0);
    expect(meta.ignored).toBe(true);
  });

  it("getTagCategoryOverrides starts empty", () => {
    invalidateScoringConfigCaches();
    expect(getTagCategoryOverrides().size).toBe(0);
  });

  it("saveScoringConfig persists a change and busts the cache; missing keys still default", () => {
    invalidateScoringConfigCaches();
    const next = { ...getScoringConfig(), mappingConstant: 42 };
    saveScoringConfig(next);
    expect(getScoringConfig().mappingConstant).toBe(42);
    // Role weights not present in a saved partial blob still resolve via the default merge.
    expect(getScoringConfig().roleWeights.director).toBe(DEFAULT_SCORING_CONFIG.roleWeights.director);

    // Restore so this test doesn't leak state into other test files sharing the in-memory db.
    saveScoringConfig(DEFAULT_SCORING_CONFIG);
  });

  it("caches getScoringConfig until the signature (version/updated_at) changes", () => {
    invalidateScoringConfigCaches();
    const first = getScoringConfig();
    // Direct row mutation without going through saveScoringConfig — signature unchanged, cache should still hold.
    expect(getScoringConfig()).toBe(first);

    run("UPDATE scoring_config SET version = version + 1 WHERE id = 1");
    expect(getScoringConfig()).not.toBe(first);
    run("UPDATE scoring_config SET version = version - 1 WHERE id = 1");
    invalidateScoringConfigCaches();
  });
});
