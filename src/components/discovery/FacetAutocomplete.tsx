"use client";
import { useEffect, useRef, useState } from "react";
import { VocabMatch, TitleMatch } from "./types";
import { ROLE_LABELS } from "@/lib/constants";

// Debounced search box with a results dropdown. Used for example-title seeds
// (mode="title") and facet pills (mode="facets"). Calls onPick with the raw
// match; the parent maps it to a seed/like/dislike/include/exclude pill.
export default function FacetAutocomplete({
  mode, placeholder, onPick, accent = "#3f3f46",
}: {
  mode: "facets" | "title";
  placeholder: string;
  onPick: (m: VocabMatch | TitleMatch) => void;
  accent?: string;
}) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<(VocabMatch | TitleMatch)[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const term = q.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (term.length < 2) { setMatches([]); return; }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const kind = mode === "title" ? "title" : "";
        const res = await fetch(`/api/discover/facets?q=${encodeURIComponent(term)}${kind ? `&kind=${kind}` : ""}`);
        const d = await res.json();
        setMatches(d.matches ?? []);
        setOpen(true);
      } catch { /* keep previous */ }
      setLoading(false);
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, mode]);

  function pick(m: VocabMatch | TitleMatch) {
    onPick(m);
    setQ("");
    setMatches([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => matches.length && setOpen(true)}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setQ(""); } }}
        placeholder={placeholder}
        className="text-xs px-2.5 py-1.5 rounded-lg bg-neutral-900 border outline-none w-full focus:border-neutral-500"
        style={{ borderColor: accent }}
      />
      {open && (matches.length > 0 || loading) && (
        <div
          className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl"
          onMouseDown={(e) => { if (blurTimer.current) clearTimeout(blurTimer.current); e.preventDefault(); }}
        >
          {loading && matches.length === 0 && <div className="px-3 py-2 text-xs text-neutral-500">Searching…</div>}
          {mode === "title"
            ? (matches as TitleMatch[]).map((m) => (
                <button key={m.id} onClick={() => pick(m)} className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-800 text-left">
                  <div className="w-6 h-9 shrink-0 rounded bg-neutral-800 overflow-hidden">
                    {m.posterUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={m.posterUrl} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <span className="flex-1 text-xs truncate text-neutral-200">{m.title}</span>
                  <span className="text-[10px] text-neutral-500">{m.year ?? ""} · {m.type}</span>
                </button>
              ))
            : (matches as VocabMatch[]).map((m) => (
                <button key={`${m.kind}|${m.role ?? ""}|${m.key}`} onClick={() => pick(m)} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 text-left">
                  <span className="flex-1 text-xs truncate text-neutral-200">{m.label}</span>
                  <span className="text-[10px] text-neutral-500">{m.role ? (ROLE_LABELS[m.role] ?? m.role) : m.kind} · {m.count}</span>
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
