// H5.4 D5 — env user-ID allowlist gate for /dev/scoring and its API routes.
// No schema change; SCORING_ADMIN_USER_IDS is a comma-separated list of
// users.id values (see .env.example). Unset → nobody is admin (fails closed).

import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { SessionUser } from "@/types";

export function isScoringAdmin(userId: string): boolean {
  const raw = process.env.SCORING_ADMIN_USER_IDS;
  if (!raw) return false;
  return raw.split(",").map((s) => s.trim()).filter(Boolean).includes(userId);
}

// Same shape as withUser, plus the admin check. A non-admin gets 404, not 403
// — the route's existence isn't something a normal user needs to know about.
export function withScoringAdmin<A extends unknown[]>(
  handler: (req: NextRequest, session: SessionUser, ...rest: A) => Promise<Response> | Response,
) {
  return withUser<A>(async (req, session, ...rest) => {
    if (!isScoringAdmin(session.userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return handler(req, session, ...rest);
  });
}
