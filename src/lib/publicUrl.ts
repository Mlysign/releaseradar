import { MediaType } from "@/types";

// P13 — public, shareable, crawlable item URLs: `/{type}/{uuid}/{slug}`
//
//   /movie/3f9a2b1c-77d4-4e21-9c3a-8b1e5d2f6a04/dune-part-two
//
// The UUID is the ONLY identity — the slug is cosmetic. That split is the whole
// point of the shape: titles change and collide (remakes, same-named games), so
// resolving on a slug would either break shared links or need a redirect table.
// Here a stale or wrong slug still resolves; the page just canonical-redirects
// to the current one, so old links keep working forever.
//
// Only 3-segment paths match this route, so it cannot collide with the 1-segment
// app routes (/dashboard, /library, …) or 2-segment ones (/insights/facet).

export const PUBLIC_TYPES: MediaType[] = ["movie", "show", "game"];

export function isPublicType(t: string): t is MediaType {
  return (PUBLIC_TYPES as string[]).includes(t);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

// Combining diacritical marks (U+0300–U+036F), left behind by NFKD decomposition.
// Built via RegExp so the source carries readable escapes instead of invisible
// combining characters, which editors and tooling love to mangle.
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

// Title → URL slug. Decomposes then strips accents so "Amélie" → "amelie"
// rather than "amlie".
//
// Always returns a non-empty string: a title that is pure punctuation or
// non-Latin script (e.g. "君の名は。") would otherwise slugify to "", producing
// a `//` path that no longer matches the 3-segment route. The slug is cosmetic
// — the UUID resolves the page — so "untitled" is a safe floor.
export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/['’]/g, "")  // keep contractions whole: "don't" → "dont"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");       // re-trim: the length cut can leave a trailing "-"
  return s || "untitled";
}

export function publicItemHref(item: { id: string; type: string; title?: string | null }): string {
  return `/${item.type}/${item.id}/${slugify(item.title ?? "untitled")}`;
}
