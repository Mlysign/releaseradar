"use client";
import { useEffect, useRef, useState } from "react";
import { Reason } from "@/components/discovery/types";
import { fandexScoreColor } from "@/components/FandexScoreBadge";
import FacetLink from "@/components/FacetLink";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/tags";
import { ROLE_COLORS, ROLE_LABELS } from "@/lib/constants";

// H5.3 — the detail-page Fandex Score: the prominent number + a click-to-expand
// breakdown (docs/fandex-score.md §3.4/§7). Three states:
//   coldStart      → "rate a few titles to unlock" nudge, no number (§8)
//   score == null  → nothing (enough signal overall, but THIS item shares no
//                     facets with the profile — not a cold-start, just no match)
//   score present  → the number + expandable reasons
//
// Q20 (2026-07-19): the breakdown is now (a) genuinely additive — `center +
// Σ contribution ≈ score`, computeFandexScore does the scaling — with an
// explicit "Baseline" row so the arithmetic is visible; (b) each reason is a
// clickable FacetLink styled like the "Tags & details" chips, not a static
// row; (c) rendered as a floating overlay that doesn't push the page layout.

function reasonColor(r: Reason): string {
  return r.kind === "tag" ? (CATEGORY_COLORS[r.category ?? "other"] ?? "#888") : (ROLE_COLORS[r.role ?? ""] ?? "#888");
}
function reasonGroupLabel(r: Reason): string {
  return r.kind === "tag" ? (CATEGORY_LABELS[r.category ?? "other"] ?? "Tag") : (ROLE_LABELS[r.role ?? ""] ?? "Person");
}

export default function FandexScoreSection({
  score, center, reasons, coldStart,
}: { score: number | null; center: number | null; reasons: Reason[]; coldStart: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss the overlay on any click/tap outside it (same pattern as ActionCells'
  // star picker) and on Escape.
  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  if (coldStart) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-3.5 py-3 text-sm text-neutral-400">
        Rate a few titles to unlock your Fandex Score — a personalized 0-100 taste match for everything you browse.
      </div>
    );
  }
  if (score == null) return null;

  const rounded = Math.round(score);
  const color = fandexScoreColor(score);
  const sorted = [...reasons].sort((a, b) => b.contribution - a.contribution);
  const baseline = center != null ? Math.round(center) : null;

  return (
    <div ref={rootRef} className="relative rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-visible">
      <button
        onClick={() => setExpanded((v) => !v)}
        disabled={!reasons.length}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left disabled:cursor-default"
        aria-expanded={expanded}
        aria-label={`Fandex Score ${rounded} out of 100${reasons.length ? " — show breakdown" : ""}`}
      >
        <span className="text-2xl font-bold leading-none" style={{ color }}>{rounded}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-neutral-200">Fandex Score</span>
          <span className="block text-xs text-neutral-500">how well this matches your taste</span>
        </span>
        {reasons.length > 0 && (
          <span className="text-neutral-500 text-xs shrink-0">{expanded ? "Hide why ▲" : "Why? ▼"}</span>
        )}
      </button>

      {/* Q20: a floating overlay (not inline layout) — positioned below the
          button, elevated above surrounding content. */}
      {expanded && (
        <div
          role="dialog"
          aria-label="Fandex Score breakdown"
          className="absolute z-30 top-full mt-1.5 left-0 right-0 sm:left-0 sm:right-auto sm:w-96 max-h-[70vh] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl p-3.5 space-y-2.5"
        >
          {baseline != null && (
            <div className="flex items-center justify-between gap-3 text-xs pb-2 border-b border-neutral-800">
              <span className="text-neutral-400">Your baseline (average rating × 10)</span>
              <span className="font-semibold text-neutral-200">{baseline}</span>
            </div>
          )}
          <div className="space-y-2">
            {sorted.map((r) => {
              const positive = r.contribution >= 0;
              const c = reasonColor(r);
              const linkable = r.kind === "tag" || r.kind === "person" || r.kind === "company";
              return (
                <div key={`${r.kind}|${r.role ?? ""}|${r.label}`} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className="uppercase tracking-wide text-[10px] font-bold shrink-0" style={{ color: c }}>{reasonGroupLabel(r)}</span>
                      {linkable ? (
                        <FacetLink
                          kind={r.kind as "tag" | "person" | "company"} role={r.role} label={r.label}
                          className="px-2 py-0.5 rounded-full transition-all hover:brightness-125"
                          style={{ background: `${c}22`, color: c }}
                        />
                      ) : (
                        <span className="text-neutral-300">{r.label}</span>
                      )}
                    </span>
                    {r.BA != null && r.n != null && (
                      <span className="block text-neutral-500">
                        you rate this {r.BA.toFixed(1)} avg over {r.n} title{r.n === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold pt-0.5" style={{ color: positive ? "#4ade80" : "#f87171" }}>
                    {positive ? "+" : ""}{r.contribution.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
          {baseline != null && (
            <div className="flex items-center justify-between gap-3 text-xs pt-2 border-t border-neutral-800">
              <span className="text-neutral-400">Baseline + contributions</span>
              <span className="font-bold" style={{ color }}>{rounded}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
