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

interface PinnedItem {
  id: string;
  title: string;
  type: string;
}

const numInput = "w-24 bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-sm text-neutral-100";
const MAX_PINNED = 3;

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
  const [previews, setPreviews] = useState<PreviewResult[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PinnedItem[]>([]);
  const [searching, setSearching] = useState(false);

  const setRoleWeight = (role: string, value: number) =>
    setDraftConfig((c) => ({ ...c, roleWeights: { ...c.roleWeights, [role]: value } }));

  const setCategory = (id: string, patch: Partial<TagCategoryConfig>) =>
    setDraftCategories((cats) => cats.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  async function runSearch() {
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/dev/scoring/library-search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.results ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function pinItem(item: PinnedItem) {
    setPinnedItems((cur) => (cur.some((p) => p.id === item.id) || cur.length >= MAX_PINNED ? cur : [...cur, item]));
    setSearchQuery("");
    setSearchResults([]);
  }

  function unpinItem(id: string) {
    setPinnedItems((cur) => cur.filter((p) => p.id !== id));
  }

  async function runPreview() {
    setPreviewing(true);
    setPreviewError(null);
    const targets: (string | undefined)[] = pinnedItems.length > 0 ? pinnedItems.map((p) => p.id) : [undefined];
    try {
      const results = await Promise.all(targets.map(async (itemId) => {
        const res = await fetch("/api/dev/scoring/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId,
            config: draftConfig,
            categoryWeights: draftCategories.map((c) => ({ id: c.id, weight: c.weight, ignored: c.ignored })),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Preview failed");
        return data as PreviewResult;
      }));
      setPreviews(results);
    } catch (e) {
      setPreviews([]);
      setPreviewError(e instanceof Error ? e.message : "Preview failed");
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

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-neutral-200">Calibration</h2>
          <div className="grid grid-cols-1 gap-4 text-sm">
            <div className="space-y-1">
              <label className="flex items-center justify-between gap-2 text-neutral-400">
                Prior strength (C)
                <input type="number" step="1" min="0" className={numInput} value={draftConfig.priorStrength}
                  onChange={(e) => setDraftConfig((c) => ({ ...c, priorStrength: Number(e.target.value) }))} />
              </label>
              <p className="text-xs text-neutral-500">
                How skeptical the model is of small samples. Each facet&apos;s rating average is pulled toward your
                overall baseline until it has ~C rated items of evidence. Higher C = a one-off rating barely moves
                the needle; lower C = a single item swings that facet&apos;s score faster.
              </p>
            </div>
            <div className="space-y-1">
              <label className="flex items-center justify-between gap-2 text-neutral-400">
                Mapping constant, above your average (K_up)
                <input type="number" step="1" min="0" className={numInput} value={draftConfig.mappingConstantUp}
                  onChange={(e) => setDraftConfig((c) => ({ ...c, mappingConstantUp: Number(e.target.value) }))} />
              </label>
              <p className="text-xs text-neutral-500">
                Formula: <code className="text-neutral-400">yourAvgRating×10 + K · weightedDev</code>. Applied when an
                item scores above your own average rating. Higher K_up = a good match swings up more dramatically.
              </p>
            </div>
            <div className="space-y-1">
              <label className="flex items-center justify-between gap-2 text-neutral-400">
                Mapping constant, below your average (K_down)
                <input type="number" step="1" min="0" className={numInput} value={draftConfig.mappingConstantDown}
                  onChange={(e) => setDraftConfig((c) => ({ ...c, mappingConstantDown: Number(e.target.value) }))} />
              </label>
              <p className="text-xs text-neutral-500">
                Same formula, applied when an item scores below your average. Set lower than K_up to skew the visible
                range toward enthusiasm — mismatches drop off gently instead of the score reading as "you won&apos;t
                like this." The center itself (your own average rating, ×10) is not a knob — only these two gains are.
              </p>
            </div>
            <div className="space-y-1">
              <label className="flex items-center justify-between gap-2 text-neutral-400">
                Per-category cap
                <input type="number" step="1" min="1" className={numInput} value={draftConfig.perCategoryCap}
                  onChange={(e) => setDraftConfig((c) => ({ ...c, perCategoryCap: Number(e.target.value) }))} />
              </label>
              <p className="text-xs text-neutral-500">
                Only the top-N tags per category (by contribution) count toward the score, so an item tagged with
                many tags in one category (e.g. 15 mood tags) can&apos;t drown out a single strong director/cast signal.
              </p>
            </div>
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

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 h-fit sticky top-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-200 mb-2">Preview</h2>
          <form
            onSubmit={(e) => { e.preventDefault(); void runSearch(); }}
            className="flex gap-2"
          >
            <input
              type="text"
              placeholder="Search your library to pin an item…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={pinnedItems.length >= MAX_PINNED}
              className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={pinnedItems.length >= MAX_PINNED || searching}
              className="px-2.5 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 transition-colors disabled:opacity-50 shrink-0"
            >
              {searching ? "…" : "Search"}
            </button>
          </form>
          {pinnedItems.length >= MAX_PINNED && (
            <p className="text-xs text-neutral-500 mt-1">Max {MAX_PINNED} items pinned — remove one to add another.</p>
          )}
          {searchResults.length > 0 && (
            <div className="mt-1.5 rounded-md border border-neutral-700 bg-neutral-950 max-h-48 overflow-y-auto divide-y divide-neutral-800">
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => pinItem(r)}
                  className="w-full text-left px-2.5 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 truncate block"
                >
                  {r.title} <span className="text-neutral-500 text-xs">· {r.type}</span>
                </button>
              ))}
            </div>
          )}
          {pinnedItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {pinnedItems.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-md bg-neutral-800 text-xs text-neutral-300">
                  <span className="truncate max-w-[10rem]">{p.title}</span>
                  <button
                    type="button"
                    onClick={() => unpinItem(p.id)}
                    aria-label={`Unpin ${p.title}`}
                    className="text-neutral-500 hover:text-neutral-200 leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {previews.length === 0 && !previewError && (
          <p className="text-sm text-neutral-500">
            {pinnedItems.length > 0
              ? "Hit Preview to score your pinned items against these draft weights — nothing is saved."
              : "Scores your own top-rated library item against these draft weights — nothing is saved. Pin up to 3 specific items above to compare instead."}
          </p>
        )}
        {previewError && <p className="text-sm text-red-400">{previewError}</p>}
        {previews.length > 0 && (
          <div className="space-y-4 divide-y divide-neutral-800">
            {previews.map((preview) => (
              <div key={preview.itemId} className="pt-4 first:pt-0 space-y-2">
                <p className="text-sm text-neutral-400 truncate">{preview.itemTitle}</p>
                {preview.coldStart ? (
                  <p className="text-sm text-neutral-500">Cold-start: not enough rated items to score.</p>
                ) : preview.score == null ? (
                  <p className="text-sm text-neutral-500">No facet on this item matches your profile.</p>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-neutral-100">{Math.round(preview.score)}</p>
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
