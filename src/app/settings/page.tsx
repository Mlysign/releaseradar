"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SOURCE_COLORS } from "@/lib/constants";
import NavBar from "@/components/NavBar";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { COUNTRIES } from "@/lib/countries";
import { detectCountry } from "@/lib/detectCountry";
import { syncToCompletion } from "@/lib/syncClient";

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const [user, setUser] = useState<any>(null);
  const [identities, setIdentities] = useState<any[]>([]);
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [itemCount, setItemCount] = useState(0);
  // The connect/error notice comes from the OAuth redirect's query params — derive
  // it once at init rather than setting state in an effect (react-hooks/set-state-in-effect).
  const [notice, setNotice] = useState<{ msg: string; ok: boolean } | null>(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected) return { msg: `${connected} connected successfully.`, ok: true };
    if (error) return { msg: `Connection failed: ${error}`, ok: false };
    return null;
  });
  const [syncing, setSyncing] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  // T22 — region that drives release dates + streaming availability.
  const [country, setCountry] = useState<string>("");
  const [savingCountry, setSavingCountry] = useState(false);
  const [showRawgForm, setShowRawgForm] = useState(false);
  const [rawgEmail, setRawgEmail] = useState("");
  const [rawgPassword, setRawgPassword] = useState("");
  const [rawgLoading, setRawgLoading] = useState(false);

  useEffect(() => {
    fetchMe(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchMe(initial = false) {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (!data.user) { router.push("/"); return; }
    setUser(data.user);
    setIdentities(data.identities ?? []);
    setSyncLogs(data.syncLogs ?? []);
    setItemCount(data.itemCount ?? 0);
    // Country: use the stored value; on first visit (none stored) auto-detect
    // from the browser and persist it once so region-aware data is correct.
    const stored = data.user.country as string | null;
    if (stored) setCountry(stored);
    else if (initial) { const d = detectCountry(); setCountry(d); saveCountry(d); }
  }

  async function saveCountry(code: string) {
    setSavingCountry(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country: code }),
      });
      if (res.ok) {
        setCountry(code);
        setNotice({ msg: "Region updated.", ok: true });
      }
    } finally {
      setSavingCountry(false);
    }
  }

  function getIdentity(provider: string) {
    return identities.find((i) => i.provider === provider);
  }

  function getSyncLog(provider: string) {
    return syncLogs.find((l) => l.provider === provider);
  }

  async function syncProvider(provider: string) {
    setSyncing(provider);
    await syncToCompletion(provider);
    await fetchMe();
    setSyncing(null);
    setNotice({ msg: `${provider} synced.`, ok: true });
  }

  async function disconnect(provider: string) {
    const ok = await confirm({
      title: `Disconnect ${provider}?`,
      message: "Items from this source will be removed from your watchlist.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setDisconnecting(provider);
    const res = await fetch("/api/auth/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const data = await res.json();
    setDisconnecting(null);
    if (!res.ok) {
      setNotice({ msg: data.error || `Failed to disconnect ${provider}`, ok: false });
    } else {
      setNotice({ msg: `${provider} disconnected.`, ok: true });
      fetchMe();
    }
  }

  async function connectRawg(e: React.FormEvent) {
    e.preventDefault();
    setRawgLoading(true);
    const res = await fetch("/api/auth/rawg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: rawgEmail, password: rawgPassword }),
    });
    const data = await res.json();
    setRawgLoading(false);
    if (!res.ok) {
      setNotice({ msg: data.error || "RAWG login failed", ok: false });
    } else {
      setNotice({ msg: "RAWG connected successfully.", ok: true });
      setShowRawgForm(false);
      setRawgEmail(""); setRawgPassword("");
      fetchMe();
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  const providers = [
    { key: "trakt",      label: "Trakt.tv",    description: "Movies & TV shows watchlist",      connectUrl: "/api/auth/trakt",       canWrite: true  },
    { key: "tmdb",       label: "TMDB",         description: "Movie & TV watchlist and ratings", connectUrl: "/api/auth/tmdb",        canWrite: true  },
    // Letterboxd hidden until an API key is available — re-add when ready.
    { key: "steam",      label: "Steam",        description: "Games from your wishlist",         connectUrl: "/api/auth/steam",       canWrite: false },
    { key: "rawg",       label: "RAWG",         description: "Games from your Want to Play list", connectUrl: "rawg-form",           canWrite: true  },
  ];

  return (
    <div className="min-h-screen">
      {/* RAWG connect modal */}
      {showRawgForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setShowRawgForm(false)}>
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 w-full max-w-sm space-y-4"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold">Connect RAWG</h3>
            <form onSubmit={connectRawg} className="space-y-3">
              <div>
                <label className="text-xs text-neutral-400 block mb-1">RAWG email</label>
                <input type="email" required
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
                  value={rawgEmail} onChange={(e) => setRawgEmail(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-neutral-400 block mb-1">RAWG password</label>
                <input type="password" required
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
                  value={rawgPassword} onChange={(e) => setRawgPassword(e.target.value)} />
              </div>
              <p className="text-xs text-neutral-600">Your password is used only to sign in to RAWG and is never stored — only the resulting session token is kept.</p>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={rawgLoading}
                  className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                  style={{ background: "#4ade80", color: "#000" }}>
                  {rawgLoading ? "Connecting..." : "Connect"}
                </button>
                <button type="button" onClick={() => setShowRawgForm(false)}
                  className="px-4 py-2 rounded-lg text-sm text-neutral-500 hover:text-white border border-neutral-700 transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <NavBar />

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Settings</h1>
          <span className="text-sm text-neutral-500">{itemCount} items in watchlist</span>
        </div>

        {notice && (
          <div className={`border rounded-lg px-4 py-3 text-sm ${notice.ok ? "bg-green-900/30 border-green-700 text-green-300" : "bg-red-900/30 border-red-700 text-red-300"}`}>
            {notice.msg}
          </div>
        )}

        {/* Connected accounts */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Connected accounts</h2>
          <p className="text-sm text-neutral-500">Any connected account can be used to log in.</p>

          {providers.map((p) => {
            const identity = getIdentity(p.key);
            const log = getSyncLog(p.key);
            const color = SOURCE_COLORS[p.key] ?? "#888";

            return (
              <div key={p.key} className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                      style={{ background: `${color}20`, color }}>
                      {p.label[0]}
                    </div>
                    <div>
                      <p className="font-medium">{p.label}</p>
                      <p className="text-sm text-neutral-400">
                        {identity ? `@${identity.display_name ?? identity.provider_user_id}` : p.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {identity ? (
                      <>
                        <span className="text-xs bg-green-900/30 text-green-400 px-2.5 py-1 rounded-full border border-green-800">
                          Connected
                        </span>
                        <Button onClick={() => syncProvider(p.key)} disabled={syncing === p.key}>
                          {syncing === p.key ? "Syncing..." : "Sync"}
                        </Button>
                        <Button variant="danger" onClick={() => disconnect(p.key)} disabled={disconnecting === p.key}>
                          {disconnecting === p.key ? "..." : "Disconnect"}
                        </Button>
                      </>
                    ) : (
                      p.connectUrl === "rawg-form" ? (
                        <button onClick={() => setShowRawgForm(true)}
                          className="text-xs px-4 py-2 rounded-lg font-medium transition-colors"
                          style={{ background: `${color}20`, border: `1px solid ${color}44`, color }}>
                          Connect
                        </button>
                      ) : p.connectUrl ? (
                        <a href={p.connectUrl}
                          className="text-xs px-4 py-2 rounded-lg font-medium transition-colors"
                          style={{ background: `${color}20`, border: `1px solid ${color}44`, color }}>
                          Connect
                        </a>
                      ) : null
                    )}
                  </div>
                </div>

                {log && (
                  <p className="text-xs text-neutral-600">
                    Last synced {new Date(log.last_sync * 1000).toLocaleString()} · {log.item_count} items · {log.status}
                  </p>
                )}
                {!p.canWrite && identity && (
                  <p className="text-xs text-neutral-600 mt-1">
                    Read-only – {p.label} doesn&apos;t support adding to wishlist via API
                  </p>
                )}
              </div>
            );
          })}
        </section>

        {/* Add login method */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Add login method</h2>
          <p className="text-sm text-neutral-500">Connect another account to log in with it in the future.</p>
          {/*
            <a>, not <Link>: these hand off to an OAuth endpoint and Link would
            client-side navigate, breaking the redirect. The rule fires only
            because P13's `/[type]/[id]/[slug]` makes 3-segment paths look like
            pages to the linter; the static /api route still wins at runtime.
          */}
          <div className="flex gap-3 flex-wrap">
            {!getIdentity("trakt") && (
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/api/auth/trakt" className="text-sm px-4 py-2 rounded-lg transition-colors"
                style={{ background: "#ed1c2415", border: "1px solid #ed1c2430", color: "#ed1c24" }}>
                Connect Trakt
              </a>
            )}
            {/* Letterboxd hidden until an API key is available — re-add when ready. */}
            {!getIdentity("steam") && (
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/api/auth/steam" className="text-sm px-4 py-2 rounded-lg transition-colors"
                style={{ background: "#1b9af715", border: "1px solid #1b9af730", color: "#1b9af7" }}>
                Connect Steam
              </a>
            )}
            {!getIdentity("rawg") && (
              <button onClick={() => setShowRawgForm(true)} className="text-sm px-4 py-2 rounded-lg transition-colors"
                style={{ background: "#4ade8015", border: "1px solid #4ade8030", color: "#4ade80" }}>
                Connect RAWG
              </button>
            )}
          </div>
        </section>

        {/* Region (T22) */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Region</h2>
          <p className="text-sm text-neutral-500">Controls which release dates and streaming availability you see.</p>
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-sm">Country</p>
              <p className="text-xs text-neutral-500">Release dates and &ldquo;where to watch&rdquo; use this region.</p>
            </div>
            <select
              aria-label="Country"
              value={country}
              disabled={savingCountry || !country}
              onChange={(e) => saveCountry(e.target.value)}
              className="flex-shrink-0 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-neutral-500 disabled:opacity-50"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
        </section>

        {/* Account info */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Account</h2>
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-400">Logged in as</span>
              <span>{user?.displayName} via {user?.provider}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Watchlist items</span>
              <span>{itemCount}</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <SettingsContent />
    </Suspense>
  );
}
