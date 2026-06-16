"use client";
import { useEffect, useRef, useState } from "react";
import { BookmarkIcon, LibraryIcon } from "@/components/Badges";
import { useQuickActions, QuickActionItem } from "@/lib/useQuickActions";

// Persistent 3-cell action toolbar shared by PosterCard + ListCard (T11 mockup):
// Rate · Watched/Played · Wishlist. Always visible (works on touch), each cell is
// both an indicator and a control. The rate cell opens a 10-star picker — inline
// (to the left) in rows, popover (below) on cards.

const ratingColor = (r: number) => (r >= 7 ? "#4ade80" : r >= 5 ? "#f59e0b" : "#ef4444");
const fmt = (r: number) => (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1));
const stop = (e: React.MouseEvent) => e.stopPropagation();
const IDLE = "rgba(255,255,255,0.06)";

function StarPicker({ rating, onPick }: { rating: number | null; onPick: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || rating || 0;
  return (
    <div className="flex items-center gap-0.5 bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1.5 shadow-xl" onClick={stop} onMouseLeave={() => setHover(0)}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button key={n} onMouseEnter={() => setHover(n)} onClick={(e) => { stop(e); onPick(n); }} title={`${n}/10`} aria-label={`Rate ${n} out of 10`}
          className="text-lg leading-none px-0.5 transition-transform hover:scale-125" style={{ color: shown >= n ? ratingColor(shown) : "#52525b" }}>★</button>
      ))}
    </div>
  );
}

export default function ActionCells({ item, layout }: { item: QuickActionItem; layout: "row" | "card" }) {
  const { rating, wishlisted, status, busy, rate, toggleWishlist, toggleWatched } = useQuickActions(item);
  const [picking, setPicking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const rated = typeof rating === "number" && rating > 0;
  const inLibrary = !!status;

  const pick = (n: number) => { rate(n); setPicking(false); };

  // Dismiss the star picker on any click/tap outside the toolbar.
  useEffect(() => {
    if (!picking) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPicking(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [picking]);

  const cellSize = layout === "card" ? "flex-1 h-8" : "w-9 h-9 rounded-md";
  const cell = "flex items-center justify-center gap-0.5 text-xs font-bold transition-all hover:brightness-125 disabled:opacity-50 " + cellSize + (layout === "card" ? " rounded-md" : "");

  const rateCell = (
    <button onClick={(e) => { stop(e); setPicking((v) => !v); }} title={rated ? `Your rating ${fmt(rating!)}/10` : "Rate"}
      aria-label={rated ? `Your rating ${fmt(rating!)} out of 10 — change rating` : "Rate this"} aria-haspopup="true" aria-expanded={picking}
      className={cell} style={rated ? { background: ratingColor(rating!), color: "#000" } : { background: IDLE, color: "#9ca3af" }}>
      <span aria-hidden>★{rated ? ` ${fmt(rating!)}` : ""}</span>
    </button>
  );
  const watchedCell = (
    <button onClick={(e) => { stop(e); if (!busy) toggleWatched(); }} disabled={busy}
      title={inLibrary ? `In library — ${status}` : "Mark watched / played"}
      aria-label={inLibrary ? `In your library — ${status}` : "Mark as watched or played"} aria-pressed={inLibrary}
      className={cell} style={inLibrary ? { background: "#10b981", color: "#022c22" } : { background: IDLE, color: "#9ca3af" }}>
      <LibraryIcon size={15} />
    </button>
  );
  const wishlistCell = (
    <button onClick={(e) => { stop(e); if (!busy) toggleWishlist(); }} disabled={busy}
      title={wishlisted ? "On wishlist" : "Add to wishlist"}
      aria-label={wishlisted ? "On your wishlist — remove" : "Add to wishlist"} aria-pressed={wishlisted}
      className={cell} style={wishlisted ? { background: "#f59e0b", color: "#1c1400" } : { background: IDLE, color: "#9ca3af" }}>
      <BookmarkIcon size={13} filled={wishlisted} />
    </button>
  );

  if (layout === "card") {
    return (
      <div className="relative" onClick={stop} ref={rootRef}>
        <div className="flex gap-1">{rateCell}{watchedCell}{wishlistCell}</div>
        {picking && (
          <div className="absolute z-30 top-full mt-1 left-1/2 -translate-x-1/2">
            <StarPicker rating={rating} onPick={pick} />
          </div>
        )}
      </div>
    );
  }

  // Row: star picker inline to the left of the cells.
  return (
    <div className="flex items-center gap-1" onClick={stop} ref={rootRef}>
      {picking && <StarPicker rating={rating} onPick={pick} />}
      {rateCell}{watchedCell}{wishlistCell}
    </div>
  );
}
