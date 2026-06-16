import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/constants";
import { fmtScore } from "./format";

// Small presentational bits shared across the item detail sections.

// A single community/critic score, formatted by its scale.
export function ScoreBadge({ r }: { r: { source: string; label: string; score: number; outOf: number; votes?: number | null; url?: string | null } }) {
  const color = SOURCE_COLORS[r.source] ?? "#888";
  const text =
    r.outOf === 100 ? `${Math.round(r.score)}${r.source === "rt" || r.source === "steam" ? "%" : ""}`
    : r.outOf === 5 ? `${r.score.toFixed(1)}/5`
    : `${fmtScore(r.score)}`;
  const inner = (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-semibold"
      style={{ background: color + "1f", color }}
      title={r.votes ? `${r.label} — ${r.votes.toLocaleString()} votes` : r.label}>
      <span className="text-[10px] uppercase tracking-wide opacity-80 font-bold">{r.label}</span>
      {text}
    </span>
  );
  return r.url
    ? <a href={r.url} target="_blank" rel="noopener noreferrer">{inner}</a>
    : inner;
}

// One labelled fact in the facts grid.
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="text-sm text-neutral-200 truncate">{children}</p>
    </div>
  );
}

// Per-platform rating chips shown under the stars.
export function RatingsBreakdown({ ratings }: { ratings: { source: string; rating: number }[] }) {
  if (!ratings || ratings.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
      {ratings.map((r) => (
        <span key={r.source} className="inline-flex items-center gap-1 text-xs">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: SOURCE_COLORS[r.source] ?? "#888" }} />
          <span className="text-neutral-400">{SOURCE_LABELS[r.source] ?? r.source}</span>
          <span className="text-neutral-200 font-medium">{fmtScore(r.rating)}</span>
        </span>
      ))}
    </div>
  );
}
