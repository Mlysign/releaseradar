# Fandex — Status

_Your index of every game, movie & show._ · High-level roadmap. **Full detail + completion history live in [TASKS.md](TASKS.md).**

**👉 Currently: P17 (public facet pages) — built, pending your Chrome/UX review + deploy.** Everything below this is either waiting on you (Android TWA, P13b indexing decision) or not yet scoped (H1/H3/H4).

---

## 🟢 Live
Fandex is live at **https://fandex.org** and ready to share — hosted on Railway (Cloudflare DNS, HTTPS, email routing), all launch-blockers cleared, security hardened, library complete. Phases 1–6 essentially done.

## ▶ What's left
| | Item | |
|--|------|--|
| 🔵 | **Android TWA** (P15/P16) | Needs you to build the TWA (Bubblewrap/PWABuilder) → package name + cert → set 2 env vars. Serving infra ready. |
| 🟣 | **P17 — Public facet pages** (reframed "P13b") | **BUILT 2026-07-17 (working tree; tsc+195 tests+build green, 0 lint errors) — pending your Chrome/UX review + deploy.** Audit found item pages + /discover already link to public pages — facets were the only gap. Public, provider-sourced, session-aware **`/person /tag /studio`** pages replace authed `/insights/facet?…` (now a 308 redirect): combined roles + role-per-work badges, crowd-avg + your-vs-crowd overlay, paginated/sorted, persist-at-fetch linking. **Provider integration (TMDB/RAWG search + credits) is UNVERIFIED live — needs your browser pass.** Detail in [TASKS.md](TASKS.md) P17 + memory. |
| 🟡 | **P13b — turn on indexing** | Deferred until P17 lands (index orphan pages = bad). One-line flip (`PUBLIC_ITEMS_INDEXABLE`). Decide first: index the whole library or a subset? |

## 🗺️ Roadmap
| Area | Status |
|------|:--|
| Hosting + deploy (Railway) | ✅ |
| Domain + OAuth + email (fandex.org) | ✅ |
| Backups (Litestream → Railway bucket) | ✅ |
| Observability (`/api/health`, structured logs) | ✅ |
| Security (S1–S13, CSP enforced) | ✅ · S2 backfill confirmed closed (2026-07-17) |
| Sync completeness + TMDB enrichment | ✅ |
| Android TWA | 🔵 needs TWA build |
| SEO SSR detail pages (P13) | ✅ shipped **soft-launched** (`noindex` until P13b) |
| **Post-launch (future):** | |
| UI/UX overhaul — mobile-first polish (H1) | 🔭 planned |
| Data-model hardening (H2) | ✅ **done** (A→B→C all shipped 2026-07-16/17) |
| Monetization strategy (H3) | 🔭 planned |
| Legal & compliance — imprint, privacy, cookies, account deletion, support (H4) | 🔭 planned · gate before public/EU |
| Fandex Recommendation Algorithm (manually added by nils) | 🔭 planned (FYI, Claude) |

---
_✅ done · 🔵 in progress / needs input · 🟢 later · 🔭 future / not yet scoped · 🔒 security · 🔧 config_
