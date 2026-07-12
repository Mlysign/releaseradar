"use client";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";

// Minimal item shape needed to rate / wishlist from a card or row. Both
// EnrichedItem and the discover/facet item shapes satisfy it.
export interface QuickActionItem {
  id: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  rating?: number | null;
  onWatchlist?: boolean;
  platformSources?: string[];
  libraryStatus?: string | null;
  sources?: { source: string; sourceId: string }[];
  ids?: Record<string, string | number>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Build the { tmdb: id, … } identity the library / watchlist endpoints accept,
// so a quick action works even on a discovered title not yet in the local DB.
function idsFromItem(item: QuickActionItem): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const s of item.sources ?? []) if (s?.sourceId) ids[s.source] = String(s.sourceId);
  if (item.ids) for (const [k, v] of Object.entries(item.ids)) if (v != null) ids[k] = String(v);
  return ids;
}

// Shared quick-action state + optimistic writes for rate / wishlist. Used by
// PosterCard (card view) and ListCard (list view) so behaviour stays identical.
export function useQuickActions(item: QuickActionItem) {
  const { toast } = useToast();
  const [rating, setRating] = useState<number | null>(item.rating ?? null);
  const [wishlisted, setWishlisted] = useState<boolean>(item.onWatchlist ?? (item.platformSources?.length ?? 0) > 0);
  const [status, setStatus] = useState<string | null>(item.libraryStatus ?? null);
  const [busy, setBusy] = useState(false);
  const mediaIdRef = useRef<string | null>(UUID_RE.test(item.id) ? item.id : null);

  // Resync the optimistic local state when the parent supplies a different item
  // or fresh data for the same item (a deliberate prop→state sync).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRating(item.rating ?? null);
    setWishlisted(item.onWatchlist ?? (item.platformSources?.length ?? 0) > 0);
    setStatus(item.libraryStatus ?? null);
    mediaIdRef.current = UUID_RE.test(item.id) ? item.id : null;
  }, [item.id, item.rating, item.onWatchlist, item.libraryStatus, item.platformSources?.length]);

  const identity = () => ({ type: item.type, title: item.title, releaseDate: item.releaseDate, posterUrl: item.posterUrl, ids: idsFromItem(item) });

  async function rate(n: number) {
    const prev = rating;
    setRating(n);
    setStatus((s) => s ?? (item.type === "game" ? "played" : "watched"));
    setBusy(true);
    try {
      const res = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...identity(), rating: n }) });
      if (!res.ok) throw new Error();
      const d = await res.json();
      if (d.mediaItemId) mediaIdRef.current = d.mediaItemId;
      if (typeof d.rating === "number") setRating(d.rating);
    } catch {
      setRating(prev); // revert on failure
      toast("Couldn't save your rating. Please try again.", "error");
    }
    setBusy(false);
  }

  async function toggleWishlist() {
    const next = !wishlisted;
    setWishlisted(next);
    setBusy(true);
    try {
      if (next) {
        const res = await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(identity()) });
        if (!res.ok) throw new Error();
        const d = await res.json();
        if (d.mediaItemId) mediaIdRef.current = d.mediaItemId;
      } else {
        // Send identity too: discover/feed cards may not carry the local
        // media_item UUID, so the server resolves it from the source ids.
        const res = await fetch("/api/watchlist", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaItemId: mediaIdRef.current ?? undefined, ...identity() }) });
        if (!res.ok) throw new Error();
      }
    } catch {
      setWishlisted(!next); // revert on failure
      toast(next ? "Couldn't add to wishlist. Please try again." : "Couldn't remove from wishlist. Please try again.", "error");
    }
    setBusy(false);
  }

  // Mark watched/played (in-library) or remove from library entirely (clears
  // status + rating). Rating implies in-library, so turning it off clears both.
  async function toggleWatched() {
    const currentlyIn = !!status;
    setBusy(true);
    if (!currentlyIn) {
      const st = item.type === "game" ? "played" : "watched";
      setStatus(st);
      try {
        const res = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...identity(), status: st }) });
        if (!res.ok) throw new Error();
        const d = await res.json();
        if (d.mediaItemId) mediaIdRef.current = d.mediaItemId;
      } catch {
        setStatus(null);
        toast("Couldn't update your library. Please try again.", "error");
      }
    } else {
      const prevStatus = status, prevRating = rating;
      setStatus(null); setRating(null);
      try {
        // Send identity too: discover/feed cards may not carry the local
        // media_item UUID, so the server resolves it from the source ids.
        const res = await fetch("/api/library", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaItemId: mediaIdRef.current ?? undefined, ...identity() }) });
        if (!res.ok) throw new Error();
      } catch {
        setStatus(prevStatus); setRating(prevRating);
        toast("Couldn't remove from your library. Please try again.", "error");
      }
    }
    setBusy(false);
  }

  return { rating, wishlisted, status, busy, rate, toggleWishlist, toggleWatched };
}
