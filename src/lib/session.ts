import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { get, run } from "@/lib/db";
import { SessionUser } from "@/types";

// Sessions are signed with JWT_SECRET. Refuse to run in production without it
// rather than silently falling back to a source-controlled default (which would
// make every session forgeable — anyone could mint a JWT for any userId). A
// clearly-insecure fallback is kept ONLY for local dev/test so `npm run dev` and
// the test suite work without a configured secret.
//
// Resolved LAZILY (on first sign/verify), not at module load: `next build`
// evaluates route modules with NODE_ENV=production and no JWT_SECRET, so an eager
// check would (wrongly) fail the build. Boot-time fail-fast for a real server is
// handled by instrumentation.ts → validateEnv(); this just guards actual use.
let _secret: Uint8Array | null = null;
function getSecret(): Uint8Array {
  if (_secret) return _secret;
  const secret = process.env.JWT_SECRET;
  if (secret) return (_secret = new TextEncoder().encode(secret));
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET is required in production. Generate one with `openssl rand -hex 32` and set it in the environment."
    );
  }
  return (_secret = new TextEncoder().encode("dev-only-insecure-secret-rr2"));
}

export const SESSION_COOKIE = "rr2_session";

// Session revocation (S4). Every token is stamped with the user's session_epoch
// at sign time; a token whose stamp is behind the user's current epoch is
// rejected. Bumping the epoch (logout / disconnect) therefore invalidates every
// outstanding token for that user server-side — the 30-day cookie is no longer
// un-revocable. Legacy tokens carry no epoch (read as 0) and stay valid until
// the first bump, so the rollout is non-breaking.
function currentEpoch(userId: string): number {
  const row = get<{ session_epoch: number }>("SELECT session_epoch FROM users WHERE id = ?", [userId]);
  return row?.session_epoch ?? 0;
}

export function bumpSessionEpoch(userId: string): void {
  run("UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?", [userId]);
}

export async function createSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user, se: currentEpoch(user.userId) })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .setIssuedAt()
    .sign(getSecret());
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, getSecret());
    const user = payload as unknown as SessionUser & { se?: number };
    // Reject tokens revoked by an epoch bump since they were issued.
    if ((payload.se as number | undefined ?? 0) !== currentEpoch(user.userId)) return null;
    return user;
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new Error("Unauthorized");
  return s;
}

export function setSessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  };
}
