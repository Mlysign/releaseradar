// Fandex Score default config + taxonomy seed (H5.1) — the ONE place these
// numbers live, so migrations.ts (seeding — must stay leaf/side-effect-free)
// and scoringConfig.ts (runtime loader) can't drift apart. This module must
// import nothing that opens a db connection or reads env at module scope;
// tags.ts qualifies (pure data + a pure function).

import { CATEGORIES } from "@/lib/tags";

export interface ScoringConfigValues {
  roleWeights: Record<string, number>; // director / creator / writer / cast / developer / publisher / studio / network / tag
  priorStrength: number;   // C — Bayesian shrinkage prior strength (§3.1)
  mappingConstant: number; // K — 50 + K·weightedDev (§3.3)
  perCategoryCap: number;  // top-N tags per category counted toward the aggregate (§3.3, D3)
}

// Mirrors discovery.ts's ROLE_WEIGHT + K_SHRINK verbatim, so seeding this table
// changes no live scoring behavior (that swap is H5.2). mappingConstant and
// perCategoryCap are new knobs with no prior equivalent — provisional
// defaults, tuned for real against a real library in H5.5.
export const DEFAULT_SCORING_CONFIG: ScoringConfigValues = {
  roleWeights: {
    director: 1.3, creator: 1.3, writer: 1.0, cast: 0.6,
    developer: 1.2, publisher: 0.8, studio: 0.7, network: 0.6, tag: 1.0,
  },
  priorStrength: 5,
  mappingConstant: 10,
  perCategoryCap: 3,
};

export interface TagCategorySeed {
  id: string;
  label: string;
  color: string;
  weight: number;
  ignored: boolean;
  sortOrder: number;
}

// Faithful mirror of tags.ts's CATEGORIES: `meta` stays ignored (weight 0),
// every other category defaults to weight 1 — i.e. today's un-weighted
// behavior, until the dev backend (H5.4) is used to rebalance.
export const DEFAULT_TAG_CATEGORIES: TagCategorySeed[] = CATEGORIES.map((c, i) => ({
  id: c.id,
  label: c.label,
  color: c.color,
  weight: c.defaultIgnored ? 0 : 1,
  ignored: !!c.defaultIgnored,
  sortOrder: i,
}));
