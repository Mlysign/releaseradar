import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { topPositiveTagKeys, invalidateDiscoveryCache } from "@/lib/discovery";
import { ingestCandidatesForTags } from "@/lib/recommendIngest";
import { parseJsonBody } from "@/lib/validate";
import { FetchMoreSchema } from "@/lib/schemas";

// Grow the local catalog: take the user's strongest preference tags (profile +
// any active seeds), pull fresh matching titles from TMDB/RAWG, persist them,
// and invalidate the candidate cache so they appear in the next find().
export const POST = withUser(async (req: NextRequest, session) => {
  const body = await parseJsonBody(req, FetchMoreSchema, { allowEmpty: true });
  const tagKeys = topPositiveTagKeys(session.userId, body.refine, 8);
  const result = await ingestCandidatesForTags(tagKeys);
  if (result.ingested > 0) invalidateDiscoveryCache();
  return NextResponse.json(result);
});
