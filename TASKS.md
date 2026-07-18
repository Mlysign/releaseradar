# ReleaseRadar — Task Tracker

> 📄 **Two-file setup:** [STATUS.md](STATUS.md) is the short, human-readable digest (live state + next actions — read that first). **This file (TASKS.md) is the detailed working log** — notes, changelog, gotchas, next steps for what's still open. Keep them in sync: when a task's high-level state changes, update the one-liner in STATUS.md too.

Local working copy of the [ToDo List - ReleaseRadar](https://docs.google.com/spreadsheets/d/1dmO238QWVfjoi0quv8v0xaO4fW13GsX_YZadd4WJ2BI/edit) Google Sheet.
This file is the **source of truth for execution** — Claude reads/writes here instead of the sheet.

- **Status legend:** ⬜ Not started · 🔵 In progress · ✅ Done · ⏸️ Blocked
- **Epic tags:** A Insights · B Search/Discovery · C Detail/Component/Caching · D Library · E Audits · F Data/Profile · G Foundations/tech-debt · H Post-launch/growth.
- **Notes convention:** keep an entry to 2–4 sentences + a commit hash once it's done; put the full story (root cause, every file touched, every verification step) in the commit message, not here. This is what let the file grow to 441 lines before the 2026-07-18 archive split — don't repeat that.

---

**Archive note (2026-07-18, consolidated further same day):** everything finished — Phases 0–6, the resolved audit findings (D#/A#/U#/P#/S#), the closed QA/nav/smoketest findings, H2 (data-model hardening), and the old bug tracker — lives in **[docs/archive/history.md](docs/archive/history.md)**. Grep it for a keyword when you need the "why" behind a past decision; don't read it end to end. This file holds only what's still open.

**Audit-passes summary** (full detail in the archive): five review passes — Phase 1 data/architecture, Phase 3 UI/UX, Phase 5 productionization + security — produced findings D1–D9, A1–A7, U1–U15, P1–P17, S1–S13. **Every one is resolved.** Verdict, still true: the data *model* is a genuine strength (identity-agnostic users + canonical `media_items` + per-source links + a merge layer); the issues were about *how state was stored within that model* and a few monoliths, not the core shape. Productionization/security fundamentals were sound from the start (parameterized SQL, no XSS sinks, verified OAuth) — the real gaps were credential-handling-at-rest and public-internet hardening, both closed.

---

## Open — carried forward from Phase 6

- **P13b** ⬜ · Med · when ready · ~5k — **Turn on indexing** for the public item pages: flip `PUBLIC_ITEMS_INDEXABLE` → `true` in `src/lib/publicUrl.ts` (one-line change). P13 shipped soft-launched on purpose: pages are publicly readable/unfurlable but every page sends `noindex` and `sitemap.xml` lists only `/` — indexing the owner's library publishes *what they watch/play* (titles, never ratings). **Do NOT** "fix" this via `robots.txt` Disallow — a crawler must be able to fetch a page to see its noindex tag. Decide first: index the whole library, or a curated (e.g. rated-only) subset.
- **P15** 🔵 · Med · later · ~25k — **Digital Asset Links** (`/.well-known/assetlinks.json`) + stable HTTPS origin for the Play Store TWA. Serving infra done (`src/app/.well-known/assetlinks.json/route.ts`, env-driven). **Blocked on you:** build/sign the TWA (Bubblewrap/PWABuilder) → package name + signing-cert SHA-256 → set `TWA_PACKAGE_NAME`/`TWA_CERT_FINGERPRINT` on Railway → verify the endpoint.
- **P16** ⬜ · Low · later · ~60k — Verify **OAuth + cookie flow inside the TWA**: re-register prod redirect URIs per provider; test webview behavior + deep-link return / `sameSite`. Needs P15 unblocked first.
- **P17** 🔵 · High · now · ~400k+ — **Public facet pages** (provider-sourced, session-aware) at `/person/{slug}` · `/tag/{slug}` · `/studio/{slug}` — built in the working tree (`tsc` clean, 195 tests, 0 lint errors, `next build` green). **Pending: your Chrome/UX review + live provider verification + deploy.** Replaces the authed `/insights/facet?…` (now a 308 redirect). Full design/locked decisions in memory `p17-public-facet-pages.md`; execution history in the archive.

---

## Phase 7 — Post-launch roadmap (future, not yet scoped)

Big post-launch initiatives added _2026-07-15_. Not yet broken into concrete tasks/estimates — the scope notes are starting points to refine when picked up. Epic **H**.

### QA sweep — open findings (from the 2026-07-17 browser poke, ID `Q#`)
Full click-through after P17 shipped found **no crashes, no console errors, no broken functionality** — everything below is polish. (Q1/Q2/Q4/Q5/Q6/Q13 were fixed the same day and live in the archive.)

- **Q3** 🟡 UX · Wishlist/Library — both open **scrolled to the middle** (auto-scroll-to-today over a release-date sort) — e.g. Library drops you into a pile of "TBA" games. Reconsider default sort + initial scroll for these two pages.
- **Q7** 🔵 UI · Settings — watchlist count shown **twice** (header + Account section). Redundant.
- **Q8** 🔵 SEO/UI · Authed pages — Wishlist/Library/Insights/Settings all use the generic default `<title>` instead of a page-specific one.
- **Q9** 🔵 UI · Mobile nav — the hamburger menu overlay isn't full-height/opaque; page content bleeds through beneath it.
- **Q10** 🟡 Data · P17 facet (person) — combined credits include trivial roles (e.g. "Thanks", "Characters"). Consider filtering low-signal crew jobs from the role badges.
- **Q11** 🟡 UI · P17 facet (tag) — tag label capitalization reads oddly (`/tag/sci-fi` → "Sci Fi", not "Sci-Fi"). Consider a nicer display-label.
- **Q12** 🔵 UX · P17 facet (person) — name-collision → most-popular is documented/accepted (`/person/tom` resolves to whichever "Tom" TMDB ranks first); consider surfacing the resolved full name prominently so a wrong guess is obvious.

### Navigation / back-button — open findings (2026-07-17 deep-dive, ID `N#`)
(N1 and N2 were fixed the same day and live in the archive.) **What already works well:** the `/insights/facet` → `/person` 308 redirect back-navigates cleanly; multi-hop item→facet→item unwinds correctly; Discover's list + search/filter state persist across Back.

- **N3** 🟡 UI/a11y · Discover/Wishlist/Library — item cards are `role="button"` divs (`router.push`), not real `<a>` links — no middle-click/⌘-click/"open in new tab", no hover-preview URL. P17's facet grids DO use real `<a>` links → inconsistent. Consider anchor-based cards app-wide.
- **N4** 🔵 Data · Discover — verify the browse cache has a sane TTL. Discover shows an identical list across repeat visits within a session (good — no jarring reshuffle), but cache expiry wasn't testable in one session; confirm new upcoming releases actually appear over time.

### Smoke test — 2026-07-18
All 6 findings from the first `/smoketest` run (SM1–SM6) were fixed the same day — full detail in the archive. Plan lives in [smoketest.md](smoketest.md); findings from future runs land here as a new dated section (id prefix `SM#`).

### H1 — UI/UX overhaul (mobile-first polish) 🔭
**Goal:** the mobile experience is smooth, intuitive, and looks slick + polished.
**Scope to explore:** touch-first responsive layouts across every page (Discover / Library / Insights / Detail / Calendar); navigation ergonomics (bottom nav / thumb-reach); skeleton, loading & empty states; transitions + micro-interactions; visual consistency with the Fandex brand (spacing / type / color); swipe gestures; perceived performance. Pairs with the **Android TWA (P14–P16)**, which wraps this UI — worth doing the polish before/with the TWA. Approach: UX audit → design pass → implement. (User reviews UX in their own Chrome — see [[no-self-ux-review]]; card/list components live in [[card-list-components]].)

*(H2 — data-model hardening — is done; full history in the archive.)*

### H3 — Monetization strategy 🔭
**Goal:** Fandex is self-sufficient — revenue covers upkeep (Railway hosting, domain, third-party API costs) and ideally turns a profit.
**Scope to explore:** first establish the **upkeep baseline** (current monthly cost). Then pick a model — **affiliate links** on the existing streaming/store CTAs (detail pages already link JustWatch + stores — natural, low-friction fit); **freemium / subscription** for power features (unlimited sync, advanced Insights, more platforms); one-time unlock; or donations. Ads only as a last resort. Needs payment infra (e.g. Stripe) + a clear free-vs-paid line. A product/business decision first, then implementation.

### H4 — Legal & compliance 🔭
**Goal:** the app meets all legal requirements to operate publicly — **especially EU / Germany** (operator is DE-based). This is effectively a **gate before promoting or monetizing publicly**, not purely optional (an Impressum is legally mandated in DE; GDPR governs the personal data already stored).
**Scope to explore:** **Impressum** (imprint — required by DE §5 DDG/TMG); **privacy policy** (GDPR Datenschutzerklärung — what's collected [OAuth tokens (encrypted per S2), ratings/library, the Cloudflare-routed contact email], the third parties data flows to [TMDB / Trakt / Steam / RAWG / Cloudflare / Railway], legal basis + retention); **cookie / consent** (today only an *essential* session cookie — assess whether a banner is needed or the essential-only exemption applies); **Terms of Service**; **account deletion + data export** (GDPR erasure + portability — a self-serve "delete my account" that purges `user_*` / identities / tokens, going beyond today's disconnect + library-DELETE); a **support / contact** page (`hello@fandex.org` routing is the start). Confirm against current rules — a product + legal task. Overlaps H3 (monetization needs ToS + payment/tax handling).

See [[data-model-gaps-and-plan]], [[trakt-sync-completeness]], [[testing-and-migrations]], [[discovery-insights-rebuild]], [[platform-integration-architecture]], [[public-item-pages-p13]].

---

## Remaining work (current)

- **Phase 7** (above): H1 UI/UX overhaul, H3 monetization, H4 legal/compliance — all 🔭 not yet scoped.
- **Android TWA:** P15 🔵 blocked on you building/signing the TWA; P16 ⬜ needs a live OAuth-in-TWA verification pass once P15 unblocks.
- **P13b:** one-line flip once you decide whole-library vs curated-subset indexing.
- A handful of QA/nav polish items (Q3/Q7–Q12, N3/N4) above.
- Everything else (Phases 0–6, H2, all audit findings) is done — see [docs/archive/history.md](docs/archive/history.md), or [STATUS.md](STATUS.md) for the live one-page digest.
