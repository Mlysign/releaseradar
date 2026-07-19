import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem, upsertLibraryEntry } from "./matcher";
import { buildProfile, computeFandexScore } from "./discovery";
import {
  getScoringConfig, saveScoringConfig, getTagCategories, saveTagCategory, saveCategoryWeights,
  deleteTagCategory, setTagCategoryOverride, deleteTagCategoryOverride, listTagCategoryOverrides,
  invalidateScoringConfigCaches,
} from "./scoringConfig";
import { DEFAULT_SCORING_CONFIG } from "./scoringDefaults";
import { isScoringAdmin } from "./devAdmin";

// H5.4 — the dev backend's write paths + the D6 override-resolution wiring in
// buildProfile (a tag reassigned via the taxonomy editor must actually change
// what gets scored, not just sit inertly in the override table).

initDb();

const USER = "u-scoring-admin";

const TMDB = (id: number, title: string, genreNames: string[]) => ({
  id, title, release_date: "2020-01-01", poster_path: "/p.jpg", overview: "o",
  genres: genreNames.map((name) => ({ name })),
});

function movie(sourceId: string, title: string, genreNames: string[]) {
  return upsertMediaItem({
    source: "tmdb", sourceId, type: "movie", title, releaseDate: "2020-01-01",
    rawData: TMDB(Number(sourceId), title, genreNames),
  });
}

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  invalidateScoringConfigCaches();
  // Restore the DB to the seeded defaults between tests (each test may write
  // its own category/config edits, and they share the migrated in-memory db).
  saveScoringConfig(DEFAULT_SCORING_CONFIG);
  for (const c of getTagCategories()) run("DELETE FROM tag_category_override WHERE category_id = ?", [c.id]);
  run("DELETE FROM tag_category_override");
});

describe("scoringConfig write paths", () => {
  it("saveScoringConfig persists and busts the cache", () => {
    saveScoringConfig({ ...DEFAULT_SCORING_CONFIG, mappingConstantUp: 25 });
    expect(getScoringConfig().mappingConstantUp).toBe(25);
  });

  it("saveTagCategory creates a new category and saveCategoryWeights batch-edits weight/ignored only", () => {
    saveTagCategory({ id: "modes-perspectives", label: "Modes & Perspectives", color: "#123456", weight: 1, ignored: false });
    expect(getTagCategories().find((c) => c.id === "modes-perspectives")?.label).toBe("Modes & Perspectives");

    saveCategoryWeights([{ id: "modes-perspectives", weight: 2.5, ignored: false }]);
    const cat = getTagCategories().find((c) => c.id === "modes-perspectives")!;
    expect(cat.weight).toBe(2.5);
    expect(cat.label).toBe("Modes & Perspectives"); // untouched by the weights-only batch save
  });

  it("deleteTagCategory cascades its overrides (ON DELETE CASCADE)", () => {
    saveTagCategory({ id: "temp-cat", label: "Temp", color: "#000000", weight: 1, ignored: false });
    setTagCategoryOverride("co op", "temp-cat");
    expect(listTagCategoryOverrides().some((o) => o.tagKey === "co op")).toBe(true);

    deleteTagCategory("temp-cat");
    expect(getTagCategories().some((c) => c.id === "temp-cat")).toBe(false);
    expect(listTagCategoryOverrides().some((o) => o.tagKey === "co op")).toBe(false);
  });

  it("setTagCategoryOverride then deleteTagCategoryOverride round-trips cleanly", () => {
    setTagCategoryOverride("sequel", "genre");
    expect(listTagCategoryOverrides()).toEqual([{ tagKey: "sequel", categoryId: "genre" }]);
    deleteTagCategoryOverride("sequel");
    expect(listTagCategoryOverrides()).toEqual([]);
  });
});

describe("D6 — a tag_category_override actually changes what buildProfile scores", () => {
  it("reassigning a meta tag (ignored by default) into an active category makes it count", () => {
    // "Sequel" categorizes as meta (ignored, weight 0) by default — confirm it's
    // excluded from the profile first (locks in the H5.2 baseline behavior).
    const a = movie("301", "Sequel Movie", ["Action", "Sequel"]);
    upsertLibraryEntry(USER, a, "tmdb", { status: "watched", rating: 9, reviewedAt: 1 });

    let profile = buildProfile(USER);
    expect(profile.w.has("tag||sequel")).toBe(false);

    // Reassign it to "genre" (an active, weight-1 category by default).
    setTagCategoryOverride("sequel", "genre");
    profile = buildProfile(USER);
    expect(profile.w.has("tag||sequel")).toBe(true);
    expect(profile.meta.get("tag||sequel")?.category).toBe("genre"); // effective category, not the original "meta"
  });

  it("reassigning a tag to a NEWLY CREATED category applies that category's weight", () => {
    saveTagCategory({ id: "modes-perspectives", label: "Modes & Perspectives", color: "#123456", weight: 3, ignored: false });
    setTagCategoryOverride("action", "modes-perspectives"); // reassign a normally-"genre" tag

    const a = movie("302", "Action Movie", ["Action"]);
    upsertLibraryEntry(USER, a, "tmdb", { status: "watched", rating: 9, reviewedAt: 1 });

    const profile = buildProfile(USER);
    expect(profile.meta.get("tag||action")?.classWeight).toBe(3);
    expect(profile.meta.get("tag||action")?.category).toBe("modes-perspectives");
  });
});

describe("buildProfile/computeFandexScore overrides param (H5.4 live preview)", () => {
  it("scores against DRAFT weights without persisting or polluting the cache", () => {
    const a = movie("401", "Action A", ["Action"]);
    const b = movie("402", "Action B", ["Action"]);
    // A lower-rated Horror item pulls the baseline below Action's own average,
    // so Action gets a nonzero dev_f — 3 uniform ratings on the same single
    // facet would make dev_f (and therefore the score) 50 regardless of K.
    const c = movie("403", "Horror C", ["Horror"]);
    upsertLibraryEntry(USER, a, "tmdb", { status: "watched", rating: 9, reviewedAt: 1 });
    upsertLibraryEntry(USER, b, "tmdb", { status: "watched", rating: 9, reviewedAt: 2 });
    upsertLibraryEntry(USER, c, "tmdb", { status: "watched", rating: 3, reviewedAt: 3 }); // clears MIN_RATED_FOR_FANDEX_SCORE (3)

    const realProfile = buildProfile(USER);
    const realScore = computeFandexScore([{ kind: "tag", key: "action", label: "Action", category: "genre" }], realProfile)!.score;

    const draftConfig = {
      ...DEFAULT_SCORING_CONFIG,
      mappingConstantUp: DEFAULT_SCORING_CONFIG.mappingConstantUp * 4,
      mappingConstantDown: DEFAULT_SCORING_CONFIG.mappingConstantDown * 4,
    };
    const draftProfile = buildProfile(USER, { config: draftConfig });
    const draftScore = computeFandexScore([{ kind: "tag", key: "action", label: "Action", category: "genre" }], draftProfile, draftConfig)!.score;

    expect(draftScore).not.toBe(realScore);
    // The persisted config is untouched — nothing was saved.
    expect(getScoringConfig().mappingConstantUp).toBe(DEFAULT_SCORING_CONFIG.mappingConstantUp);
    // A subsequent REAL (non-override) call isn't corrupted by the draft one.
    expect(buildProfile(USER)).toBe(realProfile); // same cached object, not recomputed with draft values
  });

  it("categoryWeights override layers onto the persisted category, not replacing the whole list", () => {
    const a = movie("403", "Horror A", ["Horror"]);
    upsertLibraryEntry(USER, a, "tmdb", { status: "watched", rating: 9, reviewedAt: 1 });

    const draftWeights = new Map([["genre", { weight: 5, ignored: false }]]);
    const profile = buildProfile(USER, { categoryWeights: draftWeights });
    expect(profile.meta.get("tag||horror")?.classWeight).toBe(5);
    // Persisted category row is untouched.
    expect(getTagCategories().find((c) => c.id === "genre")?.weight).toBe(1);
  });
});

describe("isScoringAdmin", () => {
  const withEnv = (value: string | undefined, fn: () => void) => {
    const prev = process.env.SCORING_ADMIN_USER_IDS;
    process.env.SCORING_ADMIN_USER_IDS = value;
    try { fn(); } finally { process.env.SCORING_ADMIN_USER_IDS = prev; }
  };

  it("fails closed when unset", () => withEnv(undefined, () => {
    expect(isScoringAdmin("any-user")).toBe(false);
  }));

  it("matches a comma-separated, whitespace-tolerant allowlist", () => withEnv(" u1 , u2,u3 ", () => {
    expect(isScoringAdmin("u1")).toBe(true);
    expect(isScoringAdmin("u2")).toBe(true);
    expect(isScoringAdmin("u3")).toBe(true);
    expect(isScoringAdmin("u4")).toBe(false);
  }));
});
