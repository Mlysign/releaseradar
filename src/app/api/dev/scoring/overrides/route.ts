import { NextRequest, NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { setTagCategoryOverride, deleteTagCategoryOverride, listTagCategoryOverrides } from "@/lib/scoringConfig";
import { parseJsonBody } from "@/lib/validate";
import { TagCategoryOverridePostSchema } from "@/lib/schemas";

// POST /api/dev/scoring/overrides — reassign one tag key to a category (the
// taxonomy editor's triage view). buildProfile() reads getTagCategoryOverrides()
// fresh on every call (own cache, signature-invalidated on write) — no need to
// bust the catalog cache too, since VocabEntry doesn't carry category at all.
export const POST = withScoringAdmin(async (req: NextRequest) => {
  const { tagKey, categoryId } = await parseJsonBody(req, TagCategoryOverridePostSchema);
  setTagCategoryOverride(tagKey, categoryId);
  return NextResponse.json({ ok: true, overrides: listTagCategoryOverrides() });
});

// DELETE /api/dev/scoring/overrides?tagKey=... — revert to the code heuristic.
export const DELETE = withScoringAdmin(async (req: NextRequest) => {
  const tagKey = req.nextUrl.searchParams.get("tagKey");
  if (!tagKey) return NextResponse.json({ error: "tagKey required" }, { status: 400 });
  deleteTagCategoryOverride(tagKey);
  return NextResponse.json({ ok: true, overrides: listTagCategoryOverrides() });
});
