"use client";
import { forwardRef } from "react";

// Shared <Button> primitive (T27/U13) — kills the copy-pasted
// `text-xs px-3 py-1.5 bg-neutral-800 …` button styling that had drifted across
// pages. One place to tune the house button look. Provider-colored "Connect"
// buttons in Settings stay bespoke (source identity, U10) — those aren't this.

type Variant = "primary" | "secondary" | "outline" | "danger" | "ghost";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-white text-black hover:bg-neutral-200",
  secondary: "bg-neutral-800 text-neutral-100 hover:bg-neutral-700",
  outline: "border border-neutral-700 text-neutral-200 hover:bg-neutral-800",
  danger: "text-red-400 border border-red-900/30 hover:bg-red-950/30",
  ghost: "text-neutral-400 hover:text-white hover:bg-neutral-800",
};

const SIZES: Record<Size, string> = {
  sm: "text-xs px-3 py-1.5",
  md: "text-sm px-4 py-2",
};

// Shared class string — also usable on an <a>/<Link> that should look like a
// button (avoids nesting a <button> inside an anchor).
export function buttonClasses(variant: Variant = "secondary", size: Size = "sm", extra = "") {
  return `inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "sm", className = "", ...props },
  ref,
) {
  return (
    <button ref={ref} className={buttonClasses(variant, size, className)} {...props} />
  );
});

export default Button;
