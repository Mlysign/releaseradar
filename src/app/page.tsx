"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [showRawg, setShowRawg] = useState(false);
  const [rawgEmail, setRawgEmail] = useState("");
  const [rawgPassword, setRawgPassword] = useState("");
  const [rawgLoading, setRawgLoading] = useState(false);
  const [rawgError, setRawgError] = useState("");

  useEffect(() => {
    // Redirect if already logged in
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (d.user) router.push("/dashboard");
    });
  }, []);

  async function handleRawgLogin(e: React.FormEvent) {
    e.preventDefault();
    setRawgLoading(true);
    setRawgError("");
    const res = await fetch("/api/auth/rawg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: rawgEmail, password: rawgPassword }),
    });
    const data = await res.json();
    setRawgLoading(false);
    if (!res.ok) {
      setRawgError(data.error || "Login failed");
    } else {
      router.push(data.redirect ?? "/dashboard");
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="max-w-sm w-full space-y-8 text-center">
        <div>
          <h1 className="text-4xl font-bold mb-2">ReleaseRadar</h1>
          <p className="text-neutral-400">One calendar for every game, movie, and show you&apos;re waiting for.</p>
        </div>

        <div className="space-y-3">
          <a href="/api/auth/trakt"
            className="flex items-center justify-center gap-3 w-full py-3 rounded-xl font-medium transition-all hover:opacity-90"
            style={{ background: "#ed1c2420", border: "1px solid #ed1c2444", color: "#ed1c24" }}>
            <span className="text-lg font-bold">T</span>
            Continue with Trakt.tv
          </a>

          <a href="/api/auth/steam"
            className="flex items-center justify-center gap-3 w-full py-3 rounded-xl font-medium transition-all hover:opacity-90"
            style={{ background: "#1b9af720", border: "1px solid #1b9af744", color: "#1b9af7" }}>
            <span className="text-lg font-bold">S</span>
            Continue with Steam
          </a>

          {!showRawg ? (
            <button onClick={() => setShowRawg(true)}
              className="flex items-center justify-center gap-3 w-full py-3 rounded-xl font-medium transition-all hover:opacity-90"
              style={{ background: "#4ade8020", border: "1px solid #4ade8044", color: "#4ade80" }}>
              <span className="text-lg font-bold">R</span>
              Continue with RAWG
            </button>
          ) : (
            <div className="rounded-xl p-4 space-y-3 text-left"
              style={{ background: "#4ade8010", border: "1px solid #4ade8030" }}>
              <p className="text-sm font-medium" style={{ color: "#4ade80" }}>Sign in with RAWG</p>
              <form onSubmit={handleRawgLogin} className="space-y-2">
                <input type="email" placeholder="RAWG email" required
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
                  value={rawgEmail} onChange={(e) => setRawgEmail(e.target.value)} />
                <input type="password" placeholder="RAWG password" required
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
                  value={rawgPassword} onChange={(e) => setRawgPassword(e.target.value)} />
                {rawgError && <p className="text-red-400 text-xs">{rawgError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={rawgLoading}
                    className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                    style={{ background: "#4ade80", color: "#000" }}>
                    {rawgLoading ? "Signing in..." : "Sign in"}
                  </button>
                  <button type="button" onClick={() => setShowRawg(false)}
                    className="px-3 py-2 rounded-lg text-sm text-neutral-500 hover:text-white transition-colors">
                    Cancel
                  </button>
                </div>
              </form>
              <p className="text-xs text-neutral-600">
                Your password is encrypted before storage and only used to refresh your RAWG session.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-center gap-6 text-xs text-neutral-600 pt-2">
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />Games</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />Movies</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa]" />Shows</span>
        </div>
      </div>
    </main>
  );
}
