import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { SessionUser } from "@/types";

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
    try {
      return await handler(req, session, ...rest);
    } catch (e) {
      const path = (() => { try { return new URL(req.url).pathname; } catch { return req.url; } })();
      console.error(`[api] ${req.method} ${path}:`, e);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  };
}
