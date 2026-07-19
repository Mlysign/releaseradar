"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { EnrichedItem, MediaType } from "@/types";
import type { PlatformStatus } from "@/lib/watchlistStatus";
import { IntentAction, stashIntent, takeIntent } from "@/lib/pendingIntent";
import { probeSession } from "@/lib/sessionProbe";
import SignInDialog from "@/components/auth/SignInDialog";
import RatingsSection from "./RatingsSection";
import WishlistPanel from "./WishlistPanel";
import FandexScoreSection from "./FandexScoreSection";
import { Reason } from "@/components/discovery/types";

// P13 — the ONE section that differs between a logged-out and a logged-in
// viewer, on the ONE shared item url.
//
// The page around this is server-rendered WITHOUT user data (so it's fast,
// cacheable, crawlable and unfurls), and this island fills in the per-user half
// on the client:
//   401 → the REAL controls, but every interaction opens the sign-in dialog and
//         remembers what you were doing (H2c login-with-intent)
//   200 → the real rating stars, watched/played state and wishlist panel
//
// It deliberately owns ALL the per-user state. The server render must never
// depend on a session, or the public HTML would vary per user and the SSR
// guarantee (and any future caching) breaks.

interface DetailResponse {
  item?: Partial<EnrichedItem>;
  platforms?: PlatformStatus[];
  resolvedMediaItemId?: string | null;
  fandexReasons?: Reason[];
  fandexCenter?: number | null;
  fandexColdStart?: boolean;
}

export default function PersonalSection({
  itemId,
  type,
  ids,
  title,
  releaseDate,
  posterUrl,
  steamStoreUrl,
}: {
  /** Always a uuid since H2b (discover persists → every item has one). */
  itemId: string;
  type: MediaType;
  /** Source ids, forwarded on writes so the server can attach cross-ids. */
  ids: Record<string, string | number>;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  steamStoreUrl: string | null;
}) {
  const [state, setState] = useState<"loading" | "anon" | "user">("loading");
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [mediaItemId, setMediaItemId] = useState<string | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [ratingAction, setRatingAction] = useState(false);
  const [platformAction, setPlatformAction] = useState<string | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);

  // `ids` is an object literal rebuilt by the parent on EVERY render, so
  // depending on it directly would give `load` a new identity each render → the
  // effect refires → setState → render → refire: an infinite fetch loop. Depend
  // on a serialized key instead, which only changes when the ids really do.
  const idsKey = JSON.stringify(ids);

  const load = useCallback(async () => {
    // SM6: don't fire the authed /api/detail just to learn we're logged out —
    // the shared probe answers that without a 401.
    if (!(await probeSession())) { setState("anon"); return; }
    const p = new URLSearchParams({ id: itemId, type });
    for (const [k, v] of Object.entries(JSON.parse(idsKey) as Record<string, string>)) {
      if (v != null) p.set(`${k}Id`, String(v));
    }
    const res = await fetch(`/api/detail?${p}`);
    // Any failure (incl. a race with logout) degrades to the anon controls.
    if (!res.ok) { setState("anon"); return; }
    const data: DetailResponse = await res.json();
    setDetail(data);
    setMediaItemId(data.resolvedMediaItemId ?? null);
    setState("user");
  }, [itemId, type, idsKey]);

  // Fetch-on-mount: this is the whole point of the island — the server can't
  // know the session, so the per-user half is resolved here. `load` is async, so
  // its setState calls all happen after an await, not synchronously in the
  // effect body; the rule can't see through the callback. Same justified disable
  // the discover + insights/facet pages already use for this pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const body = (extra: Record<string, unknown>) =>
    mediaItemId ? { mediaItemId, ...extra } : { type, title, releaseDate, posterUrl, ids, ...extra };

  async function handleRate(n: number | null) {
    setRatingAction(true);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body({ rating: n })),
      });
      const data = await res.json().catch(() => ({}));
      if (data.mediaItemId && !mediaItemId) setMediaItemId(data.mediaItemId);
      await load();
    } finally {
      setRatingAction(false);
    }
  }

  async function handleMarkWatched() {
    setRatingAction(true);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body({ status: type === "game" ? "played" : "watched" })),
      });
      const data = await res.json().catch(() => ({}));
      if (data.mediaItemId && !mediaItemId) setMediaItemId(data.mediaItemId);
      await load();
    } finally {
      setRatingAction(false);
    }
  }

  async function togglePlatform(provider: string, onList: boolean) {
    setPlatformAction(provider);
    try {
      if (onList) {
        await fetch("/api/watchlist", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaItemId: mediaItemId ?? itemId, source: provider }),
        });
      } else {
        await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, title, releaseDate, ids, targetProvider: provider }),
        });
      }
      await load();
    } finally {
      setPlatformAction(null);
    }
  }

  // ── H2c login-with-intent ───────────────────────────────────────────────────
  // Anon interaction: stash what they wanted (keyed to THIS item's path) and open
  // the sign-in dialog. The redirect providers leave the page; RAWG stays.
  const requestAuth = (action: IntentAction) => {
    stashIntent({ path: window.location.pathname, action });
    setShowSignIn(true);
  };

  // Drain the stashed intent exactly once, the first time we resolve to a signed-
  // in viewer. Covers BOTH resume paths: the redirect providers (fresh page load
  // lands back here via the return cookie) and RAWG (onAuthenticated re-runs
  // load(), flipping state to "user"). By the time state === "user", `detail` and
  // `mediaItemId` are set, so the normal handlers apply.
  const drained = useRef(false);
  useEffect(() => {
    if (state !== "user" || drained.current) return;
    drained.current = true;
    const intent = takeIntent(window.location.pathname);
    if (!intent) return;
    // Defer the dispatch out of the effect body: the handlers setState
    // synchronously (a loading flag), and firing that inside the effect trips the
    // cascading-render rule. A microtask runs right after commit — same tick, no
    // synchronous re-render.
    queueMicrotask(() => {
      if (intent.action.kind === "rate") void handleRate(intent.action.value);
      else if (intent.action.kind === "watched") void handleMarkWatched();
      else if (intent.action.kind === "wishlist") {
        // The anon control is provider-less; resolve the concrete provider now
        // from real data — first writable, connected, not-yet-listed one.
        const p = (detail?.platforms ?? []).find((x) => x.canWrite && !x.notConnected && !x.onList);
        if (p) void togglePlatform(p.provider, false);
      }
    });
    // handlers/detail are intentionally omitted: this must fire once, on the
    // state transition, with the values current at that point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Reserve the height while loading so the server-rendered content above
  // doesn't jump once this resolves.
  if (state === "loading") {
    return <div className="h-24 rounded-xl border border-neutral-800 bg-neutral-900/40 animate-pulse" />;
  }

  const item = detail?.item ?? {};
  const anon = state === "anon";

  return (
    <div className="space-y-4">
      <RatingsSection
        type={type}
        hasScores={false} /* community scores are server-rendered above */
        communityRatings={[]}
        steamReview={null}
        canRate
        personalRating={anon ? null : (item.rating ?? null)}
        personalRatings={anon ? [] : (item.ratings ?? [])}
        libraryStatus={anon ? null : (item.libraryStatus ?? null)}
        reviewedAt={anon ? null : (item.reviewedAt ?? null)}
        review={anon ? null : (item.review ?? null)}
        hoverRating={hoverRating}
        setHoverRating={setHoverRating}
        ratingAction={ratingAction}
        onRate={anon ? (n) => requestAuth({ kind: "rate", value: n }) : handleRate}
        onMarkWatched={anon ? () => requestAuth({ kind: "watched" }) : handleMarkWatched}
      />
      {/* H5.3 — anon viewers never fetch /api/detail (no session, no profile), so
          there's nothing to show them; §8's "no popularity fallback" applies. */}
      {!anon && (
        <FandexScoreSection
          score={item.fandexScore ?? null}
          center={detail?.fandexCenter ?? null}
          reasons={detail?.fandexReasons ?? []}
          coldStart={!!detail?.fandexColdStart}
        />
      )}
      {anon ? (
        <AnonWishlist steamStoreUrl={steamStoreUrl} onAdd={() => requestAuth({ kind: "wishlist" })} />
      ) : (
        <WishlistPanel
          platforms={detail?.platforms ?? []}
          loading={false}
          platformAction={platformAction}
          onToggle={togglePlatform}
          steamStoreUrl={steamStoreUrl}
        />
      )}

      {showSignIn && (
        <SignInDialog
          type={type}
          returnTo={typeof window !== "undefined" ? window.location.pathname : "/"}
          onClose={() => setShowSignIn(false)}
          // RAWG login sets the session in-place (no redirect): close + reload the
          // island; the drain effect then resumes the stashed intent.
          onAuthenticated={() => { setShowSignIn(false); void load(); }}
        />
      )}
    </div>
  );
}

// The wishlist affordance for a logged-out viewer. Deliberately provider-less: it
// only signals "you'd add this" and opens sign-in; the concrete provider is
// resolved after login (see the drain effect). The Steam store link stays useful
// even signed out.
function AnonWishlist({ steamStoreUrl, onAdd }: { steamStoreUrl: string | null; onAdd: () => void }) {
  return (
    <div className="pt-4 border-t border-neutral-800/60">
      <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Your wishlists</p>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onAdd}
          className="text-xs px-2.5 py-1 rounded-full border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors"
        >
          + Add to wishlist
        </button>
        {steamStoreUrl && (
          <a href={steamStoreUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
            View on Steam →
          </a>
        )}
      </div>
    </div>
  );
}
