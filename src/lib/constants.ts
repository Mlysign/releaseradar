import { MediaType, Source } from "@/types";
import { CATALOG } from "@/lib/sources/catalog";

export const TYPE_COLORS: Record<MediaType | string, string> = {
  game: "#4ade80",
  movie: "#f59e0b",
  show: "#a78bfa",
};

// Connectable-platform presentation (color/label) is declared once in catalog.ts
// (A5); the maps below derive from it and add the display-only sources — IGDB
// (metadata) and the external rating providers in the community-ratings row,
// which aren't connectable accounts.
const CATALOG_COLORS = Object.fromEntries(Object.values(CATALOG).map((m) => [m.id, m.color]));
const CATALOG_LABELS = Object.fromEntries(Object.values(CATALOG).map((m) => [m.id, m.shortLabel ?? m.label]));

export const SOURCE_COLORS: Record<Source | string, string> = {
  ...CATALOG_COLORS,
  igdb: "#9147ff",
  // External rating sources surfaced in the unified community-ratings row.
  imdb: "#f5c518",
  rt: "#fa320a",
  metacritic: "#ffcc33",
  "igdb-critics": "#9147ff",
};

// Per-role accent colors + labels for people/company facets on the Insights page
// (tags use CATEGORY_COLORS from tags.ts).
export const ROLE_COLORS: Record<string, string> = {
  director: "#f472b6",
  writer: "#c084fc",
  creator: "#818cf8",
  cast: "#22d3ee",
  developer: "#4ade80",
  publisher: "#facc15",
  studio: "#fb923c",
  network: "#38bdf8",
};

export const ROLE_LABELS: Record<string, string> = {
  director: "Directors",
  writer: "Writers",
  creator: "Creators",
  cast: "Cast",
  developer: "Developers",
  publisher: "Publishers",
  studio: "Studios",
  network: "Networks",
};

export const SOURCE_LABELS: Record<Source | string, string> = {
  ...CATALOG_LABELS,
  igdb: "IGDB",
  imdb: "IMDb",
  rt: "Rotten Tomatoes",
  metacritic: "Metacritic",
  "igdb-critics": "IGDB Critics",
};
