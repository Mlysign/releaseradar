// Public origin for building absolute URLs (SEO metadata, sitemap, robots).
// config.ts requires NEXT_PUBLIC_BASE_URL in prod; the localhost fallback keeps
// `next build` and local dev working when it's unset. Trailing slash trimmed so
// callers can safely template `${BASE_URL}/path`.
export const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
