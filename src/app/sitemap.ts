import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/baseUrl";
import { listPublicItems } from "@/lib/detail/publicDetail";
import { publicItemHref } from "@/lib/publicUrl";

// P13 — sitemap: the landing page plus one entry per public item page.
//
// listPublicItems only returns items that HAVE links, which is exactly what the
// page can render — a linkless item 404s, and a sitemap full of 404s is worse
// than a small sitemap.
//
// Scale: ~2,500 items today vs Google's 50,000-URL / 50 MB per-file limit, so one
// file is fine. If the catalog ever nears that (books/anime would push it), this
// needs splitting — `generateSitemaps` is the Next API for a sitemap index.

// MUST be request-time. sitemap.ts is a Route Handler that Next CACHES BY
// DEFAULT (prerendering it at build), but this one reads SQLite — and during
// `next build` on Railway the volume holding rr.db isn't mounted, so a
// build-time render would bake in a sitemap containing only "/" and never
// update. force-dynamic makes it query the live DB per request, so newly synced
// items appear without a redeploy.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const items = listPublicItems();

  return [
    {
      url: `${BASE_URL}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
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
