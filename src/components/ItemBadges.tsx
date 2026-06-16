"use client";
import { SOURCE_LABELS } from "@/lib/constants";
import { TypeBadge, TypeIcon, BookmarkIcon, LibraryIcon } from "@/components/Badges";

// "Trakt 3 · TMDB 8" — per-platform breakdown for the rating tooltip.
function ratingTitle(ratings?: { source: string; rating: number }[]): string | undefined {
  if (!ratings || ratings.length === 0) return undefined;
  return ratings.map((r) => `${SOURCE_LABELS[r.source] ?? r.source} ${fmtRating(r.rating)}`).join("  ·  ");
}

// The canonical badge set for any list / card / calendar item. Driven entirely by
// the item's user-state so the SAME item shows the SAME indicators everywhere:
// a personal rating, a saved/wishlist bookmark, and an in-library check.
// (T11: source color-coding removed from cards/rows — kept only in Settings.)
export interface BadgeItem {
  type: string;
  platformSources?: string[];   // wishlist providers (presence ⇒ on wishlist)
  onWatchlist?: boolean;
  libraryStatus?: string | null; // watched | played | owned
  rating?: number | null;        // personal score, 0-10 (average across platforms)
  ratings?: { source: string; rating: number }[]; // per-platform breakdown
}

function ratingColor(r: number) { return r >= 7 ? "#4ade80" : r >= 5 ? "#f59e0b" : "#ef4444"; }
function fmtRating(r: number) { return r % 1 === 0 ? r.toFixed(0) : r.toFixed(1); }

export default function ItemBadges({ item, variant }: { item: BadgeItem; variant: "row" | "card" | "calendar" }) {
  const rating      = typeof item.rating === "number" && item.rating > 0 ? item.rating : null;
  const onWatchlist = item.onWatchlist ?? (item.platformSources?.length ?? 0) > 0;
  const status      = item.libraryStatus ?? null;
  const inLibrary   = !!status;

  // ── Inline cluster for list rows ──────────────────────────────────────────
  if (variant === "row") {
    return (
      <div className="flex items-center gap-2 flex-shrink-0">
        {rating !== null && (
          <span
            className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded font-semibold"
            style={{ background: `${ratingColor(rating)}1f`, color: ratingColor(rating) }}
            title={ratingTitle(item.ratings)}
          >
            ★ {fmtRating(rating)}
          </span>
        )}
        <TypeBadge type={item.type} />
        {onWatchlist && (
          <span className="text-amber-400" title="On your wishlist"><BookmarkIcon size={13} /></span>
        )}
        {inLibrary && (
          <span className="text-emerald-400" title={`In library — ${status}`}><LibraryIcon size={14} /></span>
        )}
      </div>
    );
  }

  // ── Absolutely-positioned overlays for poster cards ───────────────────────
  if (variant === "card") {
    return (
      <>
        {rating !== null && (
          <div
            className="absolute top-2 left-2 flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded shadow"
            style={{ background: "rgba(0,0,0,0.7)", color: ratingColor(rating) }}
            title={ratingTitle(item.ratings)}
          >
            ★ {fmtRating(rating)}
          </div>
        )}
        {(onWatchlist || inLibrary) && (
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
            {onWatchlist && (
              <span className="w-5 h-5 rounded-full flex items-center justify-center shadow text-amber-400" style={{ background: "rgba(0,0,0,0.7)" }} title="On your wishlist">
                <BookmarkIcon size={12} />
              </span>
            )}
            {inLibrary && (
              <span className="w-5 h-5 rounded-full flex items-center justify-center shadow text-emerald-400" style={{ background: "rgba(0,0,0,0.7)" }} title={`In library — ${status}`}>
                <LibraryIcon size={13} />
              </span>
            )}
          </div>
        )}
      </>
    );
  }

  // ── Compact markers for calendar cells / overflow rows ────────────────────
  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0">
      <TypeIcon type={item.type} size={11} className="text-neutral-400" />
      {rating !== null && (
        <span className="text-[9px] font-bold" style={{ color: ratingColor(rating) }}>★{fmtRating(rating)}</span>
      )}
      {inLibrary && <span className="text-emerald-400" title={status ?? "In library"}><LibraryIcon size={10} /></span>}
      {onWatchlist && <span className="text-amber-400" title="On your wishlist"><BookmarkIcon size={10} /></span>}
    </span>
  );
}
