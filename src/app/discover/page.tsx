"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useViewMode } from "@/lib/useViewMode";
import NavBar from "@/components/NavBar";
import SubBar, { SearchBarFacets, ViewMode } from "@/components/SubBar";
import CalendarView from "@/components/CalendarView";
import GroupedView from "@/components/GroupedView";
import FilterPanel from "@/components/discovery/FilterPanel";
import { buildItemHref } from "@/lib/itemUrl";
import { usePersistedState } from "@/lib/usePersistedState";
import ErrorBoundary, { CardSkeleton, ListSkeleton } from "@/components/ErrorBoundary";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import {
  UiFilters, defaultUiFilters, FacetPill, VocabMatch, SortKey, DiscoverItem,
  SORTS, DATE_SORTS, YEAR_MIN, YEAR_MAX,
} from "@/components/discovery/types";

const LIMIT = 60;

// True when any filter is active → switches Timeline browse into search results.
// Type chips count as search filters (T23); source/community/runtime were removed (T24).
function hasActiveFilters(f: UiFilters): boolean {
  return (
    f.types.length > 0 ||
    f.includeFacets.length > 0 || f.excludeFacets.length > 0 ||
    f.yearRange[0] > YEAR_MIN || f.yearRange[1] < YEAR_MAX ||
    !!f.membership.library || !!f.membership.wishlist
  );
}

// UiFilters → /api/discover/find filter body (only send bounds off their extreme).
function apiFilters(f: UiFilters) {
  const out: Record<string, any> = {
    types: f.types, membership: f.membership,
    includeFacets: f.includeFacets, excludeFacets: f.excludeFacets,
  };
  if (f.yearRange[0] > YEAR_MIN) out.yearMin = f.yearRange[0];
  if (f.yearRange[1] < YEAR_MAX) out.yearMax = f.yearRange[1];
  return out;
}

// Platform score (0-100): local items carry communityAvg; external (facet/web)
// items carry communityScore.
function platformOf(i: any): number | null {
  return i.communityAvg ?? i.communityScore ?? null;
}
function cmpDate(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0; if (!a) return 1; if (!b) return -1; return a.localeCompare(b);
}
// Sort the merged (local + database) result list by the active sort. Local items
// carry a taste `score`; external items don't (they sort last under "match").
function sortDiscover(items: any[], sort: SortKey): any[] {
  const arr = [...items];
  switch (sort) {
    case "releaseNew": arr.sort((a, b) => cmpDate(b.releaseDate, a.releaseDate)); break;
    case "releaseOld": arr.sort((a, b) => cmpDate(a.releaseDate, b.releaseDate)); break;
    case "userRating": arr.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1)); break;
    case "platformRating": arr.sort((a, b) => (platformOf(b) ?? -1) - (platformOf(a) ?? -1)); break;
    case "match": arr.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)); break;
  }
  return arr;
}

type Sentinel = { loading: boolean; has: boolean; busy: string; cta: string; end: string; onClick: () => void };

// One end-of-list loader bar (top or bottom of the browse timeline). Module-scoped
// so reading its booleans happens on plain props, not flagged as a ref access in
// the page's render (the sentinel objects close over ref-stored loaders).
function SentinelBar({ loading, has, busy, cta, end, onClick }: Sentinel) {
  return loading ? (
    <span className="text-sm text-neutral-500 animate-pulse">{busy}</span>
  ) : has ? (
    <button onClick={onClick} className="text-sm px-6 py-2.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-xl transition-colors">
      {cta}
    </button>
  ) : (
    <span className="text-sm text-neutral-600">{end}</span>
  );
}

export default function DiscoverPage() {
  const router = useRouter();
  // Persisted across back-nav (T12).
  const [q, setQ] = usePersistedState("rr_discover_q", "");
  const [filters, setFilters] = usePersistedState<UiFilters>("rr_discover_filters", defaultUiFilters());
  // Default = "releaseOld": the ascending Timeline order. Any other sort (or a
  // query/filter) switches into catalog search results.
  const [sort, setSort] = usePersistedState<SortKey>("rr_discover_sort", "releaseOld");
  const [view, setView] = useViewMode("card", ["list", "card", "calendar"]);

  // ── Browse (Timeline) state ──
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pages, setPages] = useState({ games: 1, movies: 1, shows: 1 });
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [hasMoreBack, setHasMoreBack] = useState(true);
  const [backPages, setBackPages] = useState({ games: 0, movies: 0, shows: 0 });
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef(0);
  const pendingPrependRef = useRef(false);

  // ── Search state ──
  const [searchItems, setSearchItems] = useState<DiscoverItem[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [webItems, setWebItems] = useState<any[]>([]);   // fresh DB matches (fetch-more)
  const [webLoading, setWebLoading] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Browse = the live infinite timeline; shown for either date sort when no query
  // /filter is active. Non-date sorts (rating / best-match) use the find() search.
  const searchActive = q.trim().length >= 2 || hasActiveFilters(filters) || !DATE_SORTS.includes(sort);

  // ── Browse loaders ──
  // Declared before the mount effect that calls it (react-hooks: no use-before-declaration).
  async function loadDefault() {
    setLoading(true);
    setPages({ games: 1, movies: 1, shows: 1 });
    setBackPages({ games: 0, movies: 0, shows: 0 });
    setHasMore(true);
    setHasMoreBack(true);
    const res = await fetch("/api/discover");
    const data = await res.json();
    setItems(data.items ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (!d.user) { router.push("/"); return; }
    });
    // Initial browse load sets loading state synchronously — expected for a
    // data-fetch-on-mount effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDefault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMore() {
    if (loadingMore || !hasMore || searchActive) return;
    setLoadingMore(true);
    const next = { games: pages.games + 1, movies: pages.movies + 1, shows: pages.shows + 1 };
    const fetches = await Promise.all([
      fetch(`/api/discover?section=games&page=${next.games}`).then((r) => r.json()),
      fetch(`/api/discover?section=movies&page=${next.movies}`).then((r) => r.json()),
      fetch(`/api/discover?section=shows&page=${next.shows}`).then((r) => r.json()),
    ]);
    const newItems = fetches.flatMap((d) => d.items ?? []);
    if (newItems.length === 0) { setHasMore(false); setLoadingMore(false); return; }
    // Future items render at the TOP when newest-first → anchor the scroll there.
    if (sort === "releaseNew") { prevScrollHeightRef.current = document.documentElement.scrollHeight; pendingPrependRef.current = true; }
    setItems((prev) => mergeSorted(prev, newItems, false));
    setPages(next);
    setLoadingMore(false);
  }

  async function loadPrevious() {
    if (loadingPrev || !hasMoreBack || searchActive) return;
    setLoadingPrev(true);
    const next = { games: backPages.games + 1, movies: backPages.movies + 1, shows: backPages.shows + 1 };
    const fetches = await Promise.all([
      fetch(`/api/discover?section=games&page=${next.games}&direction=past`).then((r) => r.json()),
      fetch(`/api/discover?section=movies&page=${next.movies}&direction=past`).then((r) => r.json()),
      fetch(`/api/discover?section=shows&page=${next.shows}&direction=past`).then((r) => r.json()),
    ]);
    const newItems = fetches.flatMap((d) => d.items ?? []);
    if (newItems.length === 0) { setHasMoreBack(false); setLoadingPrev(false); return; }
    // Past items render at the TOP only when oldest-first → anchor the scroll there.
    if (sort !== "releaseNew") { prevScrollHeightRef.current = document.documentElement.scrollHeight; pendingPrependRef.current = true; }
    setItems((prev) => mergeSorted(prev, newItems, true));
    setBackPages(next);
    setLoadingPrev(false);
  }

  function mergeSorted(prev: any[], incoming: any[], prepend: boolean) {
    const seen = new Set(prev.map((i) => i.id));
    const fresh = incoming.filter((i) => !seen.has(i.id));
    const all = prepend ? [...fresh, ...prev] : [...prev, ...fresh];
    return all.sort((a, b) => {
      if (!a.releaseDate && !b.releaseDate) return 0;
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return a.releaseDate.localeCompare(b.releaseDate);
    });
  }

  // ── Search loader ──
  async function runSearch(offset: number, append: boolean) {
    if (append) setSearchLoadingMore(true);
    else { setSearchLoading(true); setWebItems([]); }
    try {
      const res = await fetch("/api/discover/find", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: q.trim(), filters: apiFilters(filters), sort, limit: LIMIT, offset }),
      });
      const d = await res.json();
      const localItems: DiscoverItem[] = d.items ?? [];
      setSearchTotal(d.total ?? 0);
      setSearchItems((prev) => (append ? [...prev, ...localItems] : localItems));
      // Show local results immediately; the DB fetch below populates separately.
      if (append) setSearchLoadingMore(false); else setSearchLoading(false);

      // Fetch-more from the external DBs: a text query pulls live title matches;
      // a must-include facet pulls its full external set (e.g. a person's TMDB
      // filmography). Both shown deduped under "More from the databases".
      if (!append) {
        const query = q.trim();
        const wantWeb = query.length >= 2 || filters.includeFacets.length > 0;
        if (!wantWeb) { setWebItems([]); return; }
        setWebLoading(true);
        const extras: any[] = [];
        if (query.length >= 2) {
          const typeParam = filters.types.length === 1 ? `&type=${filters.types[0]}` : "";
          try {
            const wd = await (await fetch(`/api/discover?q=${encodeURIComponent(query)}${typeParam}`)).json();
            extras.push(...(wd.items ?? []));
          } catch { /* ignore */ }
        }
        if (filters.includeFacets.length > 0) {
          try {
            const fd = await (await fetch("/api/discover/facet-fetch", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ facets: filters.includeFacets, types: filters.types }),
            })).json();
            extras.push(...(fd.items ?? []));
          } catch { /* ignore */ }
        }
        setWebItems(extras.length ? dedupeWeb(localItems, extras) : []);
        setWebLoading(false);
      }
    } catch {
      if (!append) { setSearchItems([]); setSearchTotal(0); setWebItems([]); }
      setSearchLoading(false); setSearchLoadingMore(false); setWebLoading(false);
    }
  }

  // Keys an item is known by — its source ids (`sources[]` or `ids{}`) + title+type.
  function itemKeys(item: any): string[] {
    const ks: string[] = [];
    for (const s of item.sources ?? []) ks.push(`${s.source}:${s.sourceId}`);
    for (const [src, id] of Object.entries(item.ids ?? {})) ks.push(`${src}:${id}`);
    ks.push(`t:${(item.title ?? "").toLowerCase()}:${item.type}`);
    return ks;
  }

  // Drop external matches already present locally; also dedupe within the web set.
  function dedupeWeb(local: DiscoverItem[], web: any[]): any[] {
    const keys = new Set<string>();
    for (const it of local) for (const k of itemKeys(it)) keys.add(k);
    const out: any[] = [];
    for (const w of web) {
      const ks = itemKeys(w);
      if (ks.some((k) => keys.has(k))) continue;
      for (const k of ks) keys.add(k);
      out.push(w);
    }
    return out;
  }

  // Re-run the search (debounced) whenever the query / filters / sort change.
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    if (!searchActive) return;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => runSearch(0, false), 300);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, filtersKey, searchActive]);

  // ── Browse infinite scroll (disabled while searching) ──
  // Keep refs pointing at the latest closures (assigned in an effect, not during
  // render) so the IntersectionObservers always call the current loaders.
  const loadMoreRef = useRef(loadMore);
  const loadPreviousRef = useRef(loadPrevious);
  // The top/bottom sentinels load by DISPLAY position, which flips with direction:
  // newest-first → top loads future (loadMore), bottom loads past (loadPrevious).
  const topLoadRef = useRef<() => void>(() => {});
  const bottomLoadRef = useRef<() => void>(() => {});
  useEffect(() => {
    loadMoreRef.current = loadMore;
    loadPreviousRef.current = loadPrevious;
    const newestFirst = sort === "releaseNew";
    topLoadRef.current = newestFirst ? loadMore : loadPrevious;
    bottomLoadRef.current = newestFirst ? loadPrevious : loadMore;
  });

  const browseFiltered = useMemo(
    () => (filters.types.length ? items.filter((i) => filters.types.includes(i.type)) : items),
    [items, filters.types]
  );

  useEffect(() => {
    if (searchActive) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((e) => { if (e[0].isIntersecting) bottomLoadRef.current(); }, { rootMargin: "600px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, view, searchActive, browseFiltered.length > 0]);

  useEffect(() => {
    if (searchActive) return;
    const el = topSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((e) => { if (e[0].isIntersecting) topLoadRef.current(); }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, view, searchActive, browseFiltered.length > 0]);

  useLayoutEffect(() => {
    if (!pendingPrependRef.current) return;
    const delta = document.documentElement.scrollHeight - prevScrollHeightRef.current;
    if (delta > 0) window.scrollBy(0, delta);
    pendingPrependRef.current = false;
  }, [items]);

  function handleCalendarMonth(month: Date) {
    if (searchActive) return;
    const visibleMonth = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
    let latest = "", earliest = "", inMonth = 0;
    for (const it of browseFiltered) {
      if (!it.releaseDate) continue;
      if (it.releaseDate > latest) latest = it.releaseDate;
      if (!earliest || it.releaseDate < earliest) earliest = it.releaseDate;
      if (it.releaseDate.slice(0, 7) === visibleMonth) inMonth++;
    }
    if (!latest) return;
    if (earliest && visibleMonth <= earliest.slice(0, 7)) loadPreviousRef.current();
    else if (visibleMonth >= latest.slice(0, 7)) loadMoreRef.current();
    else if (inMonth === 0) loadMoreRef.current();
  }

  // ── Filter mutators ──
  function toggleType(t: string) {
    setFilters((f) => ({ ...f, types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] }));
  }
  function patchFilters(patch: Partial<UiFilters>) { setFilters((f) => ({ ...f, ...patch })); }
  function resetFilters() { setFilters(defaultUiFilters()); setQ(""); }

  // Must-include / exclude facets for the shared SearchBar.
  const searchFacets: SearchBarFacets = {
    include: filters.includeFacets,
    exclude: filters.excludeFacets,
    onAdd: (key, m: VocabMatch) => {
      const arrKey = key === "include" ? "includeFacets" : "excludeFacets";
      const pill: FacetPill = { kind: m.kind, role: m.role, key: m.key, label: m.label };
      setFilters((f) => (f[arrKey].some((x) => x.kind === pill.kind && x.role === pill.role && x.key === pill.key) ? f : { ...f, [arrKey]: [...f[arrKey], pill] }));
    },
    onRemove: (key, i) => {
      const arrKey = key === "include" ? "includeFacets" : "excludeFacets";
      setFilters((f) => ({ ...f, [arrKey]: f[arrKey].filter((_, idx) => idx !== i) }));
    },
  };

  // find() already constrains by type, so search results need no extra filter.
  // Merge local results + database fetch-more into ONE list, sorted by the active sort.
  const combined = sortDiscover([...searchItems, ...webItems], sort);

  // Sort-driven layout (T8): rating sorts group by rating, best-match is flat,
  // date sorts keep the month timeline; calendar view is only for date sorts.
  const isDateSort = DATE_SORTS.includes(sort);
  const groupBy: "month" | "rating" | "none" =
    sort === "userRating" || sort === "platformRating" ? "rating" : sort === "match" ? "none" : "month";
  const descending = sort === "releaseNew";
  const ratingOf =
    sort === "userRating" ? (i: any) => i.rating ?? null
    : sort === "platformRating" ? (i: any) => { const p = platformOf(i); return p != null ? p / 10 : null; }
    : undefined;
  const availableViews: ViewMode[] = isDateSort ? ["list", "card", "calendar"] : ["list", "card"];
  const effView: ViewMode = !isDateSort && view === "calendar" ? "card" : view;

  // Browse timeline sentinels — top/bottom map to past/future by sort direction.
  const futureSentinel = { loading: loadingMore, has: hasMore, busy: "Loading newer releases…", cta: "Load newer releases", end: "No newer releases", onClick: () => loadMore() };
  const pastSentinel = { loading: loadingPrev, has: hasMoreBack, busy: "Loading earlier releases…", cta: "Load earlier releases", end: "No earlier releases", onClick: () => loadPrevious() };
  const topSentinel = descending ? futureSentinel : pastSentinel;
  const bottomSentinel = descending ? pastSentinel : futureSentinel;

  return (
    <div className="min-h-screen">
      <NavBar />

      <SubBar
        activeTypes={filters.types}
        onToggleType={toggleType}
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="Search games, movies, shows…"
        searchFacets={searchFacets}
        sort={{ value: sort, onChange: (v) => setSort(v as SortKey), options: SORTS }}
        advancedFilters={<FilterPanel filters={filters} onChange={patchFilters} />}
        view={effView}
        onViewChange={setView}
        availableViews={availableViews}
      />

      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* ── Search results ── */}
        {searchActive ? (
          <ErrorBoundary label="discover search">
            {searchLoading && effView === "card" && <CardSkeleton />}
            {searchLoading && effView === "list" && <ListSkeleton />}
            {searchLoading && effView === "calendar" && <Spinner label="Searching…" />}

            {!searchLoading && combined.length === 0 && webLoading && (
              <Spinner label="Searching the databases…" />
            )}

            {!searchLoading && !webLoading && combined.length === 0 && (
              <EmptyState
                title={<>No results{q.trim() ? <> for &ldquo;<span className="text-white">{q}</span>&rdquo;</> : " with these filters"}</>}
                actions={<Button variant="ghost" onClick={resetFilters}>Clear search &amp; filters</Button>}
              />
            )}

            {!searchLoading && combined.length > 0 && (
              <>
                {effView === "calendar" ? (
                  <CalendarView items={combined as any} onSelect={(i) => router.push(buildItemHref(i as any))} />
                ) : (
                  <GroupedView items={combined as any} view={effView} groupBy={groupBy} descending={descending} ratingOf={ratingOf} onSelect={(i) => router.push(buildItemHref(i as any))} />
                )}
                {webLoading && <div className="text-center text-xs text-neutral-500 animate-pulse pt-5">Pulling more from the databases…</div>}
                {effView !== "calendar" && searchItems.length < searchTotal && (
                  <div className="flex justify-center pt-6">
                    <Button variant="secondary" size="md" onClick={() => runSearch(searchItems.length, true)} disabled={searchLoadingMore} className="px-6 py-2.5">
                      {searchLoadingMore ? "Loading…" : `Load more (${(searchTotal - searchItems.length).toLocaleString()} left)`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </ErrorBoundary>
        ) : (
          /* ── Browse (Timeline) ── */
          <ErrorBoundary label="discover browse">
            {loading && view === "card" && <CardSkeleton />}
            {loading && view === "list" && <ListSkeleton />}
            {loading && view === "calendar" && <Spinner label="Loading…" />}

            {!loading && browseFiltered.length > 0 && (
              <>
                {(view === "list" || view === "card") && (
                  <>
                    <div ref={topSentinelRef} className="mb-6 flex justify-center">
                      <SentinelBar {...topSentinel} />
                    </div>

                    <GroupedView items={browseFiltered} view={view} descending={descending} onSelect={(i) => router.push(buildItemHref(i as any))} />

                    <div ref={sentinelRef} className="mt-10 flex justify-center">
                      <SentinelBar {...bottomSentinel} />
                    </div>
                  </>
                )}

                {view === "calendar" && (
                  <CalendarView items={browseFiltered} onSelect={(i) => router.push(buildItemHref(i as any))} onVisibleMonthChange={handleCalendarMonth} />
                )}
              </>
            )}
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
