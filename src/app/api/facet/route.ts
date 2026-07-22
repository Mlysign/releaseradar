import { NextRequest, NextResponse } from "next/server";
import { buildPublicFacetDetail, isFacetSort, PublicFacetRef } from "@/lib/detail/publicFacetDetail";
import { prefixToKind, isFacetPrefix } from "@/lib/facetUrl";
import { getSession } from "@/lib/session";

// P17 — public facet data, paged. Powers the "Load more" / sort controls on the
// public facet pages. Unauthenticated on purpose (same data the SSR page renders,
// just a deeper page). The personal overlay is a SEPARATE authed call
// (/api/facet/mine); nothing user-specific is ever returned here.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const prefix = searchParams.get("prefix");   // "person" | "tag" | "studio"
  const key = searchParams.get("key");         // the normalized facet key
  const page = parseInt(searchParams.get("page") ?? "0", 10);
  const sortParam = searchParams.get("sort");
  const sort = isFacetSort(sortParam) ? sortParam : "popular";

  if (!prefix || !isFacetPrefix(prefix) || !key) {
    return NextResponse.json({ error: "prefix and key are required" }, { status: 400 });
  }

  // PR14: "Load more" is the actual crawl-depth multiplier (page 1, 2, 3…), so
  // this is the more important of the two call sites to gate. Same rule as the
  // SSR build in facetSsr.tsx — only a real session earns a write. getSession()
  // never throws (it catches internally and returns null), so no try/catch here.
  const session = await getSession();
  const ref: PublicFacetRef = { kind: prefixToKind(prefix), key };
  const payload = await buildPublicFacetDetail(ref, { page: Number.isFinite(page) ? page : 0, sort, persist: !!session });
  if (!payload) return NextResponse.json({ error: "unknown facet kind" }, { status: 404 });
  return NextResponse.json(payload);
}
