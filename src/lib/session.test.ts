import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";

// getSession() reads the cookie via next/headers — stub it with a settable token.
const cookieState = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "rr2_session" && cookieState.token ? { value: cookieState.token } : undefined),
  }),
}));

import { initDb, run } from "./db";
import { createSession, getSession, bumpSessionEpoch } from "./session";

initDb();

const USER = "u1";
const base = { userId: USER, identityId: "id1", provider: "trakt" as const, displayName: "Nils" };

beforeEach(() => {
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  cookieState.token = null;
});

describe("session revocation (S4)", () => {
  it("accepts a freshly minted token", async () => {
    cookieState.token = await createSession(base);
    const s = await getSession();
    expect(s?.userId).toBe(USER);
  });

  it("rejects a token issued before an epoch bump (logout/disconnect)", async () => {
    cookieState.token = await createSession(base);
    bumpSessionEpoch(USER);
    expect(await getSession()).toBeNull();
  });

  it("accepts a token re-issued after the bump", async () => {
    await createSession(base); // stale, epoch 0
    bumpSessionEpoch(USER);
    cookieState.token = await createSession(base); // stamped with the new epoch
    const s = await getSession();
    expect(s?.userId).toBe(USER);
  });

  it("survives several bumps (only the latest generation is valid)", async () => {
    bumpSessionEpoch(USER);
    bumpSessionEpoch(USER);
    const current = await createSession(base);
    bumpSessionEpoch(USER);
    cookieState.token = current;
    expect(await getSession()).toBeNull();
  });

  it("treats a legacy token without an epoch claim as generation 0 (non-breaking rollout)", async () => {
    // Mirrors a JWT minted before S4 shipped — no `se` claim.
    const legacy = await new SignJWT({ ...base })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode("dev-only-insecure-secret-rr2"));
    cookieState.token = legacy;
    expect((await getSession())?.userId).toBe(USER); // valid at epoch 0
    bumpSessionEpoch(USER);
    expect(await getSession()).toBeNull(); // …but revoked once the epoch moves
  });
});
