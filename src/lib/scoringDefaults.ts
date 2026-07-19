// Fandex Score default config + taxonomy seed (H5.1) — the ONE place these
// numbers live, so migrations.ts (seeding — must stay leaf/side-effect-free)
// and scoringConfig.ts (runtime loader) can't drift apart. This module must
// import nothing that opens a db connection or reads env at module scope;
// tags.ts qualifies (pure data + a pure function).

import { CATEGORIES } from "@/lib/tags";

export interface ScoringConfigValues {
  roleWeights: Record<string, number>; // director / creator / writer / cast / developer / publisher / studio / network / tag
  priorStrength: number;   // C — Bayesian shrinkage prior strength (§3.1)
  // Q19 (2026-07-19): the score now centers on the user's OWN mean rating (not
  // a fixed 50 — see computeFandexScore), with an asymmetric gain so a
  // above-your-average item swings up faster than a below-average one swings
  // down (skews the visible range toward enthusiasm rather than half the
  // library reading as "you won't like this"). The center itself is derived,
  // never a knob — only the two gains are.
  mappingConstantUp: number;   // K_up — gain applied when weightedDev >= 0
  mappingConstantDown: number; // K_down — gain applied when weightedDev < 0
  perCategoryCap: number;  // top-N tags per category counted toward the aggregate (§3.3, D3)
}

// Mirrors discovery.ts's ROLE_WEIGHT + K_SHRINK verbatim, so seeding this table
// changes no live scoring behavior (that swap is H5.2). The K constants and
// perCategoryCap are provisional defaults, tuned for real against a real
// library in H5.5. Q19 asks for K_up > K_down (asymmetric); defaults stay
// SYMMETRIC (matching the prior single-K behavior exactly) so the actual skew
// amount is a real calibration decision made against real data via
// /dev/scoring, not a guessed constant baked in here.
export const DEFAULT_SCORING_CONFIG: ScoringConfigValues = {
  roleWeights: {
    director: 1.3, creator: 1.3, writer: 1.0, cast: 0.6,
    developer: 1.2, publisher: 0.8, studio: 0.7, network: 0.6, tag: 1.0,
  },
  priorStrength: 5,
  mappingConstantUp: 10,
  mappingConstantDown: 10,
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
