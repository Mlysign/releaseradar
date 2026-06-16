"use client";

// Plain text search input shared across Discover, Wishlist and Library (rendered
// inside SubBar). The richer filters — type, source, must-include/exclude facets,
// hide-rated — live in SubBar's always-visible filter section, not here, so every
// page presents the same controls in one place.

interface SearchBarProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}

export default function SearchBar({ value, onChange, placeholder = "Search…" }: SearchBarProps) {
  return (
    <div className="relative flex-1">
      <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600 text-sm pointer-events-none">⌕</span>
      <input
        type="text"
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full bg-neutral-900 border border-neutral-800 rounded-xl pl-8 pr-9 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onChange(""); }}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white text-base leading-none"
          title="Clear"
        >
          ×
        </button>
      )}
    </div>
  );
}
