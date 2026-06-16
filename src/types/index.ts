export type MediaType = "game" | "movie" | "show";
export type Source = "steam" | "rawg" | "tmdb" | "trakt" | "igdb" | "letterboxd";

export interface MediaItem {
  id: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MediaLink {
  id: string;
  mediaItemId: string;
  source: Source;
  sourceId: string;
  title: string | null;
  releaseDate: string | null;
  rawData: Record<string, any>;
  lastSynced: number;
}

export interface UserIdentity {
  id: string;
  userId: string;
  provider: Source;
  providerUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  metadata: Record<string, any> | null;
}

export interface WatchlistEntry {
  id: string;
  userId: string;
  mediaItemId: string;
  platformSources: Source[];
  addedAt: number;
  notes: string | null;
}

// One external/community score, normalized for display.
// score is on the scale given by outOf (10, 5 or 100); votes when known.
export interface CommunityRating {
  source: string;          // "tmdb" | "trakt" | "imdb" | "rt" | "metacritic" | "rawg" | "igdb" | "igdb-critics" | "steam" | "letterboxd"
  label: string;           // display name, e.g. "IMDb"
  score: number;
  outOf: number;
  votes?: number | null;
  url?: string | null;
}

// Enriched item returned to the client
export interface EnrichedItem {
  id: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;       // portrait box-art (card view)
  backdropUrl: string | null;     // landscape art (list-row thumbnail); null → fall back to posterUrl
  platformSources: Source[];
  // Per-source dates
  dates: { source: Source; date: string }[];
  // From merge
  images: string[];
  tags: string[];
  platforms: string[];
  description: string | null;
  tagline: string | null;
  metacritic: number | null;
  steamReviewLabel: string | null;
  rtScore?: number | null;
  imdbRating?: number | null;
  imdbId?: string | null;
  letterboxdRating?: number | null;
  // Unified per-source community scores (TMDB, Trakt, IGDB, RAWG, Steam, …)
  communityRatings: CommunityRating[];
  // Facts (movies/shows + some game equivalents)
  runtimeMinutes: number | null;     // movie runtime / show per-episode runtime
  certification: string[];           // age ratings across regions: ["FSK 16", "PG-13", …]
  status: string | null;             // Released / Ended / Returning Series…
  collection: string | null;         // TMDB collection or IGDB franchise
  originalLanguage: string | null;
  country: string | null;
  budget: number | null;             // USD (TMDB)
  revenue: number | null;            // USD (TMDB)
  boxOffice?: string | null;         // formatted (OMDB)
  awards?: string | null;            // OMDB awards summary
  // Shows
  network: string | null;
  seasonCount: number | null;
  episodeCount: number | null;
  nextEpisode: { name: string | null; airDate: string | null; season: number | null; episode: number | null } | null;
  // Games
  gameModes: string[];               // IGDB game modes + player perspectives
  playtimeHours: number | null;      // RAWG average playtime
  timeToBeat: { hastily: number | null; normally: number | null; completely: number | null } | null; // hours (IGDB)
  dlc: string[];                     // IGDB dlcs/expansions + Steam included apps
  // Library (watched / played / owned) — present on /api/library items
  rating?: number | null;        // personal score, 0-10 scale — AVERAGE across platforms
  ratings?: { source: Source; rating: number }[]; // per-platform breakdown
  review?: string | null;
  reviewedAt?: number | null;    // unix seconds
  libraryStatus?: string | null; // watched | played | owned
  developer: string | null;
  publisher: string | null;
  // Movie/show credits + keywords (from TMDB)
  director?: string | null;        // movie director, or show creator
  cast?: { name: string; character: string | null; profileUrl?: string | null }[];
  keywords?: string[];
  trailerYoutubeKey: string | null;
  steamTrailerUrl: string | null;
  storeLinks: { name: string; url: string; source: Source }[];
  streamingProviders: { name: string; logoPath: string | null; providerId: number }[];
  links: { label: string; url: string }[];
  // Raw source data for the detail panel
  sources: { source: Source; sourceId: string; data: Record<string, any> }[];
}

export interface SessionUser {
  userId: string;
  identityId: string;
  provider: Source;
  displayName: string | null;
}
