"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { EnrichedItem, MediaType } from "@/types";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/constants";
import NavBar from "@/components/NavBar";
import { TypeBadge } from "@/components/Badges";
import { catalogForType } from "@/lib/sources/catalog";
import { SOURCE_PARAMS } from "@/lib/itemUrl";
import { fmtDate } from "@/components/item/format";
import MediaGallery from "@/components/item/MediaGallery";
import RatingsSection from "@/components/item/RatingsSection";
import FactsSection from "@/components/item/FactsSection";
import WishlistPanel from "@/components/item/WishlistPanel";
import LowerSections from "@/components/item/LowerSections";

function ItemInspector() {
  const router = useRouter();
  const sp = useSearchParams();

  const id = sp.get("id");
  const type = (sp.get("type") ?? "game") as MediaType;
  const title = sp.get("title");
  const posterUrl = sp.get("posterUrl");

  const [enriched, setEnriched] = useState<EnrichedItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [platforms, setPlatforms] = useState<any[]>([]);
  const [platformsLoading, setPlatformsLoading] = useState(true);
  const [platformAction, setPlatformAction] = useState<string | null>(null);
  const [resolvedMediaItemId, setResolvedMediaItemId] = useState<string | null>(null);
  const [userIdentities, setUserIdentities] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [ratingAction, setRatingAction] = useState(false);
  // Bumping this re-runs the load effect (manual "resync from providers").
  const [reloadKey, setReloadKey] = useState(0);

  // The detail/refresh APIs accept id + type + title + per-source ids. Forward
  // exactly those from the current URL — both endpoints ignore extras.
  function detailParams() {
    const p = new URLSearchParams();
    if (id) p.set("id", id);
    p.set("type", type);
    if (title) p.set("title", title);
    for (const k of SOURCE_PARAMS) {
      const v = sp.get(k);
      if (v) p.set(k, v);
    }
    return p;
  }

  function buildFallbackPlatforms() {
    const connected = new Set(userIdentities.map((i: any) => i.provider));
    return catalogForType(type).map((m) => ({
      provider: m.id,
      label: m.label,
      displayName: userIdentities.find((i: any) => i.provider === m.id)?.display_name ?? null,
      canWrite: m.capabilities.wishlist.write,
      onList: false,
      notConnected: !connected.has(m.id),
    }));
  }

  async function loadDetail(): Promise<any> {
    try {
      const res = await fetch(`/api/detail?${detailParams()}`);
      if (res.status === 401) { router.push("/"); return {}; }
      const data = await res.json();
      if (data.item) setEnriched(data.item);
      else if (data.error) setNotFound(true);
      setPlatforms(data.platforms ?? buildFallbackPlatforms());
      if (data.resolvedMediaItemId) setResolvedMediaItemId(data.resolvedMediaItemId);
      return data;
    } catch {
      setPlatforms(buildFallbackPlatforms());
      return {};
    }
  }

  useEffect(() => {
    // Identities power the fallback platform list if the detail fetch fails.
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) { router.push("/"); return; }
        setUserIdentities(d.identities ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Guard + the setLoading(true) below are the normal entry of a data-load effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!id) { setLoading(false); setNotFound(true); return; }
    let aborted = false;
    const controller = new AbortController();
    setLoading(true);
    setPlatformsLoading(true);
    setCarouselIdx(0);
    setNotFound(false);
    setResolvedMediaItemId(null);
    setEnriched(null);

    (async () => {
      await loadDetail();
      if (aborted) return;
      setLoading(false);
      setPlatformsLoading(false);

      setRefreshing(true);
      try {
        const res = await fetch(`/api/detail/refresh?${detailParams()}`, { method: "POST", signal: controller.signal });
        const data = await res.json();
        if (aborted) return;
        if (data.platforms) setPlatforms(data.platforms);
        if (data.resolvedMediaItemId) setResolvedMediaItemId(data.resolvedMediaItemId);
        setEnriched((prev) => prev ? {
          ...prev,
          rating:        data.library?.rating ?? null,
          ratings:       data.library?.ratings ?? [],
          review:        data.library?.review ?? null,
          reviewedAt:    data.library?.reviewedAt ?? null,
          libraryStatus: data.library?.libraryStatus ?? null,
        } : prev);
      } catch { /* aborted or failed — keep DB state */ }
      finally { if (!aborted) setRefreshing(false); }
    })();

    return () => { aborted = true; controller.abort(); };
  }, [id, reloadKey]);

  function buildIdsFromSources(sources: any[]): Record<string, number> {
    const ids: Record<string, number> = {};
    for (const s of sources) {
      if (s.source && s.sourceId && !isNaN(parseInt(s.sourceId))) ids[s.source] = parseInt(s.sourceId);
    }
    return ids;
  }

  function idsFromParams(): Record<string, number> {
    const ids: Record<string, number> = {};
    const map: Record<string, string> = { rawgId: "rawg", tmdbId: "tmdb", traktId: "trakt", steamId: "steam", letterboxdId: "letterboxd" };
    for (const [param, source] of Object.entries(map)) {
      const v = sp.get(param);
      if (v && !isNaN(parseInt(v))) ids[source] = parseInt(v);
    }
    return ids;
  }

  async function togglePlatform(provider: string, onList: boolean) {
    setPlatformAction(provider);
    const mediaItemId = resolvedMediaItemId ?? enriched?.id ?? id;

    if (onList) {
      await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaItemId, source: provider }),
      });
      await loadDetail();
    } else {
      const ids = enriched?.sources?.length ? buildIdsFromSources(enriched.sources) : idsFromParams();
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          title: enriched?.title ?? title,
          releaseDate: enriched?.releaseDate ?? null,
          ids,
          targetProvider: provider,
        }),
      });
      await loadDetail();
    }
    setPlatformAction(null);
  }

  // Body for /api/library: target an existing DB item by id, else send the item's
  // identity so the server creates it on the fly (rating a discover item).
  function libraryBody(extra: Record<string, any>) {
    if (resolvedMediaItemId) return { mediaItemId: resolvedMediaItemId, ...extra };
    const ids = enriched?.sources?.length ? buildIdsFromSources(enriched.sources) : idsFromParams();
    return { type, title: enriched?.title ?? title, releaseDate: enriched?.releaseDate ?? null, posterUrl, ids, ...extra };
  }

  async function handleRate(newRating: number | null) {
    setRatingAction(true);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(libraryBody({ rating: newRating })),
      });
      const data = await res.json().catch(() => ({}));
      if (data.mediaItemId && !resolvedMediaItemId) setResolvedMediaItemId(data.mediaItemId);
      const nowSec = Math.floor(Date.now() / 1000);
      setEnriched((prev) => prev ? {
        ...prev,
        // The server pushes to every connected platform and returns the new
        // average + per-platform breakdown.
        rating: data.rating ?? newRating,
        ratings: data.ratings ?? prev.ratings ?? [],
        reviewedAt: prev.reviewedAt ?? nowSec,
        libraryStatus: prev.libraryStatus ?? (newRating != null ? (type === "game" ? "played" : "watched") : null),
      } : prev);
    } catch (e) {
      console.error("Failed to rate:", e);
    } finally {
      setRatingAction(false);
    }
  }

  async function handleMarkWatched() {
    const status = type === "game" ? "played" : "watched";
    setRatingAction(true);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(libraryBody({ status })),
      });
      const data = await res.json().catch(() => ({}));
      if (data.mediaItemId && !resolvedMediaItemId) setResolvedMediaItemId(data.mediaItemId);
      const nowSec = Math.floor(Date.now() / 1000);
      setEnriched((prev) => prev ? { ...prev, libraryStatus: status, reviewedAt: prev.reviewedAt ?? nowSec } : prev);
    } catch (e) {
      console.error("Failed to mark watched:", e);
    } finally {
      setRatingAction(false);
    }
  }

  // ── Build image list ─────────────────────────────────────────────
  const imgs: string[] = [];
  if (posterUrl) imgs.push(posterUrl);
  if (enriched?.images) for (const u of enriched.images) if (u && !imgs.includes(u)) imgs.push(u);
  const validImgs = imgs.filter(Boolean);
  const idx = Math.min(carouselIdx, Math.max(0, validImgs.length - 1));

  const steamAppId = enriched?.sources?.find((s) => s.source === "steam")?.sourceId ?? sp.get("steamId");
  const steamStoreUrl = steamAppId ? `https://store.steampowered.com/app/${steamAppId}` : null;

  // ── Derived display values (header + ratings; section components derive the rest from `enriched`) ──
  const displayTitle     = enriched?.title ?? title ?? "Untitled";
  const description      = enriched?.description ?? null;
  const tagline          = enriched?.tagline ?? null;
  const releaseDate      = enriched?.releaseDate ?? null;
  const steamReview      = enriched?.steamReviewLabel ?? null;
  const communityRatings = enriched?.communityRatings ?? [];
  const personalRating   = enriched?.rating ?? null;
  const personalRatings  = enriched?.ratings ?? [];
  const libraryStatus    = enriched?.libraryStatus ?? null;
  const reviewedAt       = enriched?.reviewedAt ?? null;
  const review           = enriched?.review ?? null;
  const dates            = enriched?.dates ?? [];

  const hasScores = communityRatings.length > 0 || steamReview;

  // We can rate/log as long as the item has an identity — either it's already in
  // the DB (resolvedMediaItemId) or it carries source ids we can persist on save.
  // This is what lets discover items be rated without first wishlisting them.
  const ratableIds = enriched?.sources?.length ? buildIdsFromSources(enriched.sources) : idsFromParams();
  const canRate = !!resolvedMediaItemId || Object.keys(ratableIds).length > 0;

  if (notFound) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-24 text-center">
        <p className="text-2xl font-bold mb-2">Item not found</p>
        <p className="text-neutral-400 text-sm mb-6">We couldn&apos;t resolve this item against any source.</p>
        <button onClick={() => router.back()} className="text-sm px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 transition-colors">
          ← Go back
        </button>
      </div>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-6 py-6">
      <button
        onClick={() => router.back()}
        className="text-neutral-400 hover:text-white text-sm transition-colors mb-5 inline-flex items-center gap-1.5"
      >
        ← Back
      </button>

      {/* ── Hero: media + headline ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_1fr] gap-8">
        {/* Media column */}
        <MediaGallery images={validImgs} idx={idx} setIdx={setCarouselIdx} title={displayTitle} />

        {/* Headline column */}
        <div className="min-w-0 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={type} />
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading || refreshing}
              title="Re-check this item against your connected accounts"
              className="text-xs px-2.5 py-1 rounded-full border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors disabled:opacity-50"
            >
              {refreshing ? "Syncing…" : "↻ Resync"}
            </button>
            <Link
              href={`/item/debug?${sp.toString()}`}
              title="Inspect per-source data and how it was merged"
              className="text-xs px-2.5 py-1 rounded-full border border-neutral-800 text-neutral-600 hover:border-amber-700 hover:text-amber-400 transition-colors"
            >
              debug
            </Link>
          </div>

          <h1 className="text-3xl font-bold leading-tight">{displayTitle}</h1>

          {/* Release dates */}
          {dates.length > 0 ? (
            <div className="space-y-1">
              {dates.map((d) => (
                <div key={d.source} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SOURCE_COLORS[d.source] ?? "#888" }} />
                  <span className="text-neutral-400 text-xs w-16">{SOURCE_LABELS[d.source] ?? d.source}</span>
                  <span className="text-neutral-200">{fmtDate(d.date)}</span>
                </div>
              ))}
            </div>
          ) : releaseDate ? (
            <p className="text-sm text-neutral-400">{fmtDate(releaseDate)}</p>
          ) : loading ? (
            <p className="text-sm text-neutral-600 animate-pulse">Loading…</p>
          ) : (
            <p className="text-sm text-neutral-600">TBA</p>
          )}

          {/* Tagline */}
          {tagline && <p className="text-base text-neutral-400 italic">{tagline}</p>}

          {/* Ratings — platform/community scores + your own rating, co-located (T13) */}
          <RatingsSection
            type={type}
            hasScores={!!hasScores}
            communityRatings={communityRatings}
            steamReview={steamReview}
            canRate={canRate}
            personalRating={personalRating}
            personalRatings={personalRatings}
            libraryStatus={libraryStatus}
            reviewedAt={reviewedAt}
            review={review}
            hoverRating={hoverRating}
            setHoverRating={setHoverRating}
            ratingAction={ratingAction}
            onRate={handleRate}
            onMarkWatched={handleMarkWatched}
          />

          {/* Credits chips · facts grid · next episode · awards */}
          <FactsSection enriched={enriched} type={type} />

          {/* Description */}
          {description && <p className="text-sm text-neutral-300 leading-relaxed">{description}</p>}

          {/* Wishlist management */}
          <WishlistPanel
            platforms={platforms}
            loading={platformsLoading}
            platformAction={platformAction}
            onToggle={togglePlatform}
            steamStoreUrl={steamStoreUrl}
          />
        </div>
      </div>

      {/* ── Lower detail sections: trailer · cast · where-to-watch · DLC · tags · links ── */}
      <LowerSections enriched={enriched} type={type} />
    </main>
  );
}

export default function ItemPage() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <Suspense fallback={<div className="max-w-6xl mx-auto px-6 py-24 text-center text-neutral-500">Loading…</div>}>
        <ItemInspector />
      </Suspense>
    </div>
  );
}
