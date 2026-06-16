import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { run, query } from "@/lib/db";

export const POST = withUser(async (req: NextRequest, session) => {
  const { provider } = await req.json();

  if (!provider) return NextResponse.json({ error: "provider required" }, { status: 400 });

  // Must have at least one other identity remaining
  const allIdentities = query(
    "SELECT id, provider FROM user_identities WHERE user_id = ?",
    [session.userId]
  );
  if (allIdentities.length <= 1) {
    return NextResponse.json(
      { error: "Cannot disconnect your only login method" },
      { status: 400 }
    );
  }

  // Remove the identity
  run(
    "DELETE FROM user_identities WHERE user_id = ? AND provider = ?",
    [session.userId, provider]
  );

  // Remove cached release data for this source from watchlist
  // (keep media_items and media_links – they may be shared with other sources)
  // Just remove this provider from platform_sources in watchlist entries
  const watchlistEntries = query<{ id: string; platform_sources: string }>(
    "SELECT id, platform_sources FROM user_watchlist WHERE user_id = ?",
    [session.userId]
  );
  for (const entry of watchlistEntries) {
    const sources: string[] = JSON.parse(entry.platform_sources).filter((s: string) => s !== provider);
    if (sources.length === 0) {
      run("DELETE FROM user_watchlist WHERE id = ?", [entry.id]);
    } else {
      run("UPDATE user_watchlist SET platform_sources = ? WHERE id = ?", [JSON.stringify(sources), entry.id]);
    }
  }

  return NextResponse.json({ ok: true });
});
