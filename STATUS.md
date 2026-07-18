# Fandex — Status

_Your index of every game, movie & show._ · High-level roadmap. **Full detail + completion history live in [TASKS.md](TASKS.md).**

**👉 Currently: P13b — flip `PUBLIC_ITEMS_INDEXABLE` to index the whole library** (decided; just needs executing). Everything else below is either waiting on you (Android TWA, H3.0/H3.1) or not yet scoped (H1). H3 + H4 are now scoped — see TASKS.md.

---

## 🟢 Live
Fandex is live at **https://fandex.org** and ready to share — hosted on Railway (Cloudflare DNS, HTTPS, email routing), all launch-blockers cleared, security hardened, library complete. Phases 1–6 essentially done.

## ▶ What's left
| | Item | |
|--|------|--|
| 🔵 | **Android TWA** (P15/P16) | Needs you to build the TWA (Bubblewrap/PWABuilder) → package name + cert → set 2 env vars. Serving infra ready. |
| 🟡 | **P13b — turn on indexing** | Decided: index the whole library. One-line flip (`PUBLIC_ITEMS_INDEXABLE`) not yet executed. |

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
| SEO SSR detail pages (P13) | ✅ shipped **soft-launched** (`noindex` until P13b) |
| Public facet pages (P17) | ✅ **done**, live on fandex.org |
| **Post-launch (future):** | |
| UI/UX overhaul — mobile-first polish (H1) | 🔭 planned |
| Data-model hardening (H2) | ✅ **done** |
| Monetization strategy (H3) | 🟢 **scoped, v1 launch = donations + affiliate only** (2026-07-18): ads + one-time unlock + freemium **deferred to Path B** (H3.8 user threshold); on free TMDB/Trakt tiers meanwhile (risk accepted) · ⚠️ makes H4.0/H4.2 (Impressum) critical path even at this reduced scope |
| Legal & compliance — privacy, cookies, account deletion, support (H4) | 🟢 **scoped** (2026-07-18, ~110k now) · legal links via /profile footer · **Impressum + address deferred to H3 gate** pending your legal advice (H4.0) |
| Fandex Score — visible per-item taste match (H5) | 🔵 **H5.1–H5.4 done** (2026-07-19) — score badge + breakdown are LIVE; **new** `/dev/scoring` weights/taxonomy admin panel (gated to your userId locally — **add `SCORING_ADMIN_USER_IDS` on Railway too if you want it in prod**). Nothing here has been manually checked logged-in yet (needs your own login — a local session mint for testing was correctly blocked). Please sanity-check both the cards/detail page AND `/dev/scoring`. Design in [docs/fandex-score.md](docs/fandex-score.md), only H5.5 (calibrate) remains |

---
_✅ done · 🔵 in progress / needs input · 🟢 later · 🔭 future / not yet scoped · 🔒 security · 🔧 config_
