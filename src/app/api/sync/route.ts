import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { runSync, syncBudgetMs } from "@/lib/sync";
import { parseJsonBody } from "@/lib/validate";
import { SyncPostSchema } from "@/lib/schemas";
import { log } from "@/lib/logger";

export const POST = withUser(async (req: NextRequest, session) => {
  // S8: validate + type the body (P6 sends `provider` for a fresh run or
  // `providers` for a resume). `only` may be a source id or "all".
  const { provider: only, providers } = await parseJsonBody(req, SyncPostSchema, { allowEmpty: true });

  log.info("sync_start", {
    userId: session.userId,
    mode: providers?.length ? "resume" : "fresh",
    provider: only ?? "all",
    providers,
  });

  // Time-budgeted, resumable pass (P6): sync whole providers until the budget is
  // spent, then hand `remaining` back so the client re-invokes in a fresh request
  // instead of one unbounded ~1,700-item request that OOM'd/blocked the 512 MB box.
  const { results, done, remaining } = await runSync(session.userId, {
    only,
    providers,
    budgetMs: syncBudgetMs(),
  });

  log.info("sync_done", { userId: session.userId, done, remaining, results });
  return NextResponse.json({ ok: true, results, done, remaining });
});
