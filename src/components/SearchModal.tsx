"use client";
import { useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { TYPE_COLORS, SOURCE_COLORS, SOURCE_LABELS } from "@/lib/constants";
import { TypeBadge } from "@/components/Badges";

interface SearchModalProps {
  onClose: () => void;
  onAdded: () => void;
}

export default function SearchModal({ onClose, onAdded }: SearchModalProps) {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInput(val: string) {
    setQ(val);
    if (debounce.current) clearTimeout(debounce.current);
    if (val.trim().length < 2) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      const type = typeFilter === "all" ? "" : `&type=${typeFilter}`;
      const res = await fetch(`/api/search?q=${encodeURIComponent(val)}${type}`);
      const data = await res.json();
      setResults(data.results ?? []);
      setSearching(false);
    }, 400);
  }

  async function addItem(result: any) {
    const key = result.title + result.type;
    setAdding(key);
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: result.type,
        title: result.title,
        releaseDate: result.releaseDate,
        posterUrl: result.posterUrl,
        ids: result.ids,
      }),
    });
    setAdded((prev) => new Set(prev).add(key));
    setAdding(null);
    onAdded();
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-20 left-1/2 -translate-x-1/2 w-full max-w-lg z-50 bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-neutral-800">
          <div className="flex items-center gap-3 mb-3">
            <input
              autoFocus
              type="text"
              placeholder="Search games, movies, shows..."
              className="flex-1 bg-neutral-800 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              value={q}
              onChange={(e) => handleInput(e.target.value)}
            />
            <button onClick={onClose} aria-label="Close search" className="text-neutral-500 hover:text-white text-sm"><span aria-hidden>✕</span></button>
          </div>
          <div className="flex gap-2">
            {["all", "game", "movie", "show"].map((t) => (
              <button
                key={t}
                onClick={() => { setTypeFilter(t); if (q.length >= 2) handleInput(q); }}
                className="text-xs px-2.5 py-1 rounded-full border transition-colors capitalize"
                style={{
                  borderColor: typeFilter === t ? (TYPE_COLORS[t] ?? "#888") : "transparent",
                  background: typeFilter === t ? `${TYPE_COLORS[t] ?? "#888"}15` : "#1a1a1a",
                  color: typeFilter === t ? (TYPE_COLORS[t] ?? "#fff") : "#888",
                }}
              >
                {t === "all" ? "All" : t + "s"}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {searching && (
            <p className="text-center text-neutral-500 text-sm py-8">Searching...</p>
          )}
          {!searching && results.length === 0 && q.length >= 2 && (
            <p className="text-center text-neutral-500 text-sm py-8">No results</p>
          )}
          {results.map((r) => {
            const key = r.title + r.type;
            const isAdded = added.has(key);
            const isAdding = adding === key;
            return (
              <div
                key={`${r.type}-${r.id}`}
                className="flex items-center gap-3 p-3 hover:bg-neutral-800 transition-colors border-b border-neutral-800/50"
              >
                <div className="w-12 h-8 rounded overflow-hidden flex-shrink-0 bg-neutral-800">
                  {r.posterUrl && (
                    <img src={r.posterUrl} alt={r.title} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <TypeBadge type={r.type} />
                    <span className="text-xs text-neutral-500">
                      {r.releaseDate ? format(parseISO(r.releaseDate), "MMM d, yyyy") : "TBA"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {r.foundOn && r.foundOn.length > 0 && (
                    <div className="flex gap-1">
                      {r.foundOn.map((s: string) => (
                        <span
                          key={s}
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            background: SOURCE_COLORS[s] ? `${SOURCE_COLORS[s]}20` : "#1a1a1a",
                            color: SOURCE_COLORS[s] ?? "#888",
                          }}
                        >
                          {SOURCE_LABELS[s] ?? s}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => addItem(r)}
                    disabled={isAdding || isAdded}
                    className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                    style={{
                      background: isAdded ? "#1a2e1a" : "#ffffff15",
                      color: isAdded ? "#4ade80" : "#fff",
                    }}
                  >
                    {isAdded ? "Added ✓" : isAdding ? "..." : "+ Add"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
