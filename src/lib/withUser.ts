import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { enforceRateLimit } from "@/lib/rateLimit";
import { BadRequestError } from "@/lib/validate";
import { log, errorFields } from "@/lib/logger";
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
    const path = (() => { try { return new URL(req.url).pathname; } catch { return req.url; } })();
    try {
      return await handler(req, session, ...rest);
    } catch (e) {
      // S8: schema-validation failures are the caller's fault → 400, not 500.
      if (e instanceof BadRequestError) {
        // P9: warn (not error) — client fault, but worth surfacing for abuse/bad clients.
        log.warn("api_bad_request", { method: req.method, path, userId: session.userId, error: e.message });
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      // P9: structured error log on the 500 funnel (method/path/user + error/stack).
      log.error("api_error", { method: req.method, path, userId: session.userId, ...errorFields(e) });
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  };
}
