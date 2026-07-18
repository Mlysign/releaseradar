"use client";
import { useEffect, useState, useCallback } from "react";
import { ScoringConfigValues, TagCategoryConfig } from "./types";
import WeightsPanel from "./WeightsPanel";
import TaxonomyPanel from "./TaxonomyPanel";

// H5.4 — /dev/scoring: the Fandex Score dev backend (docs/fandex-score.md §5).
// Two tabs: Weights & tuning (role/category weights, C, K, cap — live
// preview) and Taxonomy (category CRUD + tag reassignment triage).

export interface OverrideEntry { tagKey: string; categoryId: string }

export default function ScoringAdmin() {
  const [tab, setTab] = useState<"weights" | "taxonomy">("weights");
  const [config, setConfig] = useState<ScoringConfigValues | null>(null);
  const [categories, setCategories] = useState<TagCategoryConfig[]>([]);
  const [overrides, setOverrides] = useState<OverrideEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/scoring");
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setConfig(data.config);
      setCategories(data.categories);
      setOverrides(data.overrides);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-100">Fandex Score — Admin</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Tune the taste-match engine and edit the tag taxonomy. Changes here affect every user&apos;s Fandex Score.
        </p>
      </div>

      <div className="flex gap-1 border-b border-neutral-800">
        {(["weights", "taxonomy"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-white text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t === "weights" ? "Weights & Tuning" : "Taxonomy"}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && !error && config && (
        tab === "weights" ? (
          <WeightsPanel config={config} categories={categories} onSaved={load} />
        ) : (
          <TaxonomyPanel categories={categories} overrides={overrides} onChanged={load} />
        )
      )}
    </div>
  );
}
