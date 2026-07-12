import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { runSync, syncBudgetMs } from "@/lib/sync";

export const POST = withUser(async (req: NextRequest, session) => {
  const body = await req.json().catch(() => ({}));
  const only: string | undefined = typeof body?.provider === "string" ? body.provider : undefined;
  const providers: string[] | undefined = Array.isArray(body?.providers)
    ? body.providers.filter((p: unknown): p is string => typeof p === "string")
    : undefined;

  console.log(
    `[sync] user ${session.userId} · ${providers?.length ? `resume [${providers.join(",")}]` : `provider ${only ?? "all"}`}`,
  );

  // Time-budgeted, resumable pass (P6): sync whole providers until the budget is
  // spent, then hand `remaining` back so the client re-invokes in a fresh request
  // instead of one unbounded ~1,700-item request that OOM'd/blocked the 512 MB box.
  const { results, done, remaining } = await runSync(session.userId, {
    only,
    providers,
    budgetMs: syncBudgetMs(),
  });

  console.log(`[sync] done=${done} remaining=[${remaining.join(",")}]`, JSON.stringify(results));
  return NextResponse.json({ ok: true, results, done, remaining });
});
