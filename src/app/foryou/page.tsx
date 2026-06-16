"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import MatchReasons from "@/components/discovery/MatchReasons";
import { buildItemHref } from "@/lib/itemUrl";
import { DiscoverItem } from "@/components/discovery/types";
import { TYPE_COLORS } from "@/lib/constants";
import Spinner from "@/components/ui/Spinner";

// T10 — endless Tinder-style "For You" feed. Taste-ranked candidates that aren't
// already in the library, on the wishlist, or previously ignored. Swipe/drag or
// press the buttons: left = ignore (persisted), right = add to wishlist.

const BATCH = 30;
const SWIPE_THRESHOLD = 110;   // px drag to commit a swipe

// Build a source-id map from a catalog item's links (for the watchlist API).
function idsOf(item: DiscoverItem): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const s of item.sources ?? []) ids[s.source] = s.sourceId;
  return ids;
}

export default function ForYouPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<DiscoverItem[]>([]);
  const [pos, setPos] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const offsetRef = useRef(0);
  const fetchingRef = useRef(false);

  // Drag state for the top card.
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<null | "left" | "right">(null);
  const startX = useRef<number | null>(null);
  const moved = useRef(false);

  const fetchBatch = useCallback(async () => {
    if (fetchingRef.current || exhausted) return;
    fetchingRef.current = true;
    try {
      const res = await fetch("/api/discover/find", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sort: "match",
          filters: { membership: { library: "exclude", wishlist: "exclude" } },
          excludeIgnored: true,
          limit: BATCH,
          offset: offsetRef.current,
        }),
      });
      const d = await res.json();
      const items: DiscoverItem[] = d.items ?? [];
      offsetRef.current += items.length;
      if (items.length === 0) setExhausted(true);
      setQueue((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...items.filter((i) => !seen.has(i.id))];
      });
    } catch { /* ignore */ }
    fetchingRef.current = false;
    setLoading(false);
  }, [exhausted]);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => { if (!d.user) router.push("/"); });
    // Kicking off the initial fetch sets loading state synchronously — expected
    // for a data-fetch-on-mount effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefetch more as the user nears the end of the queue.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (queue.length - pos <= 8) fetchBatch();
  }, [pos, queue.length, fetchBatch]);

  const current = queue[pos];
  const next = queue[pos + 1];

  const commit = useCallback((dir: "left" | "right") => {
    const item = queue[pos];
    if (!item) return;
    setLeaving(dir);
    if (dir === "left") {
      fetch("/api/discover/ignore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaItemId: item.id }) });
    } else {
      fetch("/api/watchlist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: item.type, title: item.title, releaseDate: item.releaseDate, posterUrl: item.posterUrl, ids: idsOf(item) }),
      });
    }
    // Advance after the leave animation.
    setTimeout(() => { setPos((p) => p + 1); setDrag(0); setLeaving(null); }, 220);
  }, [pos, queue]);

  // Keyboard: ← ignore, → wishlist.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (leaving || !current) return;
      if (e.key === "ArrowLeft") commit("left");
      else if (e.key === "ArrowRight") commit("right");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, leaving, current]);

  // ── Pointer drag ──
  function onPointerDown(e: React.PointerEvent) {
    if (leaving) return;
    startX.current = e.clientX;
    moved.current = false;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (startX.current == null) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > 4) moved.current = true;
    setDrag(dx);
  }
  function onPointerUp() {
    if (startX.current == null) return;
    const dx = drag;
    startX.current = null;
    setDragging(false);
    if (dx > SWIPE_THRESHOLD) commit("right");
    else if (dx < -SWIPE_THRESHOLD) commit("left");
    else setDrag(0); // snap back
  }

  function openDetail() {
    if (moved.current || !current) return;
    router.push(buildItemHref(current as any));
  }

  // Top-card transform: follow the drag, or fling off-screen while leaving.
  const offX = leaving === "left" ? -600 : leaving === "right" ? 600 : drag;
  const rot = offX / 22;
  const overlay = drag > 20 ? "right" : drag < -20 ? "left" : null;

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="max-w-md mx-auto px-6 py-8">
        <div className="text-center mb-6">
          <h1 className="text-lg font-semibold">For You</h1>
          <p className="text-xs text-neutral-500">Swipe right to wishlist · left to dismiss · tap to open</p>
        </div>

        {loading && !current && <Spinner label="Finding picks for you…" />}

        {!loading && !current && (
          <div className="text-center py-24 text-neutral-500">
            <p className="mb-2">{exhausted ? "You're all caught up — no more picks right now." : "Nothing to show."}</p>
            <p className="text-xs">Rate more in your library to sharpen recommendations.</p>
          </div>
        )}

        {current && (
          <div className="relative h-[520px] select-none">
            {/* Next card peeking behind */}
            {next && (
              <div className="absolute inset-0 scale-[0.96] translate-y-3 rounded-2xl overflow-hidden border border-neutral-800 bg-neutral-900 opacity-60">
                {next.posterUrl && <img src={next.posterUrl} alt="" className="w-full h-full object-cover" />}
              </div>
            )}

            {/* Top card */}
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={openDetail}
              style={{
                transform: `translateX(${offX}px) rotate(${rot}deg)`,
                transition: dragging ? "none" : "transform 0.22s ease-out",
              }}
              className="absolute inset-0 rounded-2xl overflow-hidden border border-neutral-700 bg-neutral-900 cursor-grab active:cursor-grabbing touch-none"
            >
              {current.posterUrl ? (
                // Letterbox over a blurred fill so landscape game art isn't sliced (U15).
                <>
                  <img src={current.posterUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-lg scale-110 opacity-40 pointer-events-none" />
                  <img src={current.posterUrl} alt={current.title} draggable={false} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                </>
              ) : <div className="w-full h-full flex items-center justify-center text-neutral-600">No image</div>}

              {/* Swipe intent overlays */}
              {overlay === "right" && <div className="absolute top-6 left-6 rotate-[-12deg] border-2 border-emerald-400 text-emerald-400 font-bold uppercase tracking-widest px-3 py-1 rounded">Wishlist</div>}
              {overlay === "left" && <div className="absolute top-6 right-6 rotate-[12deg] border-2 border-rose-400 text-rose-400 font-bold uppercase tracking-widest px-3 py-1 rounded">Dismiss</div>}

              {/* Info gradient */}
              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: `${TYPE_COLORS[current.type]}22`, color: TYPE_COLORS[current.type] }}>{current.type}</span>
                  {current.releaseDate && <span className="text-xs text-neutral-300">{current.releaseDate.slice(0, 4)}</span>}
                  {current.communityAvg != null && <span className="text-xs text-neutral-300">· {current.communityAvg}% liked</span>}
                </div>
                <h2 className="text-lg font-semibold leading-tight">{current.title}</h2>
                {current.reasons?.length > 0 && <div className="mt-1.5"><MatchReasons reasons={current.reasons} /></div>}
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {current && (
          <div className="flex items-center justify-center gap-6 mt-8">
            <button onClick={() => commit("left")} disabled={!!leaving} aria-label="Dismiss" className="w-14 h-14 rounded-full border border-rose-500/40 text-rose-400 text-2xl hover:bg-rose-500/10 transition-colors disabled:opacity-40" title="Dismiss (←)"><span aria-hidden>✕</span></button>
            <button onClick={() => commit("right")} disabled={!!leaving} aria-label="Add to wishlist" className="w-14 h-14 rounded-full border border-emerald-500/40 text-emerald-400 text-2xl hover:bg-emerald-500/10 transition-colors disabled:opacity-40" title="Wishlist (→)"><span aria-hidden>♥</span></button>
          </div>
        )}
      </main>
    </div>
  );
}
