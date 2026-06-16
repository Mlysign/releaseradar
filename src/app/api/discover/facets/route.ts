import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { searchFacets, searchTitles } from "@/lib/discovery";

// Autocomplete for Taste Match: facet pills (kind=tag|person|company) and
// example-title seeds (kind=title), searched against the local catalog vocab.
export const GET = withUser(async (req: NextRequest) => {
  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q") ?? "";
  const kind = searchParams.get("kind");
  if (kind === "title") return NextResponse.json({ matches: searchTitles(q) });
  return NextResponse.json({ matches: searchFacets(q, kind) });
});
