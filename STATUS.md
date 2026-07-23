# Fandex — Status

_Your index of every game, movie & show._ · High-level roadmap. **Full detail + completion history live in [TASKS.md](TASKS.md).**

**🔴 2026-07-22: fandex.org is DOWN — Railway paused all deployments at $10.28/$10.00 compute usage.** Not an app fault: every route returns Railway's edge 404. **Your decision: wait for the next billing cycle** (~1 Aug) rather than raise the limit, so the site stays down until then. **No data was at risk.** Ironically the cause is also the cure — the PR16 prune's ~1 h of sustained CPU + ~12.8 GB of WAL churn to S3 tipped usage over the cap, but it also removed the 2.5 GB database that was driving the memory, page-cache and volume costs in the first place, so next cycle should be materially cheaper. Lesson recorded: check Railway usage as a precondition before any heavy prod operation — the "nearing limit" warning was visible beforehand and got treated as an aside.

**👉 2026-07-22: the catalog-pool blowup is FIXED end to end (PR13–PR16 done).** Growth stopped (anon/crawler traffic no longer mints rows) **and** the accumulated tail is gone: **546,754 rows pruned + VACUUM took `rr.db` from 2,487 MB → 36.5 MB**, `media_items` 680,766 → **2,012**, volume free 2.1 GB → 4.18 GB. User data verified untouched on every single pass (`user_library` 1912, `user_watchlist` 96, zero orphans). **Only PR17 (verify + close out) remains, and it's blocked until the service is back** — including confirming the Litestream backup generation survived the VACUUM, which is currently **unverified**. Full detail in TASKS.md.

**Previously: 2026-07-22: catalog-pool growth STOPPED (PR13–PR15 shipped); the 2.5 GB prune (PR16) still needs a dedicated Opus session.** Sitemap now excludes the browsed tail (2,518 pool URLs vs 3,848 total locally), and public facet pages + `/api/discover` only write a `media_items` row for a logged-in viewer — anon/crawler traffic renders "not yet in the catalog" instead of minting rows, browser-verified with a before/after row count. 277 tests pass, typecheck + lint + build clean. **Not yet deployed — needs your push.** Once it's live in prod for a while, PR16 (prune the existing 675k-row tail + VACUUM) is next — do NOT delegate that one, it's a real DELETE against production data.

**Previously (same day): memory ramp returned a THIRD time — diagnosed, root cause is the DB, plan locked (PR13–PR17).** Not a leak this time: Node sat flat at 354 MB RSS / 100 MB heap and Litestream at 58 MB while `cgroup.fileMb` (kernel **page cache**) went 2 MB → 488 MB in 41 minutes. The container is caching pages of a **2.5 GB `rr.db`** — reclaimable, won't OOM (limit 7.6 GB), purely a **cost** problem. Root cause: **675,787 `media_items`** against **1,912 library rows** — public facet pages persist every provider-sourced title (60/page) and crawlers walk them, so the pool grew unbounded. `freelistCount: 0`, so VACUUM alone reclaims nothing. **Found in passing: the sitemap enumerates all 676k items** — ~135 MB and 13.5× Google's 50k-URL cap, so P13b indexing may have been silently dead for a while. Two new diagnostics shipped (`/api/health` now reports cgroup + per-process + DB-file sizes; new admin-gated `/api/dev/dbsize`). Decisions locked: persist only for logged-in users, prune + VACUUM, **PR13–PR15 safe for Sonnet, PR16 (the prune) stays Opus/main-loop** per AGENTS.md. Full plan in TASKS.md ("Catalog-pool blowup + memory ramp — 2026-07-22").

**Previously: 2026-07-21: memory ramp returned — different cause, fixed (PR10–PR12).** RSS hit 7.52 GB the day after the PR1–PR9 deploy, with the error log now entirely image-optimizer timeouts. The heap cap was fine; the memory was **native**: `/_next/image` was decoding **full-size RAWG originals** (726/726 game posters are stored unresized, up to 3.8 MB → ~25 MB decoded each, up to 9 per game page, no concurrency limit, 0.4 vCPU). Fix: images now bypass the optimizer entirely and the CDNs resize instead (custom `next/image` loader) + `MALLOC_ARENA_MAX=2` + `/api/health` now reports the heap-vs-native memory split so the next one takes minutes, not hours. **Accepted tradeoff:** movie/show posters ~26 KB WebP → ~65 KB JPEG; game art gets far lighter; image egress leaves the Railway bill. Detail in TASKS.md ("Production incident — 2026-07-21"). **Not yet deployed — needs your push.**

**Previously: 2026-07-20: Railway incident fixed (PR1–PR8).** The post-P13b crawler wave exposed a lock-error wall (`database is locked`), a memory ramp toward 8 GB, and a $19.54/mo cost estimate. Root causes fixed same day: `BEGIN IMMEDIATE` transactions (Litestream contention), heap cap, bounded caches on the OMDB/item/facet public read paths, image-optimizer hardening, `?sort=` crawl disallow. Full detail in TASKS.md ("Production incident — 2026-07-20"). **Watch the Railway dashboard over the next days**: errors → ~0, memory ≤ ~2 GB, cost drifting back toward $5–8.

**Previously: round-2 QA batch (Q23–Q31) shipped 2026-07-19.** All 9 follow-up items implemented: facet-page popularity/Fandex-badge/`/studio/focus` fixes, Discover tag search + IGDB + Fandex-sort scroll fixes, tag "Fandex impact" pill replacing the Bayesian stat, capped-facet graying, main-vs-support cast weighting, Insights category overrides. 255 tests + typecheck + lint (0 errors) clean; anon surfaces browser-verified. **Logged-in verification still outstanding** — please eyeball the Fandex Score breakdown, facet-page badges, the tag-page impact pill, and Discover's Fandex-sort scroll with your own session (see TASKS.md for the full list). Everything else is either waiting on you (Android TWA, H3.0, legal advice) or not yet scoped (H1).

---

## 🟢 Live
Fandex is live at **https://fandex.org** and ready to share — hosted on Railway (Cloudflare DNS, HTTPS, email routing), all launch-blockers cleared, security hardened, library complete. Phases 1–6 essentially done.

## ▶ What's left
| | Item | |
|--|------|--|
| 🔵 | **Android TWA** (P15/P16) | Needs you to build the TWA (Bubblewrap/PWABuilder) → package name + cert → set 2 env vars. Serving infra ready. |

## 🗺️ Roadmap
| Area | Status |
|------|:--|
| Hosting + deploy (Railway) | ✅ |
| Domain + OAuth + email (fandex.org) | ✅ |
| Backups (Litestream → Railway bucket) | ✅ |
| Observability (`/api/health`, structured logs) | ✅ |
| Security (S1–S13, CSP enforced) | ✅ |
| Sync completeness + TMDB enrichment | ✅ |
| Android TWA | 🔵 needs TWA build |
| SEO SSR detail pages (P13) | ✅ **fully live** — indexing turned on 2026-07-19 (P13b) |
| Public facet pages (P17) | ✅ **done**, live on fandex.org |
| **Post-launch (future):** | |
| UI/UX overhaul — mobile-first polish (H1) | 🟢 **scoped** (2026-07-20) + **H1.0 requirements pass done** — plan follows your Miro workflow doc (requirements → visual direction in Claude Design → lock design system → implement); target IA is a real restructure (public Home, `/wishlist` `/calendar` `/profile` routes, bottom nav). **H1.1 + H1.2 done same day.** IA locked (public Home, `/wishlist` `/calendar` `/profile`, adaptive nav, Search=Discover, Home bundles in / Similar Items out, Discover defaults to Popularity); design brief packaged for Claude Design at [docs/ui-overhaul-design-brief.md](docs/ui-overhaul-design-brief.md) (Home page, both auth variants). **Next: H1.3 — you pick a visual direction in Claude Design.** Details: [docs/ui-overhaul.md](docs/ui-overhaul.md) + TASKS.md · 7 board corrections for you in doc §5 |
| Data-model hardening (H2) | ✅ **done** |
| Monetization strategy (H3) | 🟢 **scoped, v1 launch = donations + affiliate only** (2026-07-18): ads + one-time unlock + freemium **deferred to Path B** (H3.8 user threshold); on free TMDB/Trakt tiers meanwhile (risk accepted) · ⚠️ makes H4.0/H4.2 (Impressum) critical path even at this reduced scope |
| Legal & compliance — privacy, cookies, account deletion, support (H4) | 🟢 **scoped** (2026-07-18, ~110k now) · legal links via /profile footer · **Impressum + address deferred to H3 gate** pending your legal advice (H4.0) |
| Fandex Score — visible per-item taste match (H5) | 🔵 **H5.1–H5.4 + H5.6 + H5.7 done** (2026-07-19) — score badge + breakdown are LIVE; `/dev/scoring` weights/taxonomy admin panel (gated to your userId locally — **add `SCORING_ADMIN_USER_IDS` on Railway too if you want it in prod**). **H5.6**: calibration knobs self-explain + Preview pins up to 3 items; **tag bundling** (merge synonym/misspelled spellings into one canonical tag; migration 10). **H5.7**: **unified sort model** — Discover/Library/Wishlist + facet pages now all share Release date · Popularity · Rating (Bayesian) · **Fandex Score**. Nothing here manually checked logged-in yet (needs your own login). Please sanity-check cards/detail, `/dev/scoring`, and the new sort options. Design in [docs/fandex-score.md](docs/fandex-score.md), only H5.5 (calibrate) remains |

---
_✅ done · 🔵 in progress / needs input · 🟢 later · 🔭 future / not yet scoped · 🔒 security · 🔧 config_
