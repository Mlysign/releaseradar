import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { run, query } from "@/lib/db";
import { createSession, setSessionCookie, bumpSessionEpoch } from "@/lib/session";
import { Source } from "@/types";
import { parseJsonBody } from "@/lib/validate";
import { DisconnectPostSchema } from "@/lib/schemas";

export const POST = withUser(async (req: NextRequest, session) => {
  const { provider } = await parseJsonBody(req, DisconnectPostSchema);

  // Must have at least one other identity remaining
  const allIdentities = query<{ id: string; provider: string; display_name: string | null }>(
    "SELECT id, provider, display_name FROM user_identities WHERE user_id = ?",
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

  // Revoke every outstanding token for this user (S4) — in particular any session
  // minted from the identity we just removed. Then re-issue a fresh cookie for
  // THIS device against a still-connected identity, so disconnecting a provider
  // doesn't log the acting user out (but any OTHER devices are signed out).
  bumpSessionEpoch(session.userId);
  const remaining = allIdentities.find((i) => i.provider !== provider) ?? allIdentities[0];
  const token = await createSession({
    userId: session.userId,
    identityId: remaining.id,
    provider: remaining.provider as Source,
    displayName: remaining.display_name,
  });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(setSessionCookie(token));
  return res;
});
