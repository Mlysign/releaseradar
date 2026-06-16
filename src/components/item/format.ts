import { format, parseISO } from "date-fns";
import { SOURCE_LABELS } from "@/lib/constants";

// Shared display formatters for the item detail page sections.

export function fmtDate(d: string): string {
  try { return format(parseISO(d), "MMM d, yyyy"); } catch { return d; }
}

export const fmtScore = (r: number): string => (r % 1 === 0 ? String(r) : r.toFixed(1));

export function fmtRuntime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

// "Trakt 3 · TMDB 8" — for the rating tooltip.
export function ratingsTooltip(ratings: { source: string; rating: number }[]): string | undefined {
  if (!ratings?.length) return undefined;
  return ratings.map((r) => `${SOURCE_LABELS[r.source] ?? r.source} ${fmtScore(r.rating)}`).join("  ·  ");
}
