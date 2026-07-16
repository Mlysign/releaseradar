import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/baseUrl";
import { PUBLIC_TYPES } from "@/lib/publicUrl";

// P13 — robots policy. The landing page and the public item pages
// (`/{type}/{uuid}/{slug}`) are server-rendered catalog content, meant to be
// indexed. Everything else is authed + client-rendered (an empty shell to a
// crawler), so it stays disallowed along with the API.
//
// `/item` stays disallowed even though it shows the same titles: it's the AUTHED
// interactive view, so a crawler could only ever see it empty, and indexing both
// would be duplicate content. The public page is the canonical one.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", ...PUBLIC_TYPES.map((t) => `/${t}/`)],
      disallow: ["/api/", "/dashboard", "/discover", "/library", "/insights", "/settings", "/item"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
