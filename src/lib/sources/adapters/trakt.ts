import { get, run } from "@/lib/db";
import { linkSourceToItem } from "@/lib/matcher";
import { MediaSource, PulledItem } from "../types";
import { CATALOG } from "../catalog";
import {
  refreshTraktToken, getTraktIdByTmdb,
  addMovieToTraktWatchlist, addShowToTraktWatchlist,
  removeMovieFromTraktWatchlist, removeShowFromTraktWatchlist,
  rateTraktItem, markTraktWatched, removeTraktRating, removeTraktFromHistory,
  getTraktWatchlistMovies, getTraktWatchlistShows,
  getTraktWatchedMovies, getTraktWatchedShows,
  getTraktRatingsMovies, getTraktRatingsShows,
} from "../trakt";
import { METADATA } from "@/lib/metadata/registry";

const nowSec = () => Math.floor(Date.now() / 1000);

function toUnix(s: any): number | null {
  if (!s) return null;
  const p = Date.parse(s);
  return isNaN(p) ? null : Math.floor(p / 1000);
}

// Trakt adapter (movies + shows). OAuth — `context()` refreshes the access token
// in place when it's within 5 minutes of expiry, so no consumer ever touches the
// refresh dance again.
//
// NOTE: pull* (bulk/library reads) are intentionally not migrated yet — the
// legacy sync paths cross-enrich with TMDB and persist multiple links. Writes,
// auth, capabilities, and id-resolution are migrated.
export const traktSource: MediaSource = {
  ...CATALOG.trakt,

  async context(userId) {
    const identity = get<any>(
      "SELECT * FROM user_identities WHERE user_id = ? AND provider = 'trakt'",
      [userId]
    );
    if (!identity) return null;
    let token: string | null = identity.access_token ?? null;
    if (identity.token_expires_at && identity.token_expires_at < nowSec() + 300) {
      try {
        const t = await refreshTraktToken(identity.refresh_token);
        token = t.access_token;
        run(
          "UPDATE user_identities SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = ?",
          [t.access_token, t.refresh_token, nowSec() + t.expires_in, identity.id]
        );
      } catch { /* fall back to the existing token */ }
    }
    return { userId, identity, token, slug: identity.display_name ?? identity.provider_user_id };
  },

  async resolveSourceId(ctx, type, ids) {
    if (ids.trakt != null) return String(ids.trakt);
    if (ids.tmdb != null && ctx.token) {
      const id = await getTraktIdByTmdb(Number(ids.tmdb), type as "movie" | "show", ctx.token);
      return id != null ? String(id) : null;
    }
    return null;
  },

  matches(item, ids) {
    if (ids.trakt != null && item.sourceId === String(ids.trakt)) return true;
    const tmdb = item.rawData?.ids?.tmdb;
    return ids.tmdb != null && tmdb != null && String(tmdb) === String(ids.tmdb);
  },

  async pushWishlist(ctx, sourceId, type, add) {
    if (!ctx.token) return;
    const id = parseInt(sourceId);
    if (add) {
      if (type === "movie") await addMovieToTraktWatchlist(ctx.token, id);
      else await addShowToTraktWatchlist(ctx.token, id);
    } else {
      if (type === "movie") await removeMovieFromTraktWatchlist(ctx.token, id);
      else await removeShowFromTraktWatchlist(ctx.token, id);
    }
  },

  // Trakt keeps rating (/sync/ratings) and watched history (/sync/history)
  // separate, so a rating both posts the score AND marks the item watched.
  async pushRating(ctx, sourceId, type, appRating) {
    if (!ctx.token) return;
    const id = parseInt(sourceId);
    const t = type as "movie" | "show";
    await rateTraktItem(ctx.token, t, id, Math.round(appRating));
    await markTraktWatched(ctx.token, t, id);
  },

  async pushStatus(ctx, sourceId, type) {
    if (!ctx.token) return;
    await markTraktWatched(ctx.token, type as "movie" | "show", parseInt(sourceId));
  },

  // Clear only the rating (leave the watched history intact — Trakt keeps them
  // separate, so removing a score shouldn't un-watch the item).
  async clearRating(ctx, sourceId, type) {
    if (!ctx.token) return;
    await removeTraktRating(ctx.token, type as "movie" | "show", parseInt(sourceId));
  },

  // Removing from the library undoes both what pushRating did: clear the rating
  // AND remove the watched-history entry, so a resync doesn't re-pull either.
  async removeFromLibrary(ctx, sourceId, type) {
    if (!ctx.token) return;
    const id = parseInt(sourceId);
    const t = type as "movie" | "show";
    await removeTraktRating(ctx.token, t, id);
    await removeTraktFromHistory(ctx.token, t, id);
  },

  async pullWishlist(ctx) {
    if (!ctx.token) return [];
    const [movies, shows] = await Promise.all([
      getTraktWatchlistMovies(ctx.token),
      getTraktWatchlistShows(ctx.token),
    ]);
    const items: PulledItem[] = [];
    for (const e of movies) {
      const m = e.movie;
      if (!m?.ids?.trakt) continue;
      items.push({
        sourceId: String(m.ids.trakt), title: m.title, type: "movie",
        releaseDate: m.year ? `${m.year}-01-01` : null,
        rawData: { ...m, listed_at: e.listed_at },
      });
    }
    for (const e of shows) {
      const s = e.show;
      if (!s?.ids?.trakt) continue;
      items.push({
        sourceId: String(s.ids.trakt), title: s.title, type: "show",
        releaseDate: s.year ? `${s.year}-01-01` : null,
        rawData: { ...s, listed_at: e.listed_at },
      });
    }
    return items;
  },

  async pullLibrary(ctx) {
    if (!ctx.token) return [];
    const [wMovies, wShows, rMovies, rShows] = await Promise.all([
      getTraktWatchedMovies(ctx.token), getTraktWatchedShows(ctx.token),
      getTraktRatingsMovies(ctx.token), getTraktRatingsShows(ctx.token),
    ]);
    const rating = (list: any[], kind: "movie" | "show") => {
      const map = new Map<number, { rating: number; ratedAt: number | null }>();
      for (const r of list) {
        const tid = r[kind]?.ids?.trakt;
        if (tid) map.set(tid, { rating: r.rating, ratedAt: toUnix(r.rated_at) });
      }
      return map;
    };
    const movieRating = rating(rMovies, "movie");
    const showRating = rating(rShows, "show");

    const items: PulledItem[] = [];
    const ingest = (list: any[], kind: "movie" | "show", ratingMap: Map<number, { rating: number; ratedAt: number | null }>) => {
      for (const e of list) {
        const node = e[kind];
        const tid = node?.ids?.trakt;
        if (!tid) continue;
        const rated = ratingMap.get(tid);
        items.push({
          sourceId: String(tid), title: node.title, type: kind,
          releaseDate: node.year ? `${node.year}-01-01` : null,
          rawData: node, status: "watched",
          rating: rated?.rating ?? null,
          reviewedAt: rated?.ratedAt ?? toUnix(e.last_watched_at) ?? null,
        });
      }
    };
    ingest(wMovies, "movie", movieRating);
    ingest(wShows, "show", showRating);
    return items;
  },

  // Cross-enrich with TMDB (cheap, id-based) — runs for both wishlist & library.
  async enrich(item, mediaItemId) {
    const node = item.rawData;
    const kind = (item.type ?? "movie") as "movie" | "show";
    const tmdb = METADATA.tmdb;
    if (!tmdb) return;
    try {
      const link = node?.ids?.tmdb
        ? await tmdb.fetchById?.(String(node.ids.tmdb), kind)
        : (kind === "movie" ? await tmdb.searchByTitle?.(node.title, kind, { year: node.year }) : null);
      if (link) {
        linkSourceToItem(mediaItemId, {
          source: "tmdb", sourceId: link.sourceId, type: kind,
          title: link.title,
          releaseDate: link.releaseDate ?? (node.year ? `${node.year}-01-01` : null),
          rawData: link.rawData,
        });
      }
    } catch { /* enrichment optional */ }
  },
};
