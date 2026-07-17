import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, query, get } from "./db";
import { upsertMediaItem } from "./matcher";
import { persistDiscoverItems } from "./discoverPersist";
import { PROJECTION_VERSION } from "./sources/project";

// H2b — the guard on discover-persists-at-enrich-time.
//
// The whole feature rests on writing a row from a provider LIST payload, and
// that is exactly where it can go wrong silently, because `remergeItem`
// recomputes the canonical title/date/poster FROM rawData and rebuilds
// media_external_ids FROM rawData. So a payload that isn't natively shaped
// produces a row that LOOKS fine (it exists, it has a uuid, the card renders
// from the live feed data anyway) while being unmatchable and mislabelled.
// These tests read the actual stored rows rather than trusting the write path.

initDb();

beforeEach(() => {
  run("DELETE FROM media_items");
});

const TMDB_MOVIE = {
  id: 693134,
  title: "Dune: Part Two",
  release_date: "2024-02-27",
  poster_path: "/abc.jpg",
  overview: "Paul Atreides unites with the Fremen.",
  genre_ids: [878, 12],
  original_language: "en",
  vote_count: 4200,
  vote_average: 8.1,
};

const RAWG_GAME = {
  id: 58175,
  name: "Hades II",
  released: "2025-05-06",
  background_image: "https://media.rawg.io/hades2.jpg",
  genres: [{ name: "Action" }],
  tags: [{ name: "Roguelike" }],
  ratings_count: 900,
  rating: 4.6,
};

// A Trakt "anticipated" entry's inner movie object: Trakt-shaped, carrying a
// tmdb cross-id. The candidate built from this is LABELLED source "tmdb".
const TRAKT_MOVIE = {
  title: "Anticipated Thing",
  released: "2026-09-01",
  ids: { trakt: 999, tmdb: 5555 },
  overview: "Soon.",
  genres: ["drama"],
  language: "en",
  votes: 12,
  rating: 7.5,
};

const item = (over: any) => ({
  id: "feed-1", type: "movie", title: "x", releaseDate: null, ...over,
});

const linkFor = (source: string, sourceId: string) =>
  get<{ media_item_id: string; raw_data: string; projection_version: number }>(
    "SELECT media_item_id, raw_data, projection_version FROM media_links WHERE source = ? AND source_id = ?",
    [source, sourceId]
  );

describe("persistDiscoverItems", () => {
  it("gives a TMDB list item a row whose canonical fields come out right", () => {
    const map = persistDiscoverItems([
      item({
        id: "tmdb-movie-693134", type: "movie", title: "Dune: Part Two", releaseDate: "2024-02-27",
        raw: { source: "tmdb", sourceId: "693134", data: TMDB_MOVIE },
      }),
    ]);

    const uuid = map.get("tmdb-movie-693134");
    expect(uuid).toBeTruthy();

    // remergeItem must have understood the native payload — a non-native one
    // would land title "Unknown" and a null poster here.
    const row = get<any>("SELECT title, release_date, poster_url, type FROM media_items WHERE id = ?", [uuid!]);
    expect(row.title).toBe("Dune: Part Two");
    expect(row.release_date).toBe("2024-02-27");
    expect(row.poster_url).toBe("https://image.tmdb.org/t/p/w500/abc.jpg");
    expect(row.type).toBe("movie");
  });

  it("stamps projection_version 0 so the first detail read refetches the real payload", () => {
    persistDiscoverItems([
      item({
        id: "tmdb-movie-693134", type: "movie", title: "Dune: Part Two", releaseDate: "2024-02-27",
        raw: { source: "tmdb", sourceId: "693134", data: TMDB_MOVIE },
      }),
    ]);
    // THE trap: stamping this current would make ensureTmdbDetail treat ~1KB of
    // list data as a full detail blob, and every browsed item's page would
    // render permanently without cast, trailers or where-to-watch.
    expect(linkFor("tmdb", "693134")!.projection_version).toBe(0);
    expect(PROJECTION_VERSION).toBeGreaterThan(0);
  });

  it("indexes the cross-ids so the item is matchable later", () => {
    const map = persistDiscoverItems([
      item({
        id: "tmdb-movie-693134", type: "movie", title: "Dune: Part Two", releaseDate: "2024-02-27",
        raw: { source: "tmdb", sourceId: "693134", data: TMDB_MOVIE },
      }),
    ]);
    const ids = query<{ source: string; external_id: string }>(
      "SELECT source, external_id FROM media_external_ids WHERE media_item_id = ?",
      [map.get("tmdb-movie-693134")!]
    );
    expect(ids).toEqual([{ source: "tmdb", external_id: "693134" }]);
  });

  it("stores a Trakt-payload candidate as a TRAKT link, not as the tmdb one it is labelled", () => {
    // traktToCandidate labels these `source: "tmdb"` (they dedupe against the
    // TMDB pool) while the payload is Trakt's. Storing the payload under "tmdb"
    // would run it through the wrong projector/normalizer and yield no cross-id.
    const map = persistDiscoverItems([
      item({
        id: "tmdb-movie-5555", type: "movie", title: "Anticipated Thing", releaseDate: "2026-09-01",
        raw: { source: "trakt", sourceId: "999", data: TRAKT_MOVIE },
      }),
    ]);
    const uuid = map.get("tmdb-movie-5555")!;

    expect(linkFor("trakt", "999")!.media_item_id).toBe(uuid);
    expect(linkFor("tmdb", "5555")).toBeFalsy();

    // The embedded tmdb id still reaches the index, so a later TMDB link merges
    // onto THIS item instead of creating a duplicate.
    const ids = query<{ source: string; external_id: string }>(
      "SELECT source, external_id FROM media_external_ids WHERE media_item_id = ? ORDER BY source", [uuid]
    );
    expect(ids).toEqual([
      { source: "tmdb", external_id: "5555" },
      { source: "trakt", external_id: "999" },
    ]);
  });

  it("a later TMDB detail write merges onto the browsed Trakt item rather than duplicating it", () => {
    const map = persistDiscoverItems([
      item({
        id: "tmdb-movie-5555", type: "movie", title: "Anticipated Thing", releaseDate: "2026-09-01",
        raw: { source: "trakt", sourceId: "999", data: TRAKT_MOVIE },
      }),
    ]);
    const uuid = map.get("tmdb-movie-5555")!;

    const merged = upsertMediaItem({
      source: "tmdb", sourceId: "5555", type: "movie", title: "Anticipated Thing",
      releaseDate: "2026-09-01",
      rawData: { id: 5555, title: "Anticipated Thing", release_date: "2026-09-01", poster_path: "/z.jpg" },
    });
    expect(merged).toBe(uuid);
    expect(query<{ c: number }>("SELECT COUNT(*) c FROM media_items")[0].c).toBe(1);
  });

  it("NEVER degrades a link that already holds a full detail blob", () => {
    // The item is already in the user's library with a real TMDB payload; a
    // browse pass then sweeps over the same title. A shallow-merge of list junk
    // over the real blob — or a re-stamp — would quietly hollow out the page.
    const rich = { id: 693134, title: "Dune: Part Two", release_date: "2024-02-27", poster_path: "/abc.jpg",
      credits: { cast: [{ name: "Timothée Chalamet" }] }, keywords: { keywords: [{ name: "desert" }] } };
    const existing = upsertMediaItem({
      source: "tmdb", sourceId: "693134", type: "movie", title: "Dune: Part Two",
      releaseDate: "2024-02-27", rawData: rich,
    });
    const before = linkFor("tmdb", "693134")!;

    const map = persistDiscoverItems([
      item({
        id: "tmdb-movie-693134", type: "movie", title: "Dune: Part Two", releaseDate: "2024-02-27",
        raw: { source: "tmdb", sourceId: "693134", data: TMDB_MOVIE },
      }),
    ]);

    // Same item — discover found the row that was already there.
    expect(map.get("tmdb-movie-693134")).toBe(existing);
    const after = linkFor("tmdb", "693134")!;
    expect(after.raw_data).toBe(before.raw_data);
    expect(after.projection_version).toBe(PROJECTION_VERSION);
    expect(JSON.parse(after.raw_data).credits.cast[0].name).toBe("Timothée Chalamet");
  });

  it("handles a RAWG game list payload", () => {
    const map = persistDiscoverItems([
      item({
        id: "rawg-58175", type: "game", title: "Hades II", releaseDate: "2025-05-06",
        raw: { source: "rawg", sourceId: "58175", data: RAWG_GAME },
      }),
    ]);
    const row = get<any>("SELECT title, release_date, poster_url, type FROM media_items WHERE id = ?",
      [map.get("rawg-58175")!]);
    expect(row.title).toBe("Hades II");
    expect(row.type).toBe("game");
    expect(row.poster_url).toBe("https://media.rawg.io/hades2.jpg");
    expect(linkFor("rawg", "58175")!.projection_version).toBe(0);
  });

  it("skips items with no payload or no title instead of inventing a row", () => {
    const map = persistDiscoverItems([
      item({ id: "no-raw", title: "Has Title", raw: null }),
      item({ id: "no-title", title: "", raw: { source: "tmdb", sourceId: "1", data: { id: 1 } } }),
    ]);
    expect(map.size).toBe(0);
    expect(query<{ c: number }>("SELECT COUNT(*) c FROM media_items")[0].c).toBe(0);
  });

  it("is idempotent across repeated browses of the same feed", () => {
    const feed = [
      item({
        id: "tmdb-movie-693134", type: "movie", title: "Dune: Part Two", releaseDate: "2024-02-27",
        raw: { source: "tmdb", sourceId: "693134", data: TMDB_MOVIE },
      }),
    ];
    const first = persistDiscoverItems(feed).get("tmdb-movie-693134");
    const second = persistDiscoverItems(feed).get("tmdb-movie-693134");
    expect(second).toBe(first);
    expect(query<{ c: number }>("SELECT COUNT(*) c FROM media_items")[0].c).toBe(1);
  });
});
