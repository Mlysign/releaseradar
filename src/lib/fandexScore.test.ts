import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem, upsertLibraryEntry } from "./matcher";
import { buildProfile, computeFandexScore, Profile } from "./discovery";
import { Facet } from "./facets";

// H5.2 — the Bayesian rescore + the visible Fandex Score aggregate.
//
// buildProfile() is tested against a real seeded library (DB integration —
// catches config-loader/category-lookup wiring bugs). computeFandexScore() is
// tested against a HAND-BUILT Profile (pure aggregation math — the per-category
// cap and the 50+K·weightedDev mapping don't need a real library to verify).

initDb();

const USER = "u-fandex-score";

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
});

describe("buildProfile — Bayesian average (H5.2)", () => {
  it("computes BA_f/dev_f matching the textbook shrinkage formula, weighted by the tag category's weight", () => {
    // baseline = (9 + 7 + 3) / 3 = 6.3333...
    const a = movie("101", "Action A", ["Action"]);
    const b = movie("102", "Action B", ["Action"]);
    const c = movie("103", "Horror C", ["Horror"]);
    upsertLibraryEntry(USER, a, "tmdb", { status: "watched", rating: 9, reviewedAt: 1 });
    upsertLibraryEntry(USER, b, "tmdb", { status: "watched", rating: 7, reviewedAt: 2 });
    upsertLibraryEntry(USER, c, "tmdb", { status: "watched", rating: 3, reviewedAt: 3 });

    const profile = buildProfile(USER);
    const baseline = (9 + 7 + 3) / 3;
    expect(profile.baseline).toBeCloseTo(baseline, 6);

    const C = 5; // DEFAULT_SCORING_CONFIG.priorStrength
    const actionId = "tag||action";
    const horrorId = "tag||horror";

    const baAction = (C * baseline + (9 + 7)) / (C + 2);
    const baHorror = (C * baseline + 3) / (C + 1);
    expect(profile.meta.get(actionId)?.BA).toBeCloseTo(baAction, 6);
    expect(profile.meta.get(actionId)?.n).toBe(2);
    expect(profile.w.get(actionId)).toBeCloseTo(baAction - baseline, 6); // classWeight 1 (genre)

    expect(profile.meta.get(horrorId)?.BA).toBeCloseTo(baHorror, 6);
    expect(profile.w.get(horrorId)).toBeCloseTo(baHorror - baseline, 6);
    // Below baseline → a dislike emerges with no special-casing.
    expect(profile.w.get(horrorId)!).toBeLessThan(0);
  });

  it("excludes an ignored tag category (meta) from the profile entirely", () => {
    const a = movie("201", "Sequel Movie", ["Action", "Sequel"]);
    upsertLibraryEntry(USER, a, "tmdb", { status: "watched", rating: 9, reviewedAt: 1 });

    const profile = buildProfile(USER);
    expect(profile.w.has("tag||action")).toBe(true);
    // "Sequel" categorizes as meta (tags.ts META set), seeded ignored/weight 0.
    expect(profile.w.has("tag||sequel")).toBe(false);
    expect(profile.meta.has("tag||sequel")).toBe(false);
  });

  it("hasSignal is false for a user with no rated facets", () => {
    const profile = buildProfile(USER);
    expect(profile.hasSignal).toBe(false);
    expect(profile.w.size).toBe(0);
  });
});

describe("computeFandexScore — aggregate (H5.2)", () => {
  const meta = (over: Partial<NonNullable<ReturnType<Profile["meta"]["get"]>>> & { classWeight: number }) =>
    ({ kind: "tag", key: "x", label: "X", ...over });

  it("weighted-mean aggregate mapped via 50 + K·weightedDev (K=10 default)", () => {
    // Two facets, weight 1 each: dev = +1 and -0.5 → weightedDev = (1*1 + -0.5*1)/2 = 0.25
    const facets: Facet[] = [
      { kind: "tag", key: "a", label: "A", category: "genre" },
      { kind: "tag", key: "b", label: "B", category: "genre" },
    ];
    const profile: Profile = {
      w: new Map([["tag||a", 1], ["tag||b", -0.5]]),
      meta: new Map([
        ["tag||a", meta({ key: "a", label: "A", category: "genre", classWeight: 1, BA: 1, n: 4 })],
        ["tag||b", meta({ key: "b", label: "B", category: "genre", classWeight: 1, BA: -0.5, n: 2 })],
      ]),
      baseline: 5,
      hasSignal: true,
      ratedItemCount: 10,
    };
    const result = computeFandexScore(facets, profile);
    expect(result).not.toBeNull();
    expect(result!.score).toBeCloseTo(50 + 10 * 0.25, 6); // 52.5
    // Reasons carry BA/n through for the expanded breakdown (§3.4).
    const a = result!.reasons.find((r) => r.label === "A")!;
    expect(a.BA).toBe(1);
    expect(a.n).toBe(4);
  });

  it("clamps to [0, 100] for an extreme weightedDev", () => {
    const facets: Facet[] = [{ kind: "tag", key: "a", label: "A", category: "genre" }];
    const profile: Profile = {
      w: new Map([["tag||a", 10]]), // dev 10 * K 10 = 100 above 50 → would be 150
      meta: new Map([["tag||a", meta({ key: "a", label: "A", category: "genre", classWeight: 1 })]]),
      baseline: 5, hasSignal: true, ratedItemCount: 10,
    };
    expect(computeFandexScore(facets, profile)!.score).toBe(100);
  });

  it("Q20: center is the user's own baseline×10, and center + Σ contributions == score (additive breakdown)", () => {
    const facets: Facet[] = [
      { kind: "tag", key: "a", label: "A", category: "genre" },
      { kind: "tag", key: "b", label: "B", category: "theme" },
      { kind: "person", key: "c", role: "director", label: "Director C" },
    ];
    const profile: Profile = {
      w: new Map([["tag||a", 1.4], ["tag||b", -0.6], ["person|director|c", 2.1]]),
      meta: new Map([
        ["tag||a", meta({ key: "a", label: "A", category: "genre", classWeight: 1 })],
        ["tag||b", meta({ key: "b", label: "B", category: "theme", classWeight: 1 })],
        ["person|director|c", meta({ key: "c", role: "director", label: "Director C", classWeight: 1.3 })],
      ]),
      baseline: 7.2, hasSignal: true, ratedItemCount: 10,
    };
    const result = computeFandexScore(facets, profile)!;
    expect(result.center).toBeCloseTo(72, 6); // baseline 7.2 × 10, NOT a fixed 50
    const sumContributions = result.reasons.reduce((acc, r) => acc + r.contribution, 0);
    expect(result.center + sumContributions).toBeCloseTo(result.score, 1);
  });

  it("Q20: additivity still holds when clamping caps the score (contributions scale down with it)", () => {
    const facets: Facet[] = [
      { kind: "tag", key: "a", label: "A", category: "genre" },
      { kind: "tag", key: "b", label: "B", category: "theme" },
    ];
    const profile: Profile = {
      // baseline 9 (center 90) + a strongly positive dev would blow past 100
      // without clamping — the two reasons must still sum to score - center.
      w: new Map([["tag||a", 8], ["tag||b", 6]]),
      meta: new Map([
        ["tag||a", meta({ key: "a", label: "A", category: "genre", classWeight: 1 })],
        ["tag||b", meta({ key: "b", label: "B", category: "theme", classWeight: 1 })],
      ]),
      baseline: 9, hasSignal: true, ratedItemCount: 10,
    };
    const result = computeFandexScore(facets, profile)!;
    expect(result.score).toBe(100); // clamped
    const sumContributions = result.reasons.reduce((acc, r) => acc + r.contribution, 0);
    expect(result.center + sumContributions).toBeCloseTo(100, 1);
  });

  it("per-category cap: only the top-N |dev| tags per category count toward the aggregate", () => {
    // 5 "theme" tags, cap defaults to 3 — the two weakest (by |dev|) must be
    // excluded from the weighted mean, or a facet-dense item would inflate itself.
    const devs = [5, 4, 3, 0.1, 0.2]; // top 3 by |dev|: 5, 4, 3
    const w = new Map<string, number>();
    const metaMap = new Map<string, ReturnType<typeof meta>>();
    const facets: Facet[] = [];
    devs.forEach((d, i) => {
      const key = `t${i}`;
      const id = `tag||${key}`;
      w.set(id, d); // classWeight 1
      metaMap.set(id, meta({ key, label: key, category: "theme", classWeight: 1 }));
      facets.push({ kind: "tag", key, label: key, category: "theme" });
    });
    const profile: Profile = { w, meta: metaMap, baseline: 5, hasSignal: true, ratedItemCount: 10 };

    const result = computeFandexScore(facets, profile)!;
    const expectedWeightedDev = (5 + 4 + 3) / 3;
    expect(result.score).toBeCloseTo(Math.min(100, 50 + 10 * expectedWeightedDev), 6);
    expect(result.reasons.length).toBe(3);
    expect(result.reasons.map((r) => r.label).sort()).toEqual(["t0", "t1", "t2"]);
  });

  it("returns null when no facet on the item matches the profile", () => {
    const profile: Profile = { w: new Map([["tag||known", 1]]), meta: new Map([["tag||known", meta({ key: "known", label: "Known", classWeight: 1 })]]), baseline: 5, hasSignal: true, ratedItemCount: 10 };
    const facets: Facet[] = [{ kind: "tag", key: "unknown", label: "Unknown", category: "genre" }];
    expect(computeFandexScore(facets, profile)).toBeNull();
  });

  it("returns null when the profile has no signal at all (cold start)", () => {
    const profile: Profile = { w: new Map(), meta: new Map(), baseline: 0, hasSignal: false, ratedItemCount: 0 };
    expect(computeFandexScore([{ kind: "tag", key: "a", label: "A", category: "genre" }], profile)).toBeNull();
  });

  it("§8 cold-start threshold: returns null below MIN_RATED_FOR_FANDEX_SCORE even with real facet signal", () => {
    // hasSignal is true (a real weighted facet exists) but only 1 rated item
    // backs it — below MIN_RATED_FOR_FANDEX_SCORE (3), so no number is shown
    // rather than one built on a single sample.
    const profile: Profile = {
      w: new Map([["tag||a", 3]]),
      meta: new Map([["tag||a", meta({ key: "a", label: "A", category: "genre", classWeight: 1, BA: 8, n: 1 })]]),
      baseline: 5, hasSignal: true, ratedItemCount: 1,
    };
    expect(computeFandexScore([{ kind: "tag", key: "a", label: "A", category: "genre" }], profile)).toBeNull();
  });
});

describe("§4 hard exclusions — community rating, popularity/browsed, release date never move the score", () => {
  it("identical facets score identically regardless of an item's community/browsed/date fields", () => {
    const profile: Profile = {
      w: new Map([["tag||a", 1]]),
      meta: new Map([["tag||a", { kind: "tag", key: "a", label: "A", category: "genre", classWeight: 1, BA: 1, n: 3 }]]),
      baseline: 5, hasSignal: true, ratedItemCount: 10,
    };
    const facets: Facet[] = [{ kind: "tag", key: "a", label: "A", category: "genre" }];

    // Two DiscoveryVector-shaped items, identical facets, wildly different
    // non-facet fields. computeFandexScore's signature has no parameter for
    // any of these — the exclusion is structural, this pins it as a regression
    // guard against a future change that threads the whole vector in.
    const vectorLowPopularity = { communityScore: 5, communityAvg: 5, browsed: 1, releaseDate: "1990-01-01", facets };
    const vectorHighPopularity = { communityScore: 99, communityAvg: 99, browsed: 0, releaseDate: "2099-01-01", facets };

    const scoreA = computeFandexScore(vectorLowPopularity.facets, profile);
    const scoreB = computeFandexScore(vectorHighPopularity.facets, profile);
    expect(scoreA).toEqual(scoreB);
    expect(scoreA!.score).toBe(computeFandexScore(facets, profile)!.score);
  });
});
