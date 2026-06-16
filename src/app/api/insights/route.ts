import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { buildInsights } from "@/lib/insights";

// Library analytics — aggregates the user's rated library into rating
// distribution, tag/people/company stats, and the extra (you-vs-crowd / by-era)
// breakdowns. All computed on the fly over user_library (cached per library
// signature in libraryAnalysis).
export const GET = withUser(async (_req, session) => {
  return NextResponse.json(buildInsights(session.userId));
});
