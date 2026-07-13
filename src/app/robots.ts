import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/baseUrl";

// P12 — robots policy. Only the public landing page (`/`) has crawlable content;
// every app route is authed + client-rendered (an empty shell to a crawler), so
// keep bots out of them and the API. Points crawlers at the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/discover", "/library", "/insights", "/settings", "/item"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
