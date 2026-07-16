import { describe, it, expect } from "vitest";
import { slugify, publicItemHref, isPublicType, isUuid } from "./publicUrl";

// P13 — the slug is cosmetic (the UUID resolves the page), but it still has to
// produce a path that MATCHES the 3-segment route. An empty slug would yield
// `/movie/<uuid>/` and 404, so slugify must never return "".

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Dune: Part Two")).toBe("dune-part-two");
  });

  it("strips accents rather than dropping the letter", () => {
    expect(slugify("Amélie")).toBe("amelie");
    expect(slugify("Spider-Man: Into the Spider-Verse")).toBe("spider-man-into-the-spider-verse");
  });

  it("keeps contractions whole", () => {
    expect(slugify("Don't Look Up")).toBe("dont-look-up");
    expect(slugify("Don’t Look Up")).toBe("dont-look-up"); // typographic apostrophe
  });

  it("never returns an empty slug for non-Latin or punctuation-only titles", () => {
    expect(slugify("君の名は。")).toBe("untitled");
    expect(slugify("!!!")).toBe("untitled");
    expect(slugify("")).toBe("untitled");
  });

  it("trims to a bounded length without leaving a trailing hyphen", () => {
    const s = slugify("A".repeat(50) + " " + "B".repeat(50));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith("-")).toBe(false);
  });

  it("collapses runs of separators", () => {
    expect(slugify("Rick & Morty  --  Season 1")).toBe("rick-morty-season-1");
  });
});

describe("publicItemHref", () => {
  it("builds /{type}/{uuid}/{slug}", () => {
    expect(publicItemHref({ id: "abc-123", type: "movie", title: "Dune: Part Two" }))
      .toBe("/movie/abc-123/dune-part-two");
  });

  it("still produces a 3-segment path when the title is missing", () => {
    expect(publicItemHref({ id: "abc-123", type: "game", title: null }))
      .toBe("/game/abc-123/untitled");
  });
});

describe("route guards", () => {
  it("accepts only real media types", () => {
    expect(isPublicType("movie")).toBe(true);
    expect(isPublicType("show")).toBe(true);
    expect(isPublicType("game")).toBe(true);
    expect(isPublicType("api")).toBe(false);
    expect(isPublicType("dashboard")).toBe(false);
  });

  it("validates uuids", () => {
    expect(isUuid("3f9a2b1c-77d4-4e21-9c3a-8b1e5d2f6a04")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("../../etc/passwd")).toBe(false);
  });
});
