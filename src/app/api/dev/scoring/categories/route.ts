import { NextRequest, NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { saveTagCategory, saveCategoryWeights, deleteTagCategory, getTagCategories } from "@/lib/scoringConfig";
import { parseJsonBody } from "@/lib/validate";
import { TagCategoryPostSchema, TagCategoryWeightsPutSchema } from "@/lib/schemas";

// POST /api/dev/scoring/categories — the Taxonomy editor's category CRUD
// (create a new category, or edit an existing one's label/color/weight/ignored).
export const POST = withScoringAdmin(async (req: NextRequest) => {
  const body = await parseJsonBody(req, TagCategoryPostSchema);
  saveTagCategory(body);
  return NextResponse.json({ ok: true, categories: getTagCategories() });
});

// PUT /api/dev/scoring/categories — the Weights panel's batch weight/ignored
// save (label/color/id untouched, unlike POST above).
export const PUT = withScoringAdmin(async (req: NextRequest) => {
  const { updates } = await parseJsonBody(req, TagCategoryWeightsPutSchema);
  saveCategoryWeights(updates);
  return NextResponse.json({ ok: true, categories: getTagCategories() });
});

// DELETE /api/dev/scoring/categories?id=xyz — any tag reassigned to this
// category (tag_category_override) cascades away with it, falling back to
// categorizeTag()'s code heuristic.
export const DELETE = withScoringAdmin(async (req: NextRequest) => {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteTagCategory(id);
  return NextResponse.json({ ok: true, categories: getTagCategories() });
});
