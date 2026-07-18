"use client";
import { useEffect, useState, useCallback } from "react";
import { TagCategoryConfig } from "./types";
import { OverrideEntry } from "./ScoringAdmin";

interface VocabTag { key: string; label: string; count: number; category: string; overridden: boolean }

const inputCls = "bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-sm text-neutral-100";

export default function TaxonomyPanel({
  categories, overrides, onChanged,
}: {
  categories: TagCategoryConfig[];
  overrides: OverrideEntry[];
  onChanged: () => void;
}) {
  return (
    <div className="space-y-6">
      <CategoryList categories={categories} onChanged={onChanged} />
      <TagTriage categories={categories} overrides={overrides} onChanged={onChanged} />
    </div>
  );
}

function CategoryList({ categories, onChanged }: { categories: TagCategoryConfig[]; onChanged: () => void }) {
  const [newCat, setNewCat] = useState({ id: "", label: "", color: "#9ca3af" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addCategory() {
    setBusy("new");
    setError(null);
    try {
      const res = await fetch("/api/dev/scoring/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newCat.id, label: newCat.label, color: newCat.color, weight: 1, ignored: false }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not create category"); return; }
      setNewCat({ id: "", label: "", color: "#9ca3af" });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function removeCategory(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/dev/scoring/categories?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-neutral-200">Categories</h2>
      <p className="text-xs text-neutral-500">
        Weight/ignored are edited in the Weights &amp; Tuning tab — this is id/label/color, and creating or removing a category.
      </p>
      <div className="space-y-1.5">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-3 text-sm">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
            <span className="w-28 shrink-0 text-neutral-500 font-mono text-xs truncate">{c.id}</span>
            <span className="flex-1 min-w-0 truncate text-neutral-300">{c.label}</span>
            <span className="text-xs text-neutral-600">{c.ignored ? "ignored" : `w=${c.weight}`}</span>
            <button onClick={() => removeCategory(c.id)} disabled={busy === c.id}
              className="text-xs text-neutral-500 hover:text-red-400 transition-colors disabled:opacity-50">
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-neutral-800/70">
        <input placeholder="id (lowercase-kebab)" value={newCat.id} onChange={(e) => setNewCat((c) => ({ ...c, id: e.target.value }))}
          className={`${inputCls} w-40`} />
        <input placeholder="Label" value={newCat.label} onChange={(e) => setNewCat((c) => ({ ...c, label: e.target.value }))}
          className={`${inputCls} flex-1 min-w-0`} />
        <input type="color" value={newCat.color} onChange={(e) => setNewCat((c) => ({ ...c, color: e.target.value }))}
          className="w-9 h-8 rounded-md bg-neutral-950 border border-neutral-700" />
        <button onClick={addCategory} disabled={busy === "new" || !newCat.id || !newCat.label}
          className="px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-200 transition-colors disabled:opacity-50">
          Add
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}

function TagTriage({
  categories, overrides, onChanged,
}: {
  categories: TagCategoryConfig[];
  overrides: OverrideEntry[];
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState("other");
  const [tags, setTags] = useState<VocabTag[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const overrideByKey = new Map(overrides.map((o) => [o.tagKey, o.categoryId]));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: "100" });
      if (filter !== "all") p.set("category", filter);
      const res = await fetch(`/api/dev/scoring/vocab?${p}`);
      const data = await res.json();
      setTags(data.tags ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function reassign(tagKey: string, categoryId: string) {
    setBusyKey(tagKey);
    try {
      await fetch("/api/dev/scoring/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagKey, categoryId }),
      });
      await load();
      onChanged();
    } finally {
      setBusyKey(null);
    }
  }

  async function revert(tagKey: string) {
    setBusyKey(tagKey);
    try {
      await fetch(`/api/dev/scoring/overrides?tagKey=${encodeURIComponent(tagKey)}`, { method: "DELETE" });
      await load();
      onChanged();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-200">Tag triage</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={inputCls}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <p className="text-xs text-neutral-500">
        {loading ? "Loading…" : `${total} tag${total === 1 ? "" : "s"} in this bucket, by catalog frequency.`}
      </p>

      <div className="max-h-96 overflow-y-auto space-y-1">
        {tags.map((t) => (
          <div key={t.key} className="flex items-center gap-3 text-sm">
            <span className="flex-1 min-w-0 truncate text-neutral-300">{t.label}</span>
            <span className="text-xs text-neutral-600 w-10 text-right shrink-0">{t.count}×</span>
            <select
              value={overrideByKey.get(t.key) ?? t.category}
              disabled={busyKey === t.key}
              onChange={(e) => reassign(t.key, e.target.value)}
              className={`${inputCls} w-36 shrink-0`}
            >
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {t.overridden && (
              <button onClick={() => revert(t.key)} disabled={busyKey === t.key}
                className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors shrink-0 disabled:opacity-50">
                Revert
              </button>
            )}
          </div>
        ))}
        {!loading && tags.length === 0 && <p className="text-sm text-neutral-600">No tags in this bucket.</p>}
      </div>
    </section>
  );
}
