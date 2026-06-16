import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { searchRawg } from "@/lib/sources/rawg";
import { get } from "@/lib/db";
import { normalizeName } from "@/lib/merge";

interface SearchResult {
  // Merged identity
  title: string;
  type: "game" | "movie" | "show";
  releaseDate: string | null;
  posterUrl: string | null;
  // IDs per source – whichever we found
  ids: {
    rawg?: number;
    tmdb?: number;
    trakt?: number;
    steam?: number;
  };
  // Which platforms already have this (for display)
  foundOn: string[];
}

export const GET = withUser(async (req: NextRequest, session) => {
    const q = req.nextUrl.searchParams.get("q")?.trim();
    const type = req.nextUrl.searchParams.get("type");

    if (!q || q.length < 2) return NextResponse.json({ results: [] });

    const traktIdentity = get<any>(
      "SELECT access_token FROM user_identities WHERE user_id = ? AND provider = 'trakt'",
      [session.userId]
    );

    const results: SearchResult[] = [];

    // ── Games ─────────────────────────────────────────────────────
    if (!type || type === "game") {
      try {
        const data = await searchRawg(q);
        for (const g of (data.results ?? []).slice(0, 8)) {
          results.push({
            title: g.name,
            type: "game",
            releaseDate: g.released ?? null,
            posterUrl: g.background_image ?? null,
            ids: { rawg: g.id },
            foundOn: ["rawg"],
          });
        }
      } catch { /* continue */ }
    }

    // ── Movies ────────────────────────────────────────────────────
    if (!type || type === "movie") {
      // Search TMDB
      const tmdbMovies: any[] = [];
      try {
        const res = await fetch(
          `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(q)}&page=1`
        );
        const data = await res.json();
        tmdbMovies.push(...(data.results ?? []).slice(0, 8));
      } catch { /* continue */ }

      // Search Trakt (if connected)
      const traktMovies: any[] = [];
      if (traktIdentity?.access_token) {
        try {
          const res = await fetch(
            `https://api.trakt.tv/search/movie?query=${encodeURIComponent(q)}&limit=8`,
            { headers: { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": process.env.TRAKT_CLIENT_ID!, "Authorization": `Bearer ${traktIdentity.access_token}`, "User-Agent": "ReleaseRadar/2.0" } }
          );
          if (res.ok) traktMovies.push(...await res.json());
        } catch { /* continue */ }
      }

      // Merge by normalized title
      const merged = new Map<string, SearchResult>();

      for (const m of tmdbMovies) {
        const key = normalizeName(m.title) + (m.release_date?.slice(0, 4) ?? "");
        merged.set(key, {
          title: m.title,
          type: "movie",
          releaseDate: m.release_date ?? null,
          posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
          ids: { tmdb: m.id },
          foundOn: ["tmdb"],
        });
      }

      for (const r of traktMovies) {
        const movie = r.movie;
        if (!movie) continue;
        const key = normalizeName(movie.title) + (movie.year ?? "");
        if (merged.has(key)) {
          // Add Trakt ID to existing TMDB result
          merged.get(key)!.ids.trakt = movie.ids.trakt;
          merged.get(key)!.foundOn.push("trakt");
        } else {
          merged.set(key, {
            title: movie.title,
            type: "movie",
            releaseDate: movie.year ? `${movie.year}-01-01` : null,
            posterUrl: null,
            ids: { trakt: movie.ids.trakt, tmdb: movie.ids.tmdb },
            foundOn: ["trakt"],
          });
        }
      }

      results.push(...Array.from(merged.values()).slice(0, 8));
    }

    // ── Shows ─────────────────────────────────────────────────────
    if (!type || type === "show") {
      const tmdbShows: any[] = [];
      try {
        const res = await fetch(
          `https://api.themoviedb.org/3/search/tv?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(q)}&page=1`
        );
        const data = await res.json();
        tmdbShows.push(...(data.results ?? []).slice(0, 8));
      } catch { /* continue */ }

      const traktShows: any[] = [];
      if (traktIdentity?.access_token) {
        try {
          const res = await fetch(
            `https://api.trakt.tv/search/show?query=${encodeURIComponent(q)}&limit=8`,
            { headers: { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": process.env.TRAKT_CLIENT_ID!, "Authorization": `Bearer ${traktIdentity.access_token}`, "User-Agent": "ReleaseRadar/2.0" } }
          );
          if (res.ok) traktShows.push(...await res.json());
        } catch { /* continue */ }
      }

      const merged = new Map<string, SearchResult>();

      for (const s of tmdbShows) {
        const key = normalizeName(s.name) + (s.first_air_date?.slice(0, 4) ?? "");
        merged.set(key, {
          title: s.name,
          type: "show",
          releaseDate: s.first_air_date ?? null,
          posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w342${s.poster_path}` : null,
          ids: { tmdb: s.id },
          foundOn: ["tmdb"],
        });
      }

      for (const r of traktShows) {
        const show = r.show;
        if (!show) continue;
        const key = normalizeName(show.title) + (show.year ?? "");
        if (merged.has(key)) {
          merged.get(key)!.ids.trakt = show.ids.trakt;
          merged.get(key)!.foundOn.push("trakt");
        } else {
          merged.set(key, {
            title: show.title,
            type: "show",
            releaseDate: show.year ? `${show.year}-01-01` : null,
            posterUrl: null,
            ids: { trakt: show.ids.trakt, tmdb: show.ids.tmdb },
            foundOn: ["trakt"],
          });
        }
      }

      results.push(...Array.from(merged.values()).slice(0, 8));
    }

    return NextResponse.json({ results });
});
