import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { find } from "@/lib/discovery";
import { parseJsonBody } from "@/lib/validate";
import { FindSchema } from "@/lib/schemas";

// Taste Match — rank the whole local catalog by the user's preference profile
// (refined with seeds + like/dislike pills), with filters + sort. POST body is a
// FindRequest; see src/lib/discovery.ts.
export const POST = withUser(async (req: NextRequest, session) => {
  const body = await parseJsonBody(req, FindSchema, { allowEmpty: true });
  return NextResponse.json(find(session.userId, body));
});
