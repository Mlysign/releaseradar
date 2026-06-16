import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, query } from "./db";
import { upsertMediaItem } from "./matcher";

// findMatchingItem is internal — exercised through upsertMediaItem, which is the
// real entry point sync/refresh use. These lock in the cross-id false-merge fix:
// same-title/same-era works stay separate unless a shared cross-id proves identity.
//
// NOTE: rawData must carry the source's own title (trakt/tmdb: `title`, rawg/
// letterboxd: `name`/…) — remergeItem recomputes the canonical title/norm_title
// FROM rawData, and an empty rawData would collapse it to "Unknown".

initDb();

beforeEach(() => {
  // Fresh canonical graph per test (cascade clears media_links). The in-memory db
  // from vitest.config is shared within this file, so reset between cases.
  run("DELETE FROM media_items");
});

const movie = (source: any, sourceId: string, title: string, releaseDate: string, rawData: any) =>
  upsertMediaItem({ source, sourceId, type: "movie", title, releaseDate, rawData });

describe("upsertMediaItem / findMatchingItem", () => {
  it("keeps two distinct same-title, same-year movies separate (different tmdb ids)", () => {
    const a = movie("trakt", "111", "Zilch", "2025-01-01", { ids: { trakt: 111, tmdb: 1001 }, title: "Zilch", released: "2025-01-01" });
    const b = movie("trakt", "222", "Zilch", "2025-06-01", { ids: { trakt: 222, tmdb: 2002 }, title: "Zilch", released: "2025-06-01" });
    expect(a).not.toBe(b);
    expect(query<{ c: number }>("SELECT COUNT(*) c FROM media_items WHERE norm_title='zilch'")[0].c).toBe(2);
  });

  it("merges a TMDB link onto the item carrying that embedded tmdb id (not its same-title sibling)", () => {
    const a = movie("trakt", "111", "Zilch", "2025-01-01", { ids: { trakt: 111, tmdb: 1001 }, title: "Zilch", released: "2025-01-01" });
    const b = movie("trakt", "222", "Zilch", "2025-06-01", { ids: { trakt: 222, tmdb: 2002 }, title: "Zilch", released: "2025-06-01" });
    const t1 = movie("tmdb", "1001", "Zilch", "2025-01-01", { id: 1001, title: "Zilch", release_date: "2025-01-01" });
    const t2 = movie("tmdb", "2002", "Zilch", "2025-06-01", { id: 2002, title: "Zilch", release_date: "2025-06-01" });
    expect(t1).toBe(a);
    expect(t1).not.toBe(b);
    expect(t2).toBe(b);
  });

  it("merges a Letterboxd link via its embedded tmdb cross-ref", () => {
    const a = movie("trakt", "111", "Zilch", "2025-01-01", { ids: { trakt: 111, tmdb: 1001 }, title: "Zilch", released: "2025-01-01" });
    const lb = movie("letterboxd", "zilch", "Zilch", "2025-01-01", { id: "zilch", name: "Zilch", links: [{ type: "tmdb", id: 1001 }] });
    expect(lb).toBe(a);
    const links = query<{ source: string }>("SELECT source FROM media_links WHERE media_item_id=?", [a]).map((l) => l.source).sort();
    expect(links).toEqual(["letterboxd", "trakt"]);
  });

  it("re-syncing the same source link updates in place (no duplicate link/item)", () => {
    const a = movie("trakt", "111", "Zilch", "2025-01-01", { ids: { trakt: 111, tmdb: 1001 }, title: "Zilch" });
    const again = movie("trakt", "111", "Zilch (Director's Cut)", "2025-01-01", { ids: { trakt: 111, tmdb: 1001 }, title: "Zilch (Director's Cut)" });
    expect(again).toBe(a);
    expect(query<{ c: number }>("SELECT COUNT(*) c FROM media_links WHERE source='trakt' AND source_id='111'")[0].c).toBe(1);
  });

  it("falls back to title+year when neither item carries a conflicting cross-id", () => {
    // Two DIFFERENT source links, both without cross-ids, same title + same year →
    // no id conflict, so the title+year fallback merges them onto one item.
    const a = movie("trakt", "111", "Solo", "2018-01-01", { title: "Solo", released: "2018-01-01" });
    const b = movie("trakt", "112", "Solo", "2018-05-01", { title: "Solo", released: "2018-05-01" });
    expect(b).toBe(a);
    expect(query<{ c: number }>("SELECT COUNT(*) c FROM media_items WHERE norm_title='solo'")[0].c).toBe(1);
  });

  it("does NOT merge same-title items when years are >1 apart (and no shared id)", () => {
    const a = movie("trakt", "111", "Solo", "1996-01-01", { title: "Solo", released: "1996-01-01" });
    const b = movie("trakt", "112", "Solo", "2018-01-01", { title: "Solo", released: "2018-01-01" });
    expect(b).not.toBe(a);
  });

  it("treats different media types with the same title as different items", () => {
    const mv = upsertMediaItem({ source: "tmdb", sourceId: "9", type: "movie", title: "Control", releaseDate: "2019-01-01", rawData: { id: 9, title: "Control", release_date: "2019-01-01" } });
    const gm = upsertMediaItem({ source: "rawg", sourceId: "9", type: "game", title: "Control", releaseDate: "2019-08-27", rawData: { id: 9, name: "Control", released: "2019-08-27" } });
    expect(mv).not.toBe(gm);
  });

  // D9: a later list-payload sync must NOT clobber detail-only fields (dev/pub)
  // that a prior detail fetch persisted — otherwise game studio data is lost every
  // sync. mergeRawData shallow-merges new over old, keeping keys the new omits.
  it("preserves detail-only fields when a sparser payload re-syncs (merge-preserve)", () => {
    const detail = { id: 50, name: "Hades", released: "2020-09-17", developers: [{ name: "Supergiant Games" }], publishers: [{ name: "Supergiant Games" }] };
    const id = upsertMediaItem({ source: "rawg", sourceId: "50", type: "game", title: "Hades", releaseDate: "2020-09-17", rawData: detail });
    // Re-sync with the list payload (no developers/publishers, adds playtime).
    upsertMediaItem({ source: "rawg", sourceId: "50", type: "game", title: "Hades", releaseDate: "2020-09-17", rawData: { id: 50, name: "Hades", released: "2020-09-17", playtime: 20 } });

    const raw = JSON.parse(query<{ raw_data: string }>("SELECT raw_data FROM media_links WHERE media_item_id=? AND source='rawg'", [id])[0].raw_data);
    expect(raw.developers?.[0]?.name).toBe("Supergiant Games"); // preserved
    expect(raw.publishers?.[0]?.name).toBe("Supergiant Games"); // preserved
    expect(raw.playtime).toBe(20);                              // fresh field applied
  });
});
