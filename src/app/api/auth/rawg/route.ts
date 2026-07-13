import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { get, run } from "@/lib/db";
import { rawgLogin } from "@/lib/sources/rawg";
import { createSession, setSessionCookie, getSession } from "@/lib/session";
import { enforceRateLimit, clientIp } from "@/lib/rateLimit";
import { encryptSecret } from "@/lib/crypto";
import { parseJsonBody, BadRequestError } from "@/lib/validate";
import { RawgLoginSchema } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  try {
    // S3: strict per-IP limit — this is the password-authentication surface, so
    // cap brute-force attempts hard (5 / minute / IP).
    const limited = enforceRateLimit(`rawg-login:${clientIp(req)}`, 5, 60_000);
    if (limited) return limited;

    const { email, password } = await parseJsonBody(req, RawgLoginSchema);

    // Authenticate with RAWG – returns token + slug
    let token: string;
    let slug: string;
    try {
      ({ token, slug } = await rawgLogin(email, password));
    } catch (e) {
      // S9: don't reflect the upstream RAWG error to the client (it can leak
      // provider internals / enable enumeration). Log it, return a generic 401.
      console.error("[RAWG auth] login failed:", e);
      return NextResponse.json({ error: "Invalid RAWG credentials" }, { status: 401 });
    }

    // S5: the password is NOT stored — only the RAWG session token is kept. The
    // former `bcrypt(password)` here was unused and offline-crackable if the DB
    // leaked, so it's gone. `password` is used once for rawgLogin() above.
    const metadata = JSON.stringify({ slug });

    // Get existing session to link accounts, or create new user
    const existingSession = await getSession();
    const userId = existingSession?.userId ?? randomUUID();

    if (!existingSession) {
      run("INSERT OR IGNORE INTO users (id) VALUES (?)", [userId]);
    }

    const existing = get<any>(
      "SELECT id, user_id FROM user_identities WHERE provider = 'rawg' AND provider_user_id = ?",
      [email.toLowerCase()]
    );

    let identityId: string;
    let finalUserId: string;

    if (existing) {
      identityId = existing.id;
      finalUserId = existing.user_id;
      run(
        "UPDATE user_identities SET access_token = ?, metadata = ?, display_name = ? WHERE id = ?",
        [encryptSecret(token), metadata, slug, identityId]
      );
    } else {
      identityId = randomUUID();
      finalUserId = existingSession?.userId ?? userId;
      run(
        `INSERT INTO user_identities (id, user_id, provider, provider_user_id, display_name, access_token, metadata)
         VALUES (?, ?, 'rawg', ?, ?, ?, ?)`,
        [identityId, finalUserId, email.toLowerCase(), slug, encryptSecret(token), metadata]
      );
    }

    run("UPDATE users SET last_seen_at = strftime('%s','now') WHERE id = ?", [finalUserId]);

    const sessionToken = await createSession({
      userId: finalUserId,
      identityId,
      provider: "rawg",
      displayName: slug,
    });

    const redirect = existingSession ? "/settings?connected=rawg" : "/dashboard";
    const res = NextResponse.json({ ok: true, redirect });
    // Only set session cookie if this is a fresh login (not linking to existing account)
    if (!existingSession) {
      res.cookies.set(setSessionCookie(sessionToken));
    }
    return res;
  } catch (e: any) {
    // S8: malformed body → 400, not a generic 500.
    if (e instanceof BadRequestError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[RAWG auth]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
