"use client";

// Shared loading indicator (T27/U5) — replaces the ad-hoc plain "Loading…" /
// `animate-pulse` text on the calendar view and /foryou, so loading reads the
// same everywhere skeletons don't fit (calendar grid, swipe feed).
export default function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-neutral-500" role="status" aria-live="polite">
      <span
        aria-hidden
        className="w-6 h-6 rounded-full border-2 border-neutral-700 border-t-neutral-300 animate-spin"
      />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
