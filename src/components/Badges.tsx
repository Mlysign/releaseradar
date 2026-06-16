"use client";
import { TYPE_COLORS, SOURCE_COLORS, SOURCE_LABELS } from "@/lib/constants";

// Shared, dependency-free badge primitives used across list rows, cards,
// the search modal, and the item inspection page.

// ── Icons (inline SVG, monochrome via currentColor) ───────────────────────────

// Per-type glyph (T11): a controller / clapperboard / TV so type reads without
// relying on color alone.
const TYPE_ICON_PATHS: Record<string, React.ReactNode> = {
  game: (<><rect x="2" y="7" width="20" height="10" rx="5" /><line x1="6.5" y1="12" x2="9.5" y2="12" /><line x1="8" y1="10.5" x2="8" y2="13.5" /><circle cx="15.5" cy="11" r="0.6" /><circle cx="17.5" cy="13" r="0.6" /></>),
  movie: (<><rect x="3" y="8" width="18" height="12" rx="1" /><path d="M3 8l3.2-4M9 8l3.2-4M15 8l3.2-4" /></>),
  show: (<><rect x="3" y="7" width="18" height="12" rx="2" /><polyline points="8 3 12 7 16 3" /></>),
};

export function TypeIcon({ type, size = 12, className }: { type: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {TYPE_ICON_PATHS[type] ?? <circle cx="12" cy="12" r="9" />}
    </svg>
  );
}

// Saved-for-later (wishlist) bookmark.
export function BookmarkIcon({ size = 12, filled = true }: { size?: number; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// In-library (watched / played / owned) — a check.
export function LibraryIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" />
    </svg>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────

export function TypeBadge({ type, withIcon = true }: { type: string; withIcon?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium capitalize"
      style={{ background: `${TYPE_COLORS[type] ?? "#888"}22`, color: TYPE_COLORS[type] ?? "#888" }}
    >
      {withIcon && <TypeIcon type={type} size={11} />}
      {type}
    </span>
  );
}

export function SourcePill({ source }: { source: string }) {
  return (
    <span
      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
      style={{
        borderColor: `${SOURCE_COLORS[source] ?? "#888"}44`,
        color: SOURCE_COLORS[source] ?? "#888",
        background: `${SOURCE_COLORS[source] ?? "#888"}11`,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: SOURCE_COLORS[source] ?? "#888" }} />
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}
