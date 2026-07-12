import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSession, bumpSessionEpoch } from "@/lib/session";

export async function POST() {
  // Revoke server-side, not just client-side: bumping the epoch invalidates the
  // 30-day JWT (and any copies on other devices) so a captured cookie can't
  // outlive logout (S4). Then clear the cookie on this device.
  const session = await getSession();
  if (session) bumpSessionEpoch(session.userId);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
