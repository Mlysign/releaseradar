import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { ignoreItem, unignoreItem } from "@/lib/matcher";

// T10 "For You" feed: mark an item ignored (swipe left) or undo it. The feed
// (find with excludeIgnored) then never surfaces it again.
export const POST = withUser(async (req: NextRequest, session) => {
  const { mediaItemId } = await req.json();
  if (!mediaItemId) return NextResponse.json({ error: "mediaItemId required" }, { status: 400 });
  ignoreItem(session.userId, mediaItemId);
  return NextResponse.json({ ok: true });
});

export const DELETE = withUser(async (req: NextRequest, session) => {
  const { mediaItemId } = await req.json();
  if (!mediaItemId) return NextResponse.json({ error: "mediaItemId required" }, { status: 400 });
  unignoreItem(session.userId, mediaItemId);
  return NextResponse.json({ ok: true });
});
