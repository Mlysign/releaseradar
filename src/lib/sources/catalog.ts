import { MediaType, Source } from "@/types";
import { Capabilities } from "./types";

// Client-safe static metadata for every connectable platform. This is the ONE
// place provider labels/colors/types/capabilities are declared. The server-side
// adapters spread their entry from here (so behavior + metadata stay in sync),
// and client components import it directly (it pulls in no server-only modules
// like the DB driver).
export interface SourceMeta {
  id: Source;
  /** Full brand name (settings connect cards). */
  label: string;
  /** Compact label for chips/badges; falls back to `label`. */
  shortLabel?: string;
  color: string;
  /** Query-param name carrying this source's id in `/item` links (see itemUrl.ts). */
  urlParam: string;
  mediaTypes: MediaType[];
  auth: "oauth" | "openid" | "credentials";
  capabilities: Capabilities;
}

export const CATALOG: Record<string, SourceMeta> = {
  trakt: {
    id: "trakt", label: "Trakt.tv", shortLabel: "Trakt", color: "#ed1c24", urlParam: "traktId", mediaTypes: ["movie", "show"], auth: "oauth",
    capabilities: { wishlist: { read: true, write: true }, library: { read: true }, rating: { read: true, write: true }, review: { read: false, write: false }, status: { write: true } },
  },
  letterboxd: {
    id: "letterboxd", label: "Letterboxd", color: "#00c030", urlParam: "letterboxdId", mediaTypes: ["movie"], auth: "oauth",
    capabilities: { wishlist: { read: true, write: true }, library: { read: true }, rating: { read: true, write: true }, review: { read: true, write: false }, status: { write: true } },
  },
  steam: {
    id: "steam", label: "Steam", color: "#1b9af7", urlParam: "steamId", mediaTypes: ["game"], auth: "openid",
    capabilities: { wishlist: { read: true, write: false }, library: { read: true }, rating: { read: false, write: false }, review: { read: false, write: false }, status: { write: false } },
  },
  rawg: {
    id: "rawg", label: "RAWG", color: "#4ade80", urlParam: "rawgId", mediaTypes: ["game"], auth: "credentials",
    capabilities: { wishlist: { read: true, write: true }, library: { read: true }, rating: { read: true, write: true }, review: { read: false, write: false }, status: { write: true } },
  },
  tmdb: {
    id: "tmdb", label: "TMDB", color: "#01b4e4", urlParam: "tmdbId", mediaTypes: ["movie", "show"], auth: "oauth",
    // TMDB has no "watched" history — library = Rated items, no status write.
    capabilities: { wishlist: { read: true, write: true }, library: { read: true }, rating: { read: true, write: true }, review: { read: false, write: false }, status: { write: false } },
  },
};

export function catalogForType(type: MediaType | string): SourceMeta[] {
  return Object.values(CATALOG).filter((m) => m.mediaTypes.includes(type as MediaType));
}
