"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EnrichedItem, MediaType } from "@/types";
import { SOURCE_LABELS } from "@/lib/constants";
import { useViewMode } from "@/lib/useViewMode";
import NavBar from "@/components/NavBar";
import SubBar, { ViewMode, SearchBarFacets } from "@/components/SubBar";
import { FacetPill, VocabMatch, SortKey, SORTS, DATE_SORTS, UiFilters, Membership, defaultUiFilters } from "@/components/discovery/types";
import FilterPanel from "@/components/discovery/FilterPanel";
import { matchesFacets, passesYearMembership } from "@/lib/facetFilter";
import { sortItems, platformRating10 } from "@/lib/sortItems";
import { usePersistedState, useScrollRestore } from "@/lib/usePersistedState";
import { buildItemHref } from "@/lib/itemUrl";
import CalendarView from "@/components/CalendarView";
import GroupedView from "@/components/GroupedView";
import ErrorBoundary, { ListSkeleton, CardSkeleton } from "@/components/ErrorBoundary";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";

type Filter = { types: MediaType[] };

const SYNC_STALE_MS = 24 * 60 * 60 * 1000;

// ── First-run onboarding checklist (distinct from the shared <EmptyState>) ──

function OnboardingState({ identities }: { identities: any[] }) {
  const connectedProviders = new Set(identities.map((i: any) => i.provider));
  const hasAny = connectedProviders.size > 0;

  const steps = [
    {
      label: "Connect an account",
      done: hasAny,
      action: <Link href="/settings" className="text-xs px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors">Go to Profile →</Link>,
      detail: hasAny
        ? `Connected: ${[...connectedProviders].map((p) => SOURCE_LABELS[p] ?? p).join(", ")}`
        : "Link Steam, Trakt, or RAWG to import your lists automatically.",
    },
    {
      label: "Add items from Discover",
      done: false,
      action: <Link href="/discover" className="text-xs px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors">Go to Discover →</Link>,
      detail: "Browse upcoming releases and add them to your wishlist.",
    },
    {
      label: "Your release calendar is ready",
      done: false,
      action: null,
      detail: "Upcoming releases appear here sorted by date, in list, card, or calendar view.",
    },
  ];

  return (
    <div className="max-w-md mx-auto mt-16 px-4">
      <div className="text-center mb-10">
        <p className="text-2xl font-bold mb-2">Welcome to ReleaseRadar</p>
        <p className="text-neutral-400 text-sm">Track every game, movie, and show you&apos;re waiting for — in one place.</p>
      </div>
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div
            key={i}
            className="flex gap-4 p-4 rounded-xl border"
            style={{
              borderColor: step.done ? "rgba(74,222,128,0.25)" : "rgb(38,38,38)",
              background: step.done ? "rgba(74,222,128,0.04)" : "rgba(23,23,23,0.5)",
            }}
          >
            <div
              className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
              style={{ background: step.done ? "#4ade80" : "rgb(38,38,38)", color: step.done ? "#000" : "#555" }}
            >
              {step.done ? "✓" : i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3 mb-1">
                <p className={`text-sm font-medium ${step.done ? "text-neutral-300" : "text-white"}`}>{step.label}</p>
                {step.action}
              </div>
              <p className="text-xs text-neutral-500 leading-relaxed">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [identities, setIdentities] = useState<any[]>([]);
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [view, setView] = useViewMode("list", ["list", "card", "calendar"]);
  // Persisted across back-nav (T12).
  const [filter, setFilter] = usePersistedState<Filter>("rr_wishlist_filter", { types: [] });
  const [search, setSearch] = usePersistedState("rr_wishlist_search", "");
  const [includeFacets, setIncludeFacets] = usePersistedState<FacetPill[]>("rr_wishlist_incFacets", []);
  const [excludeFacets, setExcludeFacets] = usePersistedState<FacetPill[]>("rr_wishlist_excFacets", []);
  const [sort, setSort] = usePersistedState<SortKey>("rr_wishlist_sort", "releaseOld");
  const [yearRange, setYearRange] = usePersistedState<[number, number]>("rr_wishlist_year", defaultUiFilters().yearRange);
  const [membership, setMembership] = usePersistedState<{ library?: Membership; wishlist?: Membership }>("rr_wishlist_membership", {});

  useEffect(() => { init(); }, []);

  async function init() {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (!data.user) { router.push("/"); return; }
    setIdentities(data.identities ?? []);
    const syncLogs: { last_sync: number }[] = data.syncLogs ?? [];
    const latestSyncMs = syncLogs.length > 0 ? Math.max(...syncLogs.map((l) => l.last_sync * 1000)) : 0;
    if (Date.now() - latestSyncMs > SYNC_STALE_MS && (data.identities ?? []).length > 0) {
      setAutoSyncing(true);
      fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "all" }) })
        .finally(() => setAutoSyncing(false));
    }
    await loadItems();
  }

  async function loadItems() {
    setLoading(true);
    const res = await fetch("/api/calendar");
    const data = await res.json();
    setItems(data.items ?? []);
    setLoading(false);
  }

  async function sync() {
    setSyncing(true);
    await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "all" }) });
    await loadItems();
    setSyncing(false);
  }

  function toggleFilter<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
  }

  const searchFacets: SearchBarFacets = {
    include: includeFacets,
    exclude: excludeFacets,
    onAdd: (key, m: VocabMatch) => {
      const pill: FacetPill = { kind: m.kind, role: m.role, key: m.key, label: m.label };
      const setter = key === "include" ? setIncludeFacets : setExcludeFacets;
      setter((arr) => (arr.some((x) => x.kind === pill.kind && x.role === pill.role && x.key === pill.key) ? arr : [...arr, pill]));
    },
    onRemove: (key, i) => {
      const setter = key === "include" ? setIncludeFacets : setExcludeFacets;
      setter((arr) => arr.filter((_, idx) => idx !== i));
    },
  };

  // Year + membership for the shared FilterPanel (rendered in the sticky SubBar).
  const advFilters: UiFilters = { ...defaultUiFilters(), types: filter.types, includeFacets, excludeFacets, yearRange, membership };
  const patchAdvanced = (patch: Partial<UiFilters>) => {
    if (patch.yearRange) setYearRange(patch.yearRange);
    if (patch.membership) setMembership(patch.membership);
  };

  const q = search.trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (filter.types.length > 0 && !filter.types.includes(item.type)) return false;
    if (q && !item.title.toLowerCase().includes(q)) return false;
    if (!matchesFacets(item, includeFacets, excludeFacets)) return false;
    if (!passesYearMembership(item, yearRange, membership)) return false;
    return true;
  });
  const sorted = sortItems(filtered, sort);

  // The item whose id matches the search query (for highlight ring)
  const highlightId = q && sorted.length > 0 ? sorted[0].id : null;

  const isBusy = syncing || autoSyncing;

  // Sort-driven layout (T8): rating sorts group by rating, best-match is flat,
  // date sorts keep the month grouping; calendar view only for date sorts.
  const isDateSort = DATE_SORTS.includes(sort);
  const groupBy: "month" | "rating" | "none" =
    sort === "userRating" || sort === "platformRating" ? "rating" : sort === "match" ? "none" : "month";
  const descending = sort === "releaseNew";
  const ratingOf =
    sort === "userRating" ? (i: any) => i.rating ?? null
    : sort === "platformRating" ? (i: any) => platformRating10(i)
    : undefined;
  const availableViews: ViewMode[] = isDateSort ? ["list", "card", "calendar"] : ["list", "card"];
  const effView: ViewMode = !isDateSort && view === "calendar" ? "card" : view;
  useScrollRestore("rr_wishlist_scroll", !loading && sorted.length > 0);

  return (
    <div className="min-h-screen">
      <NavBar />

      <SubBar
        activeTypes={filter.types}
        onToggleType={(t) => setFilter((f) => ({ ...f, types: toggleFilter(f.types, t as MediaType) }))}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search your wishlist…"
        searchFacets={searchFacets}
        sort={{ value: sort, onChange: (v) => setSort(v as SortKey), options: SORTS }}
        advancedFilters={<FilterPanel filters={advFilters} onChange={patchAdvanced} />}
        view={effView}
        onViewChange={setView}
        availableViews={availableViews}
        actions={
          <button
            onClick={sync}
            disabled={isBusy}
            className="flex-shrink-0 text-sm px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg disabled:opacity-40 transition-colors border border-neutral-700 whitespace-nowrap"
          >
            {autoSyncing ? <span className="animate-pulse">Syncing…</span> : syncing ? "Syncing…" : "Sync"}
          </button>
        }
      />

      <main className="max-w-6xl mx-auto px-6 py-6">
        {loading && effView === "list"     && <ListSkeleton />}
        {loading && effView === "card"     && <CardSkeleton />}
        {loading && effView === "calendar" && <Spinner label="Loading…" />}

        {!loading && items.length === 0 && <OnboardingState identities={identities} />}

        {!loading && items.length > 0 && sorted.length === 0 && (
          <EmptyState
            title={<>No results{q ? <> for &ldquo;<span className="text-white">{search}</span>&rdquo;</> : " with these filters"}</>}
            actions={q ? <Button variant="ghost" onClick={() => setSearch("")}>Clear search</Button> : undefined}
          />
        )}

        {!loading && sorted.length > 0 && effView !== "calendar" && (
          <ErrorBoundary label="wishlist view">
            <GroupedView
              items={sorted}
              view={effView}
              groupBy={groupBy}
              descending={descending}
              ratingOf={ratingOf}
              onSelect={(i) => router.push(buildItemHref(i as EnrichedItem))}
              highlightId={highlightId}
            />
          </ErrorBoundary>
        )}

        {!loading && sorted.length > 0 && effView === "calendar" && (
          <ErrorBoundary label="calendar view">
            <CalendarView items={sorted} onSelect={(i) => router.push(buildItemHref(i as EnrichedItem))} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
