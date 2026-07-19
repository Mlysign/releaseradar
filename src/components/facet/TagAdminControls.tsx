"use client";
import { useEffect, useState } from "react";

// Q18 (2026-07-19) — inline taxonomy editing on the public /tag page, for
// SCORING_ADMIN_USER_IDS-whitelisted viewers only. Reuses the exact same
// admin-gated endpoints /dev/scoring's Taxonomy tab already calls
// (/api/dev/scoring/{overrides,aliases,vocab}) — no new write paths, no new
// admin gate. `GET /api/dev/scoring` 404s for a non-admin (withScoringAdmin's
// fail-closed rule), which doubles as this component's own admin check: a
// 200 means render; a 404 (or logged-out) means render nothing.

interface CategoryOpt { id: string; label: string; color: string }
interface VocabTag { key: string; label: string; count: number }
interface Bundle { canonical: string; members: string[] }

export default function TagAdminControls({
  tagKey, currentCategoryId, bundle, onBundleChange,
}: {
  tagKey: string;
  currentCategoryId: string | null;
  bundle: Bundle | null;
  onBundleChange: (b: Bundle | null) => void;
}) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [categories, setCategories] = useState<CategoryOpt[]>([]);
  const [savingCategory, setSavingCategory] = useState(false);

  const [vocab, setVocab] = useState<VocabTag[] | null>(null);
  const [query, setQuery] = useState("");
  const [bundling, setBundling] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/dev/scoring")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { categories?: CategoryOpt[] } | null) => {
        if (!alive || !d) return;
        setIsAdmin(true);
        setCategories(d.categories ?? []);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!isAdmin) return null;

  async function saveCategory(id: string) {
    setSavingCategory(true);
    try {
      await fetch("/api/dev/scoring/overrides", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagKey, categoryId: id }),
      });
    } finally {
      setSavingCategory(false);
    }
  }

  async function loadVocab() {
    if (vocab) return;
    const r = await fetch("/api/dev/scoring/vocab?limit=1000");
    if (r.ok) { const d = await r.json(); setVocab(d.tags ?? []); }
  }

  async function addToBundle(otherKey: string) {
    if (otherKey === tagKey) return;
    setBundling(otherKey);
    try {
      const res = await fetch("/api/dev/scoring/aliases", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical: tagKey, members: [otherKey] }),
      });
      if (res.ok) {
        const d = await res.json();
        const b = (d.bundles as Bundle[] | undefined)?.find((x) => x.canonical === tagKey);
        onBundleChange(b ?? { canonical: tagKey, members: [otherKey] });
        setQuery("");
      }
    } finally {
      setBundling(null);
    }
  }

  async function removeMember(member: string) {
    const res = await fetch(`/api/dev/scoring/aliases?alias=${encodeURIComponent(member)}`, { method: "DELETE" });
    if (res.ok) {
      const d = await res.json();
      const b = (d.bundles as Bundle[] | undefined)?.find((x) => x.canonical === tagKey);
      onBundleChange(b ?? null);
    }
  }

  const suggestions = query.trim().length >= 2 && vocab
    ? vocab.filter((v) => v.key !== tagKey && !bundle?.members.includes(v.key) && v.label.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div className="rounded-xl border border-dashed border-amber-700/50 bg-amber-950/10 p-3 space-y-3 text-xs">
      <p className="text-amber-500/80 font-semibold uppercase tracking-wide text-[10px]">Admin — taxonomy editor</p>

      <div className="flex items-center gap-2">
        <span className="text-neutral-400 shrink-0">Category</span>
        <select
          defaultValue={currentCategoryId ?? ""}
          disabled={savingCategory}
          onChange={(e) => saveCategory(e.target.value)}
          className="text-xs px-2 py-1 rounded-md bg-neutral-900 border border-neutral-700 outline-none"
        >
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        {savingCategory && <span className="text-neutral-500">Saving…</span>}
      </div>

      <div className="space-y-1.5">
        <span className="text-neutral-400 block">Bundle</span>
        {bundle && bundle.members.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {bundle.members.map((m) => (
              <span key={m} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300">
                {m}
                <button onClick={() => removeMember(m)} aria-label={`Remove ${m} from bundle`} className="opacity-60 hover:opacity-100">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <input
            type="text"
            value={query}
            onFocus={loadVocab}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a tag to bundle with…"
            className="w-64 text-xs px-2 py-1 rounded-md bg-neutral-900 border border-neutral-700 outline-none placeholder:text-neutral-600"
          />
          {suggestions.length > 0 && (
            <div className="absolute z-30 mt-1 w-64 rounded-md border border-neutral-700 bg-neutral-900 shadow-xl max-h-48 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={s.key}
                  onClick={() => addToBundle(s.key)}
                  disabled={bundling === s.key}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-neutral-800 text-neutral-300 flex items-center justify-between gap-2"
                >
                  <span>{s.label}</span>
                  <span className="text-neutral-600">{s.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
