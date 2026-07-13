import type { NextConfig } from "next";

// S6 — the resource-restricting CSP, shipped in Report-Only first: the browser
// logs violations to the console but blocks nothing, so a wrong value can't
// blank-screen the app (the memory's warning). Once the deployed app is confirmed
// violation-free, promote this value to the enforcing `Content-Security-Policy`
// header (replacing the frame-ancestors-only policy below) and drop this one.
const CSP_RESOURCE_POLICY = [
  "default-src 'self'",
  // Next injects inline bootstrap/hydration scripts (no nonce by default).
  "script-src 'self' 'unsafe-inline'",
  // Tailwind's sheet is same-origin; next/font + inline style="" attributes need inline.
  "style-src 'self' 'unsafe-inline'",
  // Optimized posters come from /_next/image (self); the detail-page hero <img>
  // loads raw from the poster CDNs. data:/blob: cover inline/placeholder data.
  "img-src 'self' data: blob: https://image.tmdb.org https://media.rawg.io https://images.igdb.com https://cdn.akamai.steamstatic.com https://shared.fastly.steamstatic.com https://*.steamstatic.com",
  "font-src 'self'",
  // The client only calls its own /api (same origin).
  "connect-src 'self'",
  // The only third-party embed is the YouTube trailer iframe.
  "frame-src https://www.youtube.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Self-host build: emit `.next/standalone` (a minimal server.js + only the
  // traced node_modules) so the Docker runtime image stays small and needs no
  // `npm install`. See Dockerfile. server.js honors PORT/HOSTNAME (Railway sets PORT).
  output: "standalone",
  // better-sqlite3 loads a compiled native addon (.node) that @vercel/nft's static
  // trace can miss → force it into the standalone bundle so the server can open the DB.
  outputFileTracingIncludes: {
    "/**": ["node_modules/better-sqlite3/build/Release/*.node"],
  },
  turbopack: { root: __dirname },
  images: {
    // Must cover every host sanitizePosterUrl() (S12) admits — an un-listed host
    // makes next/image throw at render, not just fail to load. Kept in sync with
    // that allowlist: tmdb / rawg / igdb / steamstatic (+ the two steam CDNs).
    remotePatterns: [
      { protocol: "https", hostname: "cdn.akamai.steamstatic.com" },
      { protocol: "https", hostname: "shared.fastly.steamstatic.com" },
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "media.rawg.io" },
      { protocol: "https", hostname: "images.igdb.com" },
      { protocol: "https", hostname: "*.steamstatic.com" },
    ],
  },
  // S6 (partial): the security headers that can't break rendering — sniffing,
  // clickjacking, referrer leakage, transport security, and powerful-feature
  // gating. Deliberately NOT shipping the resource-restricting CSP directives
  // (script-src/style-src/img-src) yet: a slightly-wrong value blank-screens the
  // app, and that needs live browser verification. The CSP here carries only
  // `frame-ancestors` (clickjacking) which restricts no resource loads.
  // Permissions-Policy restricts only features the app never uses — autoplay/
  // encrypted-media are left permitted so the YouTube trailer embed keeps working.
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    // Observe (don't enforce) the full resource policy, and only in production:
    // dev's HMR websocket + eval would spam violations and isn't what we're
    // validating. Promote CSP_RESOURCE_POLICY to the enforcing header once the
    // deployed app reports no violations.
    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({ key: "Content-Security-Policy-Report-Only", value: CSP_RESOURCE_POLICY });
    }
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
