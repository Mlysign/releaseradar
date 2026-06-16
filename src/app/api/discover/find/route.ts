import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { find, FindRequest } from "@/lib/discovery";

// Taste Match — rank the whole local catalog by the user's preference profile
// (refined with seeds + like/dislike pills), with filters + sort. POST body is a
// FindRequest; see src/lib/discovery.ts.
export const POST = withUser(async (req: NextRequest, session) => {
  const body = (await req.json().catch(() => ({}))) as FindRequest;
  return NextResponse.json(find(session.userId, body));
});
