import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem, upsertWatchlistEntry } from "./matcher";
import { persistDiscoverItems } from "./discoverPersist";
import { find, invalidateDiscoveryCache } from "./discovery";

// H2b — the CATALOG POOL invariant.
//
// Before H2b, media_items ≈ the library, so every surface in discovery.ts could
// read the whole table and be right. H2b makes /discover write a row per browsed
// item, which quietly breaks that assumption everywhere at once: Best-match would
// list titles the user never added, Insights would count them, and the IDF weights
// would take their facet rarity from whatever was popular this week.
//
// The pool is "not browsed, OR acted on by some user". These lock in both halves,
// and the one that is easy to get wrong: recommendIngest persists UNOWNED titles
// on purpose, so the filter cannot be membership.

initDb();

const USER = "u-pool";

const TMDB = (id: number, title: string) => ({
  id, title, release_date: "2025-01-01", poster_path: "/p.jpg", overview: "o",
});

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  invalidateDiscoveryCache();
});

const titles = () => find(USER, { limit: 120 }).items.map((i) => i.title).sort();

describe("catalog pool", () => {
  it("keeps a browsed-only item OUT of the catalog surfaces", () => {
    upsertMediaItem({
      source: "tmdb", sourceId: "1", type: "movie", title: "In My Library",
      releaseDate: "2025-01-01", rawData: TMDB(1, "In My Library"),
    });
    persistDiscoverItems([{
      id: "tmdb-movie-2", type: "movie", title: "Just Browsed", releaseDate: "2025-01-01",
      raw: { source: "tmdb", sourceId: "2", data: TMDB(2, "Just Browsed") },
    }]);
    invalidateDiscoveryCache();

    expect(titles()).toEqual(["In My Library"]);
  });

  it("keeps an INGESTED but unowned item IN the pool", () => {
    // recommendIngest's whole point: a pool to rank that isn't just the watchlist.
    // A membership filter would empty this out — which is why `browsed` exists.
    upsertMediaItem({
      source: "tmdb", sourceId: "3", type: "movie", title: "Ingested Candidate",
      releaseDate: "2025-01-01", rawData: TMDB(3, "Ingested Candidate"),
    });
    invalidateDiscoveryCache();

    expect(titles()).toEqual(["Ingested Candidate"]);
  });

  it("promotes a browsed item into the pool as soon as the user acts on it", () => {
    const map = persistDiscoverItems([{
      id: "tmdb-movie-4", type: "movie", title: "Browsed Then Wishlisted", releaseDate: "2025-01-01",
      raw: { source: "tmdb", sourceId: "4", data: TMDB(4, "Browsed Then Wishlisted") },
    }]);
    const id = map.get("tmdb-movie-4")!;
    invalidateDiscoveryCache();
    expect(titles()).toEqual([]);

    upsertWatchlistEntry(USER, id, "tmdb");
    invalidateDiscoveryCache();

    // No flag was flipped — the pool query unions in user_item_state, so the two
    // can't drift apart.
    expect(titles()).toEqual(["Browsed Then Wishlisted"]);
  });

  it("does not demote a pool item when a discover feed sweeps past it", () => {
    const owned = upsertMediaItem({
      source: "tmdb", sourceId: "5", type: "movie", title: "Owned And Popular",
      releaseDate: "2025-01-01", rawData: TMDB(5, "Owned And Popular"),
    });
    // The same title comes back in a browse feed.
    const map = persistDiscoverItems([{
      id: "tmdb-movie-5", type: "movie", title: "Owned And Popular", releaseDate: "2025-01-01",
      raw: { source: "tmdb", sourceId: "5", data: TMDB(5, "Owned And Popular") },
    }]);
    expect(map.get("tmdb-movie-5")).toBe(owned);
    invalidateDiscoveryCache();

    expect(titles()).toEqual(["Owned And Popular"]);
  });

  it("browsing does not invalidate the pool cache (no rebuild-per-browse)", () => {
    upsertMediaItem({
      source: "tmdb", sourceId: "6", type: "movie", title: "Stable",
      releaseDate: "2025-01-01", rawData: TMDB(6, "Stable"),
    });
    invalidateDiscoveryCache();
    titles(); // build the cache

    // A tripwire only a REBUILD can trip: edit a pool row's title behind the
    // cache's back, without touching updated_at, so the edit itself can't move
    // the signature. Asserting "the browsed item is absent" would NOT prove this
    // — that holds whether or not the cache was thrown away.
    run("UPDATE media_items SET title = 'REBUILT' WHERE title = 'Stable'");

    persistDiscoverItems([{
      id: "tmdb-movie-7", type: "movie", title: "Noise", releaseDate: "2025-01-01",
      raw: { source: "tmdb", sourceId: "7", data: TMDB(7, "Noise") },
    }]);

    // A signature over ALL of media_items would have changed on that browse,
    // forcing a full rebuild — parsing every raw_data in the catalog, on the
    // request path — and we'd read 'REBUILT' here.
    expect(titles()).toEqual(["Stable"]);
  });
});
