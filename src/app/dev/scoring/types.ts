// Client-side mirror of the H5.4 scoring config shapes (kept free of server imports).

export interface ScoringConfigValues {
  roleWeights: Record<string, number>;
  priorStrength: number;
  mappingConstant: number;
  perCategoryCap: number;
}

export interface TagCategoryConfig {
  id: string;
  label: string;
  color: string;
  weight: number;
  ignored: boolean;
  sortOrder: number;
}

export interface Reason {
  kind: string;
  role?: string;
  label: string;
  category?: string;
  contribution: number;
  BA?: number;
  n?: number;
}

// Roles shown in the Weights panel. "tag" is a vestigial key in scoring_config
// (buildProfile never actually reads roleWeights.tag — tag facets weight by
// their CATEGORY, not a role), so it's deliberately left out here.
export const ROLE_ORDER = ["director", "creator", "writer", "cast", "developer", "publisher", "studio", "network"];
