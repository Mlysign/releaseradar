import { NextRequest, NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { get } from "@/lib/db";
import { mergeLinks } from "@/lib/merge";
import { getUserCountry } from "@/lib/userCountry";
import { extractFacets } from "@/lib/facets";
import { buildProfile, computeFandexScore, MIN_RATED_FOR_FANDEX_SCORE } from "@/lib/discovery";
import { loadLinks } from "@/lib/detail/enrich";
import { parseJsonBody } from "@/lib/validate";
import { ScoringPreviewSchema } from "@/lib/schemas";
import { MediaType } from "@/types";

// POST /api/dev/scoring/preview — the Weights panel's "Preview" button.
// Scores ONE sample item (the admin's own top-rated library item, unless
// `itemId` picks a different one) against the admin's OWN rated-library
// profile, but built from the DRAFT weights in the request body rather than
// the persisted scoring_config/tag_category rows — nothing is saved.
export const POST = withScoringAdmin(async (req: NextRequest, session) => {
  const body = await parseJsonBody(req, ScoringPreviewSchema);

  const itemRow = body.itemId
    ? get<{ id: string; title: string; type: string }>(
        `SELECT mi.id, mi.title, mi.type FROM media_items mi
         JOIN user_library ul ON ul.media_item_id = mi.id
         WHERE mi.id = ? AND ul.user_id = ?`,
        [body.itemId, session.userId]
      )
    : get<{ id: string; title: string; type: string }>(
        `SELECT mi.id, mi.title, mi.type FROM user_library ul
         JOIN media_items mi ON mi.id = ul.media_item_id
         WHERE ul.user_id = ? AND ul.rating IS NOT NULL
         ORDER BY ul.rating DESC, ul.reviewed_at DESC LIMIT 1`,
        [session.userId]
      );

  if (!itemRow) {
    return NextResponse.json({ error: "No rated library item to preview against yet — rate something first." }, { status: 400 });
  }

  const itemType = itemRow.type as MediaType;
  const links = loadLinks(itemRow.id);
  const merged = mergeLinks(links, itemType, getUserCountry(session.userId));
  const facets = extractFacets(links, itemType, merged);

  const categoryWeights = new Map(body.categoryWeights.map((c) => [c.id, { weight: c.weight, ignored: c.ignored }]));
  const profile = buildProfile(session.userId, { config: body.config, categoryWeights });
  const result = computeFandexScore(facets, profile, body.config);

  return NextResponse.json({
    itemId: itemRow.id,
    itemTitle: itemRow.title,
    score: result?.score ?? null,
    reasons: result?.reasons ?? [],
    coldStart: profile.ratedItemCount < MIN_RATED_FOR_FANDEX_SCORE,
  });
});
