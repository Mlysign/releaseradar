import { NextRequest, NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { getTagVocab } from "@/lib/discovery";
import { getTagCategoryOverrides } from "@/lib/scoringConfig";
import { categorizeTag } from "@/lib/tags";

// GET /api/dev/scoring/vocab?category=other&limit=100 — the taxonomy editor's
// triage view: every catalog tag, its resolved category (override-aware) and
// whether that's an override, sorted by frequency. `category` narrows to one
// bucket (the doc's example use case: "high-frequency tags falling into
// other"); omit for the full list.
export const GET = withScoringAdmin(async (req: NextRequest) => {
  const category = req.nextUrl.searchParams.get("category");
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 200, 1), 1000);

  const overrides = getTagCategoryOverrides();
  const rows = getTagVocab().map((v) => {
    const overridden = overrides.get(v.key);
    return {
      key: v.key,
      label: v.label,
      count: v.count,
      category: overridden ?? categorizeTag(v.key),
      overridden: !!overridden,
    };
  });

  const filtered = category ? rows.filter((r) => r.category === category) : rows;
  return NextResponse.json({ tags: filtered.slice(0, limit), total: filtered.length });
});
