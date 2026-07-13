import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { enforceRateLimit } from "@/lib/rateLimit";
import { BadRequestError } from "@/lib/validate";
import { SessionUser } from "@/types";

// Per-user cap across all authed routes (S3/P7). These routes proxy third-party
// APIs with our keys, so this blunts a single account draining TMDB/RAWG quota.
// Generous enough not to bother normal infinite-scroll/facet bursts (~5/s).
const USER_LIMIT = 300;
const USER_WINDOW_MS = 60_000;

// Uniform auth + error handling for API routes (A6). Wrap a handler so every
// route gets the same behavior in one place instead of the copy-pasted
// `try { const session = await requireSession() … } catch (Unauthorized→401/…→500)`:
//   export const POST = withUser(async (req, session) => { … });
// The handler receives the authenticated session; throwing inside it becomes a
// logged 500. Any trailing route-context args (dynamic params) pass through.
export function withUser<A extends unknown[]>(
  handler: (req: NextRequest, session: SessionUser, ...rest: A) => Promise<Response> | Response,
) {
  return async (req: NextRequest, ...rest: A): Promise<Response> => {
    let session: SessionUser;
    try {
      session = await requireSession();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const limited = enforceRateLimit(`user:${session.userId}`, USER_LIMIT, USER_WINDOW_MS);
    if (limited) return limited;
    try {
      return await handler(req, session, ...rest);
    } catch (e) {
      // S8: schema-validation failures are the caller's fault → 400, not 500.
      if (e instanceof BadRequestError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      const path = (() => { try { return new URL(req.url).pathname; } catch { return req.url; } })();
      console.error(`[api] ${req.method} ${path}:`, e);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  };
}
