import { NextRequest, NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { getScoringConfig, saveScoringConfig, getTagCategories, listTagCategoryOverrides } from "@/lib/scoringConfig";
import { parseJsonBody } from "@/lib/validate";
import { ScoringConfigPutSchema } from "@/lib/schemas";

// GET /api/dev/scoring — the Weights & tuning panel's initial state.
export const GET = withScoringAdmin(async () => {
  return NextResponse.json({
    config: getScoringConfig(),
    categories: getTagCategories(),
    overrides: listTagCategoryOverrides(),
  });
});

// PUT /api/dev/scoring — save role weights + C/K/cap (§5 "Weights & tuning").
// Category weights save separately (POST /api/dev/scoring/categories) since
// they live in tag_category, not scoring_config.
export const PUT = withScoringAdmin(async (req: NextRequest) => {
  const body = await parseJsonBody(req, ScoringConfigPutSchema);
  saveScoringConfig(body);
  return NextResponse.json({ ok: true, config: getScoringConfig() });
});
