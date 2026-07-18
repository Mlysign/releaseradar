"use client";
import { useState } from "react";
import { ScoringConfigValues, TagCategoryConfig, Reason, ROLE_ORDER } from "./types";
import { ROLE_LABELS } from "@/lib/constants";

interface PreviewResult {
  itemId: string;
  itemTitle: string;
  score: number | null;
  reasons: Reason[];
  coldStart: boolean;
}

const numInput = "w-24 bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-sm text-neutral-100";

export default function WeightsPanel({
  config, categories, onSaved,
}: {
  config: ScoringConfigValues;
  categories: TagCategoryConfig[];
  onSaved: () => void;
}) {
  const [draftConfig, setDraftConfig] = useState<ScoringConfigValues>(config);
  const [draftCategories, setDraftCategories] = useState<TagCategoryConfig[]>(categories);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const setRoleWeight = (role: string, value: number) =>
    setDraftConfig((c) => ({ ...c, roleWeights: { ...c.roleWeights, [role]: value } }));

  const setCategory = (id: string, patch: Partial<TagCategoryConfig>) =>
    setDraftCategories((cats) => cats.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  async function runPreview() {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/dev/scoring/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: draftConfig,
          categoryWeights: draftCategories.map((c) => ({ id: c.id, weight: c.weight, ignored: c.ignored })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setPreviewError(data.error ?? "Preview failed"); setPreview(null); return; }
      setPreview(data);
    } catch {
      setPreviewError("Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await Promise.all([
        fetch("/api/dev/scoring", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftConfig),
        }),
        fetch("/api/dev/scoring/categories", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: draftCategories.map((c) => ({ id: c.id, weight: c.weight, ignored: c.ignored })) }),
        }),
      ]);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-6">
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-200">Role weights</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {ROLE_ORDER.map((role) => (
              <label key={role} className="flex items-center justify-between gap-2 text-sm text-neutral-400">
                {ROLE_LABELS[role] ?? role}
                <input
                  type="number" step="0.1" min="0"
                  className={numInput}
                  value={draftConfig.roleWeights[role] ?? 1}
                  onChange={(e) => setRoleWeight(role, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-200">Category weights</h2>
          <div className="space-y-1.5">
            {draftCategories.map((c) => (
              <div key={c.id} className="flex items-center gap-3 text-sm">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="flex-1 min-w-0 truncate text-neutral-300">{c.label}</span>
                <input
                  type="number" step="0.1" min="0"
                  className={numInput}
                  value={c.weight}
                  disabled={c.ignored}
                  onChange={(e) => setCategory(c.id, { weight: Number(e.target.value) })}
                />
                <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <input type="checkbox" checked={c.ignored} onChange={(e) => setCategory(c.id, { ignored: e.target.checked })} />
                  Ignored
                </label>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-200">Calibration</h2>
          <div className="grid grid-cols-1 gap-2 text-sm">
            <label className="flex items-center justify-between gap-2 text-neutral-400">
              Prior strength (C) — shrinkage toward your baseline
              <input type="number" step="1" min="0" className={numInput} value={draftConfig.priorStrength}
                onChange={(e) => setDraftConfig((c) => ({ ...c, priorStrength: Number(e.target.value) }))} />
            </label>
            <label className="flex items-center justify-between gap-2 text-neutral-400">
              Mapping constant (K) — 50 + K·weightedDev
              <input type="number" step="1" min="0" className={numInput} value={draftConfig.mappingConstant}
                onChange={(e) => setDraftConfig((c) => ({ ...c, mappingConstant: Number(e.target.value) }))} />
            </label>
            <label className="flex items-center justify-between gap-2 text-neutral-400">
              Per-category cap — top-N tags per category
              <input type="number" step="1" min="1" className={numInput} value={draftConfig.perCategoryCap}
                onChange={(e) => setDraftConfig((c) => ({ ...c, perCategoryCap: Number(e.target.value) }))} />
            </label>
          </div>
        </section>

        <div className="flex gap-3">
          <button onClick={runPreview} disabled={previewing}
            className="px-3.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-200 transition-colors disabled:opacity-50">
            {previewing ? "Previewing…" : "Preview"}
          </button>
          <button onClick={save} disabled={saving}
            className="px-3.5 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-neutral-200 transition-colors disabled:opacity-50">
            {saving ? "Saving…" : "Save weights"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 h-fit sticky top-4">
        <h2 className="text-sm font-semibold text-neutral-200 mb-3">Preview</h2>
        {!preview && !previewError && (
          <p className="text-sm text-neutral-500">
            Scores your own top-rated library item (or the last previewed one) against these draft weights — nothing is saved.
          </p>
        )}
        {previewError && <p className="text-sm text-red-400">{previewError}</p>}
        {preview && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-400 truncate">{preview.itemTitle}</p>
            {preview.coldStart ? (
              <p className="text-sm text-neutral-500">Cold-start: not enough rated items to score.</p>
            ) : preview.score == null ? (
              <p className="text-sm text-neutral-500">No facet on this item matches your profile.</p>
            ) : (
              <>
                <p className="text-3xl font-bold text-neutral-100">{Math.round(preview.score)}</p>
                <div className="space-y-1">
                  {preview.reasons.map((r) => (
                    <div key={`${r.kind}|${r.role ?? ""}|${r.label}`} className="flex items-center justify-between text-xs">
                      <span className="text-neutral-400 truncate">{r.label}</span>
                      <span className={r.contribution >= 0 ? "text-green-400" : "text-red-400"}>
                        {r.contribution >= 0 ? "+" : ""}{r.contribution.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
