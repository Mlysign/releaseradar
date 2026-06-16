"use client";
import { useState } from "react";
import { TYPE_COLORS, SOURCE_COLORS, SOURCE_LABELS, ROLE_LABELS } from "@/lib/constants";
import SearchBar from "@/components/SearchBar";
import FacetAutocomplete from "@/components/discovery/FacetAutocomplete";
import { FacetPill, VocabMatch } from "@/components/discovery/types";
import Chip from "@/components/ui/Chip";

export type ViewMode = "list" | "card" | "calendar";

// Must-include / must-exclude facet filters (T6). Lives in SubBar's always-visible
// filter section so it sits next to type/source — no popover, consistent everywhere.
export interface SearchBarFacets {
  include: FacetPill[];
  exclude: FacetPill[];
  onAdd: (key: "include" | "exclude", m: VocabMatch) => void;
  onRemove: (key: "include" | "exclude", index: number) => void;
}

interface SubBarProps {
  // Type filter chips
  activeTypes: string[];
  onToggleType: (t: string) => void;
  availableTypes?: string[];          // defaults to game/movie/show

  // Source filter chips (optional)
  activeSources?: string[];
  onToggleSource?: (s: string) => void;
  availableSources?: string[];

  // Search
  searchValue: string;
  onSearchChange: (val: string) => void;
  searchPlaceholder?: string;
  searchFacets?: SearchBarFacets;     // must-include/exclude (T6) — rendered inline

  // Hide-rated toggle (Library) — a standard, shared control
  hideRated?: { value: boolean; onChange: (v: boolean) => void };

  // Sort (search results, T8)
  sort?: { value: string; onChange: (v: string) => void; options: [string, string][] };

  // Year + membership filters (rendered as an inline sticky row — see FilterPanel)
  advancedFilters?: React.ReactNode;

  // View mode
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  availableViews?: ViewMode[];        // defaults to list/card

  // Extra filter controls appended to the filter row
  filters?: React.ReactNode;

  // Right-side actions (sync button, etc.)
  actions?: React.ReactNode;
}

function FacetChip({ pill, color, onRemove }: { pill: FacetPill; color: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full" style={{ background: `${color}1f`, color }}>
      {pill.label}{pill.role ? ` (${ROLE_LABELS[pill.role] ?? pill.role})` : ""}
      <button onClick={onRemove} aria-label={`Remove ${pill.label}`} className="opacity-70 hover:opacity-100">×</button>
    </span>
  );
}

export default function SubBar({
  activeTypes,
  onToggleType,
  availableTypes = ["game", "movie", "show"],
  activeSources = [],
  onToggleSource,
  availableSources = [],
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  searchFacets,
  hideRated,
  sort,
  advancedFilters,
  view,
  onViewChange,
  availableViews = ["list", "card"],
  filters,
  actions,
}: SubBarProps) {
  // On mobile the advanced rows (facets + year/membership) collapse behind a
  // "Filters" toggle so the bar doesn't eat the viewport; on md+ they stay
  // always-visible (T24). The toggle only appears when there's something to show.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasAdvanced = !!(searchFacets || advancedFilters);

  return (
    <div className="sticky top-14 z-20 bg-neutral-950 border-b border-neutral-800/60 px-6 py-3 space-y-2.5">
      <div className="max-w-6xl mx-auto space-y-2.5">

        {/* Row 1 — type + source filters + hide-rated + extras */}
        <div className="flex flex-wrap items-center gap-2">
          {/* All pill — clears the type filter */}
          <Chip
            active={activeTypes.length === 0}
            onClick={() => activeTypes.length > 0 && activeTypes.forEach(onToggleType)}
          >
            All
          </Chip>

          {availableTypes.map((t) => (
            <Chip
              key={t}
              active={activeTypes.includes(t)}
              color={TYPE_COLORS[t]}
              dot={TYPE_COLORS[t]}
              onClick={() => onToggleType(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}s
            </Chip>
          ))}

          {availableSources.length > 0 && onToggleSource && (
            <>
              <div className="w-px h-4 bg-neutral-800 mx-1" />
              {availableSources.map((s) => (
                <Chip
                  key={s}
                  active={activeSources.includes(s)}
                  color={SOURCE_COLORS[s]}
                  dot={SOURCE_COLORS[s]}
                  onClick={() => onToggleSource(s)}
                >
                  {SOURCE_LABELS[s] ?? s}
                </Chip>
              ))}
            </>
          )}

          {hideRated && (
            <>
              <div className="w-px h-4 bg-neutral-800 mx-1" />
              <Chip
                active={hideRated.value}
                onClick={() => hideRated.onChange(!hideRated.value)}
                title="Hide items you've already rated"
              >
                Hide rated
              </Chip>
            </>
          )}

          {filters && (
            <>
              <div className="w-px h-4 bg-neutral-800 mx-1" />
              {filters}
            </>
          )}
        </div>

        {/* Rows 2 & 2.5 — advanced filters (facets + year/membership). Always shown
            on md+; collapse behind the mobile "Filters" toggle below md. */}
        {hasAdvanced && (
          <div className={`${filtersOpen ? "block" : "hidden"} md:block space-y-2.5`}>
            {searchFacets && (
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-neutral-500 whitespace-nowrap">Must include</span>
                  <div className="w-44"><FacetAutocomplete mode="facets" placeholder="tag, person, studio…" accent="#14532d" onPick={(m) => searchFacets.onAdd("include", m as VocabMatch)} /></div>
                  {searchFacets.include.map((p, i) => <FacetChip key={`i${i}`} pill={p} color="#4ade80" onRemove={() => searchFacets.onRemove("include", i)} />)}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-neutral-500 whitespace-nowrap">Must exclude</span>
                  <div className="w-44"><FacetAutocomplete mode="facets" placeholder="tag, person, studio…" accent="#7f1d1d" onPick={(m) => searchFacets.onAdd("exclude", m as VocabMatch)} /></div>
                  {searchFacets.exclude.map((p, i) => <FacetChip key={`e${i}`} pill={p} color="#f87171" onRemove={() => searchFacets.onRemove("exclude", i)} />)}
                </div>
              </div>
            )}

            {/* Year + membership */}
            {advancedFilters}
          </div>
        )}

        {/* Row 3 — search + sort + view mode + actions */}
        <div className="flex flex-wrap items-center gap-3">
          <SearchBar value={searchValue} onChange={onSearchChange} placeholder={searchPlaceholder} />

          {hasAdvanced && (
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              className="md:hidden flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border transition-colors"
              style={{
                borderColor: filtersOpen ? "#fff" : "rgb(38,38,38)",
                background: filtersOpen ? "#ffffff15" : "#171717",
                color: filtersOpen ? "#fff" : "#9ca3af",
              }}
            >
              Filters
            </button>
          )}

          {sort && (
            <select
              value={sort.value}
              onChange={(e) => sort.onChange(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 outline-none flex-shrink-0"
              aria-label="Sort results"
              title="Sort results"
            >
              {sort.options.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          )}

          {/* View mode toggle */}
          <div className="flex bg-neutral-900 border border-neutral-800 rounded-lg p-0.5 flex-shrink-0" role="group" aria-label="View mode">
            {availableViews.map((v) => (
              <button
                key={v}
                onClick={() => onViewChange(v)}
                aria-label={`${v.charAt(0).toUpperCase() + v.slice(1)} view`}
                aria-pressed={view === v}
                className={`px-2.5 py-1.5 rounded-md transition-colors text-xs capitalize ${
                  view === v ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-white"
                }`}
                title={v.charAt(0).toUpperCase() + v.slice(1)}
              >
                <span aria-hidden>{v === "list" ? "≡" : v === "card" ? "⊞" : "▦"}</span>
              </button>
            ))}
          </div>

          {actions}
        </div>
      </div>
    </div>
  );
}
