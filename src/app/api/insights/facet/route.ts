import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { buildFacetDetail } from "@/lib/facetDetail";
import { FacetRole } from "@/lib/facets";

// Detail for one facet (tag/person/company): catalog items carrying it (+ your
// library state), your average vs the crowd, and a TMDB bio/age for people.
export const GET = withUser(async (req: NextRequest, session) => {
  const { searchParams } = req.nextUrl;
  const kind = searchParams.get("kind");
  const key = searchParams.get("key");
  const label = searchParams.get("label") ?? key ?? "";
  const role = searchParams.get("role") || undefined;
  if (!kind || !key) return NextResponse.json({ error: "kind and key are required" }, { status: 400 });

  const payload = await buildFacetDetail(session.userId, { kind, role: role as FacetRole | undefined, key, label });
  return NextResponse.json(payload);
});
