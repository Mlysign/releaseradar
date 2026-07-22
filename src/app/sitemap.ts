import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/baseUrl";
import { listPublicItems } from "@/lib/detail/publicDetail";
import { publicItemHref, PUBLIC_ITEMS_INDEXABLE } from "@/lib/publicUrl";

// P13 — sitemap: the landing page plus one entry per public item page.
//
// listPublicItems only returns items that HAVE links, which is exactly what the
// page can render — a linkless item 404s, and a sitemap full of 404s is worse
// than a small sitemap. As of PR13 (2026-07-22) it's also scoped to the catalog
// POOL, not every row in media_items — see the comment on listPublicItems for
// why that distinction is now load-bearing (a public facet page's browsed-but-
// unowned titles are not catalog entries and must not be advertised for crawl).
//
// Scale: the pool is a couple thousand items vs Google's 50,000-URL / 50 MB
// per-file limit, so one file is fine. If the catalog ever nears that
// (books/anime would push it), this needs splitting — `generateSitemaps` is the
// Next API for a sitemap index.

// MUST be request-time. sitemap.ts is a Route Handler that Next CACHES BY
// DEFAULT (prerendering it at build), but this one reads SQLite — and during
// `next build` on Railway the volume holding rr.db isn't mounted, so a
// build-time render would bake in a sitemap containing only "/" and never
// update. force-dynamic makes it query the live DB per request, so newly synced
// items appear without a redeploy.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const landing: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  // Soft launch (PUBLIC_ITEMS_INDEXABLE=false): pages stay readable + unfurlable,
  // but listing them here would be handing Google an enumeration of the owner's
  // library — the exact thing the soft launch defers. Pages also send `noindex`.
  // Flip the flag to enumerate all ~2,500 (TASKS.md P13b).
  if (!PUBLIC_ITEMS_INDEXABLE) return landing;

  const items = listPublicItems();

  return [
    ...landing,
    ...items.map((i) => ({
      url: `${BASE_URL}${publicItemHref(i)}`,
      // last_synced is when we last refreshed this item — the closest honest
      // "changed at" signal available.
      lastModified: i.updatedAt ? new Date(i.updatedAt * 1000) : undefined,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
