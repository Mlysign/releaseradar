import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseJsonBody, BadRequestError } from "./validate";
import {
  WatchlistPostSchema,
  LibraryPostSchema,
  RawgLoginSchema,
  DisconnectPostSchema,
  SyncPostSchema,
  FindSchema,
  FacetFetchSchema,
} from "./schemas";

// S8: boundary validation turns a bad request body into a 400 (BadRequestError)
// instead of a 500 / type-confusion deeper in the route.

function jsonReq(body: unknown): Request {
  return new Request("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("parseJsonBody", () => {
  const schema = z.object({ name: z.string(), n: z.number().optional() });

  it("returns the validated, typed body on a valid payload", async () => {
    const data = await parseJsonBody(jsonReq({ name: "ok", n: 3 }), schema);
    expect(data).toEqual({ name: "ok", n: 3 });
  });

  it("throws BadRequestError on a schema mismatch", async () => {
    await expect(parseJsonBody(jsonReq({ name: 123 }), schema)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("strips unknown keys", async () => {
    const data = await parseJsonBody(jsonReq({ name: "ok", junk: "x" }), schema);
    expect(data).toEqual({ name: "ok" });
  });

  it("throws BadRequestError (not a raw SyntaxError) on malformed JSON", async () => {
    const req = new Request("http://test/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    await expect(parseJsonBody(req, schema)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("allowEmpty: an empty/absent body becomes {} and passes an all-optional schema", async () => {
    const optional = z.object({ x: z.string().optional() });
    const req = new Request("http://test/api", { method: "POST" }); // no body → json() throws
    const data = await parseJsonBody(req, optional, { allowEmpty: true });
    expect(data).toEqual({});
  });

  it("without allowEmpty, an absent body is a 400", async () => {
    const req = new Request("http://test/api", { method: "POST" });
    await expect(parseJsonBody(req, schema)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("carries a field-path message but not the offending value", async () => {
    try {
      await parseJsonBody(jsonReq({ name: 123, secretValue: "leak-me" }), schema);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestError);
      const msg = (e as BadRequestError).message;
      expect(msg).toContain("name");
      expect(msg).not.toContain("leak-me");
    }
  });
});

describe("route schemas", () => {
  it("WatchlistPostSchema requires type + ids and enforces the type enum", () => {
    expect(WatchlistPostSchema.safeParse({ type: "movie", ids: { tmdb: 603 } }).success).toBe(true);
    expect(WatchlistPostSchema.safeParse({ ids: { tmdb: 603 } }).success).toBe(false); // no type
    expect(WatchlistPostSchema.safeParse({ type: "book", ids: {} }).success).toBe(false); // bad type
  });

  it("LibraryPostSchema clamps rating to 0..10", () => {
    expect(LibraryPostSchema.safeParse({ mediaItemId: "x", rating: 8 }).success).toBe(true);
    expect(LibraryPostSchema.safeParse({ mediaItemId: "x", rating: null }).success).toBe(true);
    expect(LibraryPostSchema.safeParse({ mediaItemId: "x", rating: 42 }).success).toBe(false);
    expect(LibraryPostSchema.safeParse({ mediaItemId: "x", rating: -1 }).success).toBe(false);
  });

  it("RawgLoginSchema requires non-empty email + password", () => {
    expect(RawgLoginSchema.safeParse({ email: "a@b.c", password: "pw" }).success).toBe(true);
    expect(RawgLoginSchema.safeParse({ email: "", password: "pw" }).success).toBe(false);
    expect(RawgLoginSchema.safeParse({ email: "a@b.c" }).success).toBe(false);
  });

  it("DisconnectPostSchema requires a known source provider", () => {
    expect(DisconnectPostSchema.safeParse({ provider: "trakt" }).success).toBe(true);
    expect(DisconnectPostSchema.safeParse({ provider: "myspace" }).success).toBe(false);
    expect(DisconnectPostSchema.safeParse({}).success).toBe(false);
  });

  it("SyncPostSchema accepts a source or 'all' or nothing", () => {
    expect(SyncPostSchema.safeParse({}).success).toBe(true);
    expect(SyncPostSchema.safeParse({ provider: "all" }).success).toBe(true);
    expect(SyncPostSchema.safeParse({ provider: "steam" }).success).toBe(true);
    expect(SyncPostSchema.safeParse({ provider: "nope" }).success).toBe(false);
  });

  it("FindSchema is lenient (empty ok) but rejects a bad sort key", () => {
    expect(FindSchema.safeParse({}).success).toBe(true);
    expect(FindSchema.safeParse({ q: "matrix", sort: "match" }).success).toBe(true);
    expect(FindSchema.safeParse({ sort: "sideways" }).success).toBe(false);
  });

  it("FacetFetchSchema defaults a missing facet label to an empty string", () => {
    const parsed = FacetFetchSchema.parse({ facets: [{ kind: "person", key: "nolan" }] });
    expect(parsed.facets?.[0].label).toBe("");
  });
});
