import { describe, it, expect, vi, beforeEach } from "vitest";
import { initDb, run } from "@/lib/db";
import { personPool, sortPool, crowdAvg, PoolTitle, PublicFacetItem, PublicFacetPayload } from "./publicFacetDetail";

// PR14 (2026-07-22) mocks — buildPublicFacetDetail fans out to live TMDB/RAWG
// calls; stub the exact seams so a "tag" build resolves via the static genre
// map (tmdbGenreId/rawgGenreSlug — no network) with one controlled result per
// provider. persistDiscoverItems is mocked directly: it's the write path this
// test exists to assert is (or isn't) called, not something to exercise for
// real against the in-memory test DB.
vi.mock("@/lib/facetDetail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/facetDetail")>();
  return {
    ...actual,
    tmdbJson: vi.fn().mockResolvedValue({ results: [{ id: 101, title: "Mock Movie", vote_average: 7, vote_count: 100 }] }),
    rawgJson: vi.fn().mockResolvedValue({ results: [{ id: 202, name: "Mock Game", rating: 4, ratings_count: 50 }] }),
  };
});
vi.mock("@/lib/discoverPersist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/discoverPersist")>();
  return { ...actual, persistDiscoverItems: vi.fn().mockReturnValue(new Map()) };
});

// P17 — the public facet layer does live provider calls, so these tests cover the
// PURE logic (role-merge, sort, crowd avg) with fixtures, plus a compile-time
// assertion that the payload can never carry a per-user field (the leak boundary).

describe("personPool — combined roles, deduped, noise-filtered", () => {
  const credits = {
    cast: [
      { media_type: "movie", id: 1, title: "Interstellar", vote_count: 100, vote_average: 8.4, character: "Cooper" },
      { media_type: "movie", id: 3, title: "A Documentary", vote_count: 5, character: "Self" }, // self → dropped
    ],
    crew: [
      { media_type: "movie", id: 2, title: "Inception", vote_count: 100, vote_average: 8.3, job: "Writer" },
      { media_type: "movie", id: 2, title: "Inception", vote_count: 100, vote_average: 8.3, job: "Director" },
      { media_type: "movie", id: 4, title: "Unreleased", vote_count: 0, job: "Director" }, // no votes/poster → dropped
      { media_type: "tv", id: 5, name: "A Show", vote_count: 10, vote_average: 7, job: "Director" },
    ],
  };
  const pool = personPool(credits);
  const byId = (id: string) => pool.find((t) => t.sourceId === id);

  it("merges every role a person held on one title, Director first", () => {
    expect(byId("2")?.roles).toEqual(["Director", "Writer"]);
  });
  it("labels cast credits as Actor", () => {
    expect(byId("1")?.roles).toEqual(["Actor"]);
  });
  it("drops self/narrator cameos and vote-less, poster-less noise", () => {
    expect(byId("3")).toBeUndefined();
    expect(byId("4")).toBeUndefined();
  });
  it("maps tv credits to the show type", () => {
    expect(byId("5")?.type).toBe("show");
  });
});

describe("sortPool", () => {
  const mk = (sourceId: string, votes: number, vote: number | null, releaseDate: string | null): PoolTitle => ({
    source: "tmdb", sourceId, type: "movie", title: sourceId, releaseDate, posterUrl: null, vote, votes, roles: [], raw: {},
  });
  const pool = [mk("old-hit", 1000, 6.0, "2001-01-01"), mk("new-flop", 5, 9.5, "2024-01-01"), mk("mid", 200, 7.5, "2015-01-01")];

  it("popular = by vote count", () => {
    expect(sortPool(pool, "popular").map((t) => t.sourceId)).toEqual(["old-hit", "mid", "new-flop"]);
  });
  it("newest = by release date desc", () => {
    expect(sortPool(pool, "newest").map((t) => t.sourceId)).toEqual(["new-flop", "mid", "old-hit"]);
  });
  it("rating = Bayesian-damped score desc (SM3): a 5-vote 9.5 does NOT outrank a well-voted 7.5", () => {
    expect(sortPool(pool, "rating").map((t) => t.sourceId)).toEqual(["mid", "new-flop", "old-hit"]);
  });
  it("rating still ranks a well-voted high scorer first", () => {
    const withClassic = [...pool, mk("classic", 5000, 8.7, "1999-01-01")];
    expect(sortPool(withClassic, "rating")[0].sourceId).toBe("classic");
  });

  // Q23 — a facet's games were sinking under raw TMDB vote counts, so "Most
  // popular" never surfaced them regardless of how popular they were within
  // games specifically.
  it("popular rank-normalizes per source, so a games facet isn't drowned out by raw TMDB vote counts", () => {
    const tmdb = (id: string, votes: number): PoolTitle => ({
      source: "tmdb", sourceId: id, type: "movie", title: id, releaseDate: null, posterUrl: null, vote: 7, votes, roles: [], raw: {},
    });
    const rawg = (id: string, votes: number): PoolTitle => ({
      source: "rawg", sourceId: id, type: "game", title: id, releaseDate: null, posterUrl: null, vote: 7, votes, roles: [], raw: {},
    });
    const mixed = [
      tmdb("blockbuster", 50000), tmdb("mid-movie", 5000), tmdb("obscure-movie", 100),
      rawg("top-game", 800), rawg("mid-game", 200),
    ];
    const order = sortPool(mixed, "popular").map((t) => t.sourceId);
    // Top of each source's OWN scale ranks together at the front — the top
    // game beats every movie except the single most popular one.
    expect(order[0]).toBe("blockbuster"); // rank 0 within tmdb
    expect(order[1]).toBe("top-game");    // rank 0 within rawg — ties blockbuster, raw votes tiebreak keeps it 2nd
    expect(order.indexOf("top-game")).toBeLessThan(order.indexOf("mid-movie"));
    expect(order.indexOf("top-game")).toBeLessThan(order.indexOf("obscure-movie"));
    expect(order[order.length - 1]).toBe("obscure-movie"); // rank 1 within tmdb (least popular movie)
  });
});

describe("crowdAvg", () => {
  const mk = (votes: number, vote: number | null): PoolTitle => ({
    source: "tmdb", sourceId: "x", type: "movie", title: "x", releaseDate: null, posterUrl: null, vote, votes, roles: [], raw: {},
  });
  it("averages only well-voted titles when enough clear the threshold", () => {
    const r = crowdAvg([mk(100, 8), mk(100, 6), mk(100, 7), mk(2, 10)]); // the 2-vote 10 is excluded (min 10)
    expect(r.count).toBe(3);
    expect(r.avg).toBe(7);
  });
  it("falls back to any voted title when too few clear the threshold", () => {
    const r = crowdAvg([mk(1, 9), mk(2, 7)]);
    expect(r.count).toBe(2);
    expect(r.avg).toBe(8);
  });
});

describe("buildPublicFacetDetail — persist gate (PR14)", () => {
  initDb();
  beforeEach(() => {
    run("DELETE FROM media_items");
  });

  it("does not write ANY media_items row when persist is false (anon/crawler)", async () => {
    const { buildPublicFacetDetail } = await import("./publicFacetDetail");
    const { persistDiscoverItems } = await import("@/lib/discoverPersist");
    const payload = await buildPublicFacetDetail({ kind: "tag", key: "action" }, { persist: false });

    expect(payload).not.toBeNull();
    expect(persistDiscoverItems).not.toHaveBeenCalled();
    // Non-linkable is the documented fallback, not an error state.
    expect(payload!.items.every((i) => i.linkable === false)).toBe(true);
  });

  it("writes when persist is true (real session)", async () => {
    const { buildPublicFacetDetail } = await import("./publicFacetDetail");
    const { persistDiscoverItems } = await import("@/lib/discoverPersist");
    await buildPublicFacetDetail({ kind: "tag", key: "action" }, { persist: true });

    expect(persistDiscoverItems).toHaveBeenCalledTimes(1);
  });

  // The trap this whole gate exists to avoid: a shared cache key would let
  // one build's persist decision leak into the other's response.
  it("caches the anon and logged-in builds SEPARATELY, not interchangeably", async () => {
    const { buildPublicFacetDetail } = await import("./publicFacetDetail");
    const { persistDiscoverItems } = await import("@/lib/discoverPersist");
    vi.mocked(persistDiscoverItems).mockClear();

    await buildPublicFacetDetail({ kind: "tag", key: "romance" }, { persist: false });
    expect(persistDiscoverItems).not.toHaveBeenCalled();

    // Same kind/key/page/sort, different persist flag — must NOT hit the
    // no-persist entry's cache slot.
    await buildPublicFacetDetail({ kind: "tag", key: "romance" }, { persist: true });
    expect(persistDiscoverItems).toHaveBeenCalledTimes(1);
  });
});

describe("leak boundary (compile-time)", () => {
  // If any per-user field is ever added to the public types, `_noLeak*` stops
  // being assignable to `true` and this file fails to typecheck.
  type Forbidden = "rating" | "review" | "reviewedAt" | "libraryStatus" | "onWatchlist" | "platformSources" | "userAvg" | "userCount" | "delta";
  type HasNoUserField<T> = Extract<keyof T, Forbidden> extends never ? true : false;
  const _noLeakItem: HasNoUserField<PublicFacetItem> = true;
  const _noLeakPayload: HasNoUserField<PublicFacetPayload> = true;
  it("public types carry no per-user field", () => {
    expect(_noLeakItem && _noLeakPayload).toBe(true);
  });
});
