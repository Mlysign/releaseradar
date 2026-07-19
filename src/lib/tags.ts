// Tag categorization — sorts free-text tags (genres, TMDB keywords, Steam tags,
// Trakt subgenres) into a small taxonomy used by the Insights page and the Taste
// Match facet weighting.
//
// HOW TO TWEAK (no rebuild of logic needed):
//  - Move a tag to a different category → add/edit it in the relevant *_SET below.
//  - Add a whole new category → add an entry to CATEGORIES and create a set for it,
//    then reference that set in categorizeTag().
//  - Broad rules (e.g. "based on …" → source, decades → setting) live as regexes
//    in categorizeTag(); the word-sets are the curated overrides.
//
// IMPORTANT: keys are the NORMALIZED tag form produced by tagKey() in
// facets.ts — lowercase, with hyphens/underscores AND whitespace folded
// to single spaces. So write set entries WITHOUT hyphens ("sci fi", not "sci-fi").

export interface CategoryDef {
  id: string;
  label: string;
  color: string;          // chip / bar accent
  defaultIgnored?: boolean;
}

// Display order. `meta` is auto-ignored noise; `other` is the catch-all.
export const CATEGORIES: CategoryDef[] = [
  { id: "genre",    label: "Genre",               color: "#4ade80" },
  { id: "source",   label: "Source / Adaptation", color: "#f59e0b" },
  { id: "setting",  label: "Setting",             color: "#38bdf8" },
  { id: "artstyle", label: "Art Style",           color: "#2dd4bf" },
  { id: "mood",     label: "Mood / Tone",         color: "#fb7185" },
  { id: "theme",    label: "Theme / Plot",        color: "#a78bfa" },
  { id: "audience", label: "Audience / Format",   color: "#facc15" },
  { id: "other",    label: "Other",               color: "#9ca3af" },
  { id: "meta",     label: "Meta / Noise",        color: "#6b7280", defaultIgnored: true },
];

export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label])
);
export const CATEGORY_COLORS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.color])
);

const set = (...xs: string[]) => new Set(xs);

// ── Genres (deterministic — these come from genre fields) ─────────
const GENRE = set(
  "action", "drama", "adventure", "fantasy", "comedy", "thriller", "animation",
  "science fiction", "sci fi", "sci fi & fantasy", "action & adventure", "crime",
  "mystery", "horror", "romance", "war", "war & politics", "history", "western",
  "music", "musical", "documentary", "reality", "talk", "tv movie", "biography",
  // games
  "rpg", "role playing", "jrpg", "action rpg", "indie", "shooter", "fps",
  "first person shooter", "third person shooter", "twin stick shooter", "strategy",
  "simulation", "casual", "arcade", "platformer", "racing", "sports", "fighting",
  "puzzle", "card", "board games", "educational", "massively multiplayer", "moba",
  "hack and slash", "souls like", "metroidvania", "roguelike", "roguelite",
  "battle royale", "tower defense", "point and click", "visual novel", "beat em up",
  // film/tv subgenres that read as genre
  "superhero", "disaster", "spy", "martial arts", "slasher", "film noir", "neo noir",
  "space opera", "survival horror", "psychological thriller", "psychological horror",
  "supernatural horror", "dark fantasy", "mockumentary", "found footage", "swashbuckler",
  "period drama", "historical fiction", "slice of life", "romantic comedy", "action comedy",
  "buddy comedy", "crime drama", "teen drama", "heist film", "war film", "epic"
);

// ── Source / adaptation ───────────────────────────────────────────
const SOURCE = set(
  "manga", "based on manga", "based on comic", "based on novel or book",
  "based on novel", "based on book", "based on true story", "based on video game",
  "based on young adult novel", "based on play", "based on tv show", "based on a true story",
  "based on comic book", "based on light novel", "based on webcomic", "based on toy",
  "based on short story", "novelization", "adaptation", "true story"
);

// ── Setting (place / world / era) ─────────────────────────────────
const SETTING = set(
  "dystopia", "dystopian", "post apocalyptic", "post apocalyptic future", "apocalypse",
  "cyberpunk", "steampunk", "space", "spacecraft", "space travel", "outer space",
  "fantasy world", "kingdom", "castle", "school", "high school", "college", "prison",
  "hospital", "forest", "woods", "desert", "mountain", "island", "small town", "village",
  "city", "underwater", "jungle", "winter", "summer", "christmas", "halloween", "holiday",
  "new york city", "los angeles, california", "london, england", "japan", "paris, france",
  "tokyo", "medieval", "ancient", "victorian", "wild west", "world war ii", "world war i",
  "cold war", "future", "near future", "alternate history", "mecha", "kaiju",
  "alien invasion", "space station", "dungeon", "open world", "wilderness", "suburbia",
  "post war", "feudal japan", "fantasy", "magic", "supernatural", "mythology",
  "historical", "period", "road trip", "wild west", "outer space", "haunted house"
);

// ── Art style (visual presentation) ───────────────────────────────
const ARTSTYLE = set(
  "anime", "cartoon", "cel shaded", "pixel art", "pixel graphics",
  "hand drawn", "stop motion", "claymation", "clay", "live action",
  "cgi", "photorealistic", "realistic", "stylized", "2d", "3d", "voxel", "low poly",
  "retro", "8 bit", "16 bit", "comic book", "watercolor", "minimalist", "cartoony",
  "anthropomorphism", "puppetry", "rotoscoping", "noir"
);

// ── Mood / tone (mostly Trakt emotional tags) ─────────────────────
const MOOD = set(
  "amused", "suspenseful", "intense", "dramatic", "hilarious", "excited", "inspirational",
  "admiring", "whimsical", "witty", "playful", "cheerful", "joyful", "nostalgic", "vibrant",
  "tragic", "audacious", "bold", "adoring", "awestruck", "hopeful", "defiant", "compassionate",
  "critical", "thoughtful", "ambiguous", "mysterious", "romantic", "lighthearted", "dark",
  "shocking", "depressing", "satirical", "satire", "absurd", "aggressive", "surreal",
  "surrealism", "gritty", "melancholic", "tense", "emotional", "feel good", "heartwarming",
  "disturbing", "creepy", "eerie", "atmospheric", "campy", "quirky", "wholesome", "bittersweet",
  "grim", "scary", "funny", "sad", "violent", "gory", "gore", "brutal", "cynical",
  "dark comedy", "tragedy", "psychological", "complex", "suspense", "cautionary", "melodrama"
);

// ── Audience / format ─────────────────────────────────────────────
const AUDIENCE = set(
  "family", "kids", "children", "shounen", "seinen", "shoujo", "josei", "adult animation",
  "adult", "teen", "young adult", "miniseries", "mini series", "limited series", "anthology",
  "short", "short film", "feature film", "tv special", "for children", "all ages", "mature"
);

// ── Meta / noise (auto-ignored) ───────────────────────────────────
const META = set(
  "sequel", "prequel", "reboot", "remake", "spin off", "crossover", "duringcreditsstinger",
  "aftercreditsstinger", "post credits scene", "credits", "cameo",
  "woman director", "marvel cinematic universe (mcu)", "dc extended universe (dceu)",
  "shared universe", "franchise", "cinematic universe", "live action remake", "directors cut",
  "imax", "3d film", "title spoken by character", "no opening credits"
);

// ── Theme / plot (broad catch for content elements + characters) ──
const THEME = set(
  "revenge", "friendship", "murder", "survival", "betrayal", "redemption", "coming of age",
  "love", "death", "corruption", "conspiracy", "time travel", "good versus evil",
  "saving the world", "heist", "kidnapping", "escape", "rescue", "quest", "journey",
  "transformation", "loss of loved one", "sibling relationship", "father daughter relationship",
  "father son relationship", "parent child relationship", "husband wife relationship",
  "mother son relationship", "mother daughter relationship", "family relationships",
  "dysfunctional family", "racism", "religion", "politics", "terrorism", "violence", "drugs",
  "suicide", "bullying", "mental illness", "isolation", "immortality", "manipulation",
  "paranoia", "secret identity", "dying and death", "investigation", "rivalry", "competition",
  "tournament", "battle", "combat", "fight", "gunfight", "shootout", "chase", "brutality",
  "torture", "possession", "curse", "amnesia", "dreams", "nightmare", "whodunit", "cult",
  "virus", "technology", "artificial intelligence (a.i.)", "lgbt", "coming out", "addiction",
  "war crime", "slavery", "revolution", "rebellion", "power", "greed", "obsession", "jealousy",
  "forbidden love", "love triangle", "self discovery", "sacrifice", "morality", "free will",
  // characters / creatures / archetypes
  "villain", "hero", "anti hero", "detective", "alien", "witch", "wizard", "demon", "monster",
  "creature", "robot", "android", "cyborg", "vampire", "ghost", "zombie", "assassin", "hitman",
  "serial killer", "gangster", "criminal", "police", "fbi", "military", "soldier", "army",
  "mercenary", "vigilante", "scientist", "doctor", "princess", "prince", "king", "queen",
  "samurai", "pirate", "dragon", "mutant", "dinosaur", "elves", "dwarves", "orphan",
  "female protagonist", "secret organization", "astronaut", "musician", "ninja", "super power",
  "superpower", "magic user", "god", "angel", "knight", "warrior", "flashback",
  "organized crime", "psychopath", "action hero", "hostage", "prison break", "espionage"
);

// Curated one-off overrides that don't fit a single set cleanly. Highest priority.
const CURATED: Record<string, string> = {
  "anime": "artstyle",          // a visual style here (not the Trakt genre sense)
  "cartoon": "artstyle",
  "animation": "genre",         // keep TMDB's Animation genre as a genre
  "family": "audience",
  "magic": "setting",
  "supernatural": "setting",
  "mythology": "setting",
  "neo noir": "genre",
  "superhero": "genre",
  "anthropomorphism": "artstyle",
};

const DECADE = /^(\d{2}|\d{4})s$/;                 // 80s, 1980s
const CENTURY = /\bcentury$/;                      // 19th century
const BASED_ON = /^based on\b/;                    // based on novel / based on comic
// IGDB's keyword taxonomy carries a lot of low-value rerelease/port/media
// bookkeeping noise ("fan translation - french", "media type - cartridge",
// "nes game pak - mmc1", "wii virtual console") — real for the game, but not
// a taste signal, so it belongs in the same Meta/Noise bucket as the
// film/TV noise below.
const META_RX = /(credits?stinger|post ?credits|^woman director$|cinematic universe|\bmcu\b|\bdceu\b|^fan translation\b|^media( type)? -|^nes game pak\b|virtual console)/;
const PLACE_RX = /,\s+(california|england|france|japan|texas|new york|germany|italy|spain|china|canada|australia|usa|united states)\b/;

// Resolve one normalized tag key to a category id.
export function categorizeTag(key: string): string {
  if (!key) return "other";
  if (CURATED[key]) return CURATED[key];

  // Heuristic patterns first (broad, high-confidence rules).
  if (META.has(key) || META_RX.test(key)) return "meta";
  if (BASED_ON.test(key) || SOURCE.has(key)) return "source";
  if (DECADE.test(key) || CENTURY.test(key) || PLACE_RX.test(key)) return "setting";

  // Curated sets, most-specific first.
  if (ARTSTYLE.has(key)) return "artstyle";
  if (MOOD.has(key)) return "mood";
  if (AUDIENCE.has(key)) return "audience";
  if (GENRE.has(key)) return "genre";
  if (SETTING.has(key)) return "setting";
  if (THEME.has(key)) return "theme";

  return "other";
}
