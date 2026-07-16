# Fandex — Status

_Your index of every game, movie & show._ · One-screen human digest. **Detail lives in [TASKS.md](TASKS.md)** (the full working log). Last updated **2026-07-15**.

---

## 🟢 Live now
- **https://fandex.org** — deployed on Railway, HTTPS valid, `/api/health` = ok.
- DNS on **Cloudflare**; **Trakt login** verified; **email** `hello@fandex.org` → Gmail (Cloudflare Email Routing).
- **Library backfilled** after the 100-cap fix: movies 100→**899**, shows 100→**273** (verified 2026-07-15; Miyazaki Insights 3→**11** rated). Sync bug ✅ done.
- Phases 1–5 complete; Phase 6 (go-live) mostly done.

## ✅ Launch-blockers all clear
The "before public" hardening is **done** — CSP enforced (verified live), HSTS on, rate-limiting, session revocation, token encryption, authz sweep, health + logs. Data is complete (899 movies, 0 missing enrichment). **Fandex is ready to share.**

## ▶ What's left (optional / your call)
1. **S2 token backfill** — re-encrypt any pre-encryption token rows (likely already moot since you reconnected every provider during the domain move — worth a 2-min confirm).
2. **Android TWA (P15/P16)** — needs *you* to build the TWA (Bubblewrap/PWABuilder) → gives the package name + cert fingerprint → set 2 env vars. Serving infra is ready.
3. **Housekeeping** — decommission the old Cloudflare R2 bucket; rename the GitHub repo `releaseradar → fandex`.
4. **P13** — SSR detail pages for shareable/crawlable URLs (nice-to-have).

_Recently done: **429 enrichment hardening** ✅ (2026-07-15) — 429 Retry-After honored, search-fallback fetches full detail, enrich failures now logged._

## ⏳ Open issues & follow-ups
| | Item | Notes |
|--|------|-------|
| 🐛 | **TMDB enrichment 429-swallow** | Sync silently drops TMDB credits on rate-limit → some titles lose director/studio tags. More likely now that libraries aren't capped. Fix = throttle + retry. |
| 🔧 | **Railway healthcheck path** | Confirm it points at `/api/health`. |
| 🔒 | **S2 token backfill** | Encrypt pre-existing plaintext token rows (reconnect or run the script). |
| 🧹 | **Decommission old Cloudflare R2 bucket** | Backups moved to the Railway bucket. Minor. |
| 🏷️ | **Rename GitHub repo** `releaseradar → fandex` | Cosmetic; GitHub auto-redirects. |

## 🗺️ Roadmap at a glance
| Area | Status |
|------|:--|
| Hosting + deploy (Railway) | ✅ live |
| Domain + OAuth (fandex.org) | ✅ done |
| Backups (Litestream → Railway bucket) | ✅ restore-drill verified |
| Observability (`/api/health`, structured logs) | ✅ done |
| Security headers / CSP (S6) | ✅ enforced (verified live) |
| Security S1/S3/S4/S5/S7–S13 | ✅ done · **S2** ✅ code (token backfill = confirm) |
| Full re-sync after the 100-cap fix | ✅ done (899 movies / 273 shows) |
| Android TWA (P14 manifest ✅ · P15 infra ✅ · P16) | 🔵 needs a TWA build to finish |
| SEO SSR detail pages (P13) | 🟢 later |

---
_Marker key: ✅ done · 🔵 in progress / blocked on input · ⏳ next action · 🟢 later · 🐛 bug_
