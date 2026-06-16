"use client";
import { ReactNode } from "react";

// Shared <EmptyState> (T27/U5) — one consistent shape for "nothing here yet"
// and "nothing matched" states that were previously bespoke per page. Rich
// onboarding flows (dashboard first-run checklist) stay custom; this covers the
// common centered title + hint + optional actions.

interface EmptyStateProps {
  title: ReactNode;
  /** Secondary line under the title. */
  hint?: ReactNode;
  /** Buttons / links rendered in a centered row below the hint. */
  actions?: ReactNode;
  /** Decorative glyph/icon above the title. */
  icon?: ReactNode;
  className?: string;
}

export default function EmptyState({ title, hint, actions, icon, className = "" }: EmptyStateProps) {
  return (
    <div className={`max-w-md mx-auto text-center py-16 ${className}`}>
      {icon && <div className="mb-3 flex justify-center text-neutral-600" aria-hidden>{icon}</div>}
      <p className="text-lg font-semibold text-neutral-200 mb-1">{title}</p>
      {hint && <p className="text-sm text-neutral-500 leading-relaxed mb-5">{hint}</p>}
      {actions && <div className="flex gap-3 justify-center flex-wrap">{actions}</div>}
    </div>
  );
}
