import { get } from "@/lib/db";
import { MediaSource, PulledItem } from "../types";
import { CATALOG } from "../catalog";
import {
  getTmdbWatchlistMovies, getTmdbWatchlistShows, getTmdbRatedMovies, getTmdbRatedShows,
  setTmdbWatchlist, setTmdbRating, deleteTmdbRating,
} from "../tmdb";

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}

function toPulled(r: any, type: "movie" | "show"): PulledItem {
  return {
    sourceId: String(r.id),
    title: r.title ?? r.name ?? "",
    releaseDate: r.release_date ?? r.first_air_date ?? null,
    type,
    rawData: r,
  };
}

// TMDB account adapter (movies + shows). `tmdb` is ALSO a MetadataProvider — the
// two registries are independent, so the same source id serves both content
// metadata and (here) the user's TMDB account. Auth = the app's api_key + a
// per-user session_id (token) and account id (slug), set during the connect flow.
//
// TMDB has no "watched"/history concept — only watchlist + rating + favorite — so
// `library` = the user's Rated items, and there is no pushStatus.
export const tmdbSource: MediaSource = {
  ...CATALOG.tmdb,

  async context(userId) {
    const identity = get<any>(
      "SELECT * FROM user_identities WHERE user_id = ? AND provider = 'tmdb'",
      [userId]
    );
    if (!identity) return null;
    const meta = identity.metadata ? safeParse(identity.metadata) : {};
    // token = session_id, slug = account id
    return {
      userId,
      identity,
      token: identity.access_token ?? null,
      slug: meta.accountId != null ? String(meta.accountId) : null,
    };
  },

  // Every movie/show carries its TMDB id natively, so resolution is trivial.
  async resolveSourceId(_ctx, _type, ids) {
    return ids.tmdb != null ? String(ids.tmdb) : null;
  },

  async pullWishlist(ctx) {
    if (!ctx.token || !ctx.slug) return [];
    const [movies, shows] = await Promise.all([
      getTmdbWatchlistMovies(ctx.slug, ctx.token),
      getTmdbWatchlistShows(ctx.slug, ctx.token),
    ]);
    return [...movies.map((m) => toPulled(m, "movie")), ...shows.map((s) => toPulled(s, "show"))];
  },

  async pushWishlist(ctx, sourceId, type, add) {
    if (!ctx.token || !ctx.slug) return;
    await setTmdbWatchlist(ctx.slug, ctx.token, type === "show" ? "tv" : "movie", parseInt(sourceId), add);
  },

  async pullLibrary(ctx) {
    if (!ctx.token || !ctx.slug) return [];
    const [movies, shows] = await Promise.all([
      getTmdbRatedMovies(ctx.slug, ctx.token),
      getTmdbRatedShows(ctx.slug, ctx.token),
    ]);
    // TMDB ratings are already on a 0.5–10 scale → use directly; a rating implies watched.
    const map = (r: any, type: "movie" | "show"): PulledItem => ({
      ...toPulled(r, type),
      status: "watched",
      rating: typeof r.rating === "number" ? r.rating : null,
      reviewedAt: null,
    });
    return [...movies.map((m) => map(m, "movie")), ...shows.map((s) => map(s, "show"))];
  },

  async pushRating(ctx, sourceId, type, appRating) {
    if (!ctx.token) return;
    // App stores 0–10; TMDB accepts 0.5–10 → clamp + round to the nearest 0.5.
    const value = Math.max(0.5, Math.min(10, Math.round(appRating * 2) / 2));
    await setTmdbRating(ctx.token, type === "show" ? "tv" : "movie", parseInt(sourceId), value);
  },

  // TMDB has no "watched" concept beyond the rating, so both clearing the rating
  // and removing from the library reduce to deleting the rating.
  async clearRating(ctx, sourceId, type) {
    if (!ctx.token) return;
    await deleteTmdbRating(ctx.token, type === "show" ? "tv" : "movie", parseInt(sourceId));
  },

  async removeFromLibrary(ctx, sourceId, type) {
    if (!ctx.token) return;
    await deleteTmdbRating(ctx.token, type === "show" ? "tv" : "movie", parseInt(sourceId));
  },

  // No pushStatus — TMDB cannot represent "watched" without a rating.
};
