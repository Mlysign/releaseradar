import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/baseUrl";

// P12 — sitemap. The app is auth-gated and client-rendered, so the landing page
// is the only page with indexable content. (Public, crawlable detail pages are a
// P13 follow-up — they need SSR + clean route URLs first.)
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${BASE_URL}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
