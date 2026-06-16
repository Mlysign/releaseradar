import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { syncProviders } from "@/lib/sync";

export const POST = withUser(async (req: NextRequest, session) => {
  const body = await req.json().catch(() => ({ provider: "all" }));
  const { provider } = body;

  console.log(`[sync] Starting sync for user ${session.userId}, provider: ${provider ?? "all"}`);

  // One generic pass over the registered providers — each pulls its wishlist +
  // library through its adapter. Provider may be "all" or a specific source id.
  const results = await syncProviders(session.userId, provider);

  console.log("[sync] Done:", JSON.stringify(results));
  return NextResponse.json({ ok: true, results });
});
