"use client";

// Shared <Chip> primitive (T27/U13) — the pill-shaped filter toggle used across
// the SubBar (All / type / source / hide-rated). A faithful extraction of the
// previously copy-pasted inline-style pattern: a colored border + 8%-alpha fill +
// colored text when active, muted when not. `color` defaults to white (neutral
// pills); pass a type/source color for the color-coded chips, and `dot` for the
// leading identity dot.

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** Active accent color (border/fill/text). Defaults to white. */
  color?: string;
  /** Leading dot color; omit for no dot. */
  dot?: string;
}

export default function Chip({ active = false, color = "#fff", dot, className = "", children, ...props }: ChipProps) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${className}`}
      style={{
        borderColor: active ? color : "transparent",
        background: active ? `${color}15` : "#1a1a1a",
        color: active ? color : "#666",
      }}
      {...props}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}
