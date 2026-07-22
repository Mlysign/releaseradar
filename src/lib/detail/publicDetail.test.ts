import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "@/lib/db";
import { upsertMediaItem, upsertLibraryEntry, upsertWatchlistEntry } from "@/lib/matcher";
import { loadPublicDetail, loadPublicItemRow, listPublicItems } from "./publicDetail";

function seedBrowsedItem(id: string, title: string) {
  run(
    `INSERT INTO media_items (id, type, title, norm_title, browsed) VALUES (?, 'movie', ?, ?, 1)`,
    [id, title, title.toLowerCase()]
  );
  run(
    `INSERT INTO media_links (id, media_item_id, source, source_id, title, raw_data)
     VALUES (?, ?, 'tmdb', ?, ?, '{}')`,
    [`${id}-link`, id, id, title]
  );
}

// P13 — the public detail path is the boundary that makes item pages shareable
// WITHOUT publishing what the owner thinks of them. The catalog (title, poster,
// description, community scores) is public; the user's own rating, review,
// watched status and which platforms they have it on are not.
//
// These seed a user who has rated + reviewed + wishlisted an item, then assert
// the public read exposes the catalog and NOTHING personal.

initDb();

const USER = "u1";

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id, country) VALUES (?, 'DE')", [USER]);
});

function seedRatedMovie() {
  const id = upsertMediaItem({
    source: "tmdb",
    sourceId: "693134",
    type: "movie",
    title: "Dune: Part Two",
    releaseDate: "2024-02-27",
    rawData: {
      id: 693134,
      title: "Dune: Part Two",
      overview: "Paul Atreides unites with the Fremen.",
      release_date: "2024-02-27",
      vote_average: 8.1,
      vote_count: 4200,
    },
  });
  upsertLibraryEntry(USER, id, "tmdb", {
    status: "watched",
    rating: 9.5,
    review: "Private note: the sandworm scene is why I still go to cinemas.",
    reviewedAt: 1719000000,
  });
  upsertWatchlistEntry(USER, id, "tmdb");
  return id;
}

describe("loadPublicDetail — catalog only", () => {
  it("returns the public catalog for a stored item", async () => {
    const id = seedRatedMovie();
    const pub = await loadPublicDetail(id);

    expect(pub).not.toBeNull();
    expect(pub!.id).toBe(id);
    expect(pub!.type).toBe("movie");
    expect(pub!.title).toBe("Dune: Part Two");
    expect(pub!.description).toContain("Fremen");
  });

  it("leaks NO personal fields, even though the user rated and reviewed it", async () => {
    const id = seedRatedMovie();
    const pub = (await loadPublicDetail(id))!;

    // The owner's own take must never reach an anonymous reader.
    for (const key of ["rating", "ratings", "review", "reviewedAt", "libraryStatus", "platformSources"]) {
      expect(pub, `public payload must not carry "${key}"`).not.toHaveProperty(key);
    }
    // Belt-and-braces: the review text must not appear anywhere in the payload.
    expect(JSON.stringify(pub)).not.toContain("Private note");
    expect(JSON.stringify(pub)).not.toContain("sandworm");
  });

  it("still exposes COMMUNITY scores (those are public catalog data)", async () => {
    const id = seedRatedMovie();
    const pub = (await loadPublicDetail(id))!;
    // The user's 9.5 is private; TMDB's 8.1 community score is not.
    expect(JSON.stringify(pub)).not.toContain("9.5");
    expect(pub.communityRatings.some((r) => r.source === "tmdb")).toBe(true);
  });

  it("returns null for an unknown id", async () => {
    expect(await loadPublicDetail("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("returns null for an item with no links to merge", async () => {
    run("INSERT INTO media_items (id, type, title, norm_title) VALUES ('bare', 'movie', 'Bare', 'bare')");
    expect(await loadPublicDetail("bare")).toBeNull();
  });
});

describe("loadPublicItemRow — type guard input", () => {
  it("reports the item's real type so the route can reject a mismatched URL", () => {
    const id = seedRatedMovie();
    expect(loadPublicItemRow(id)!.type).toBe("movie"); // /game/<this-uuid>/x must 404
  });
});

describe("listPublicItems — sitemap source", () => {
  it("lists items that have links", async () => {
    const id = seedRatedMovie();
    const all = listPublicItems();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id, type: "movie", title: "Dune: Part Two" });
  });

  it("omits items with no links (they would 404)", async () => {
    seedRatedMovie();
    run("INSERT INTO media_items (id, type, title, norm_title) VALUES ('bare', 'movie', 'Bare', 'bare')");
    expect(listPublicItems().map((i) => i.id)).not.toContain("bare");
  });

  // PR13 (2026-07-22) — the catalog-pool blowup. Before this, a browsed=1 row
  // (a title someone merely crawled past on a public facet page) was sitemapped
  // exactly like a real catalog entry. At scale that's how the sitemap grew to
  // ~135 MB / 676k URLs against a library of under 2,000.
  it("excludes a browsed-only item even though it has links (not in the pool)", async () => {
    seedRatedMovie();
    seedBrowsedItem("browsed-1", "Crawled Past Me");

    const ids = listPublicItems().map((i) => i.id);
    expect(ids).not.toContain("browsed-1");
  });

  it("still includes a browsed item once a user has acted on it (promoted into the pool)", async () => {
    seedBrowsedItem("browsed-2", "Then I Wishlisted It");
    upsertWatchlistEntry(USER, "browsed-2", "tmdb");

    const ids = listPublicItems().map((i) => i.id);
    expect(ids).toContain("browsed-2");
  });
});
