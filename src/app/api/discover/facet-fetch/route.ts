import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { buildFacetDetail, FacetDetailItem } from "@/lib/facetDetail";
import { parseJsonBody } from "@/lib/validate";
import { FacetFetchSchema } from "@/lib/schemas";

// T24/T5 — when a must-include facet is active in search, pull its full external
// set from the databases (e.g. a person's TMDB filmography, a studio's catalog)
// so search isn't limited to locally-ingested titles. Reuses the same pull that
// powers the facet detail page. Multiple include facets are UNIONed (the local
// find() results still enforce strict AND; this is the "More from the databases"
// supplement). Type filter applied if given.
export const POST = withUser(async (req: NextRequest, session) => {
  const body = await parseJsonBody(req, FacetFetchSchema);
  const facets = (body.facets ?? []).filter((f) => f.kind && f.key);
  if (facets.length === 0) return NextResponse.json({ items: [] });

  const types = body.types ?? [];
  const seen = new Set<string>();
  const out: FacetDetailItem[] = [];
  // Sequential to be gentle on the external APIs (each facet pull fans out already).
  for (const f of facets) {
    const detail = await buildFacetDetail(session.userId, f);
    for (const it of detail.items) {
      if (types.length && !types.includes(it.type)) continue;
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
  }
  return NextResponse.json({ items: out });
});
