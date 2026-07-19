# Fandex — smoke test plan

Living plan for the `/smoketest` skill. **Findings do NOT go here** — they go into
[TASKS.md](TASKS.md) as a dated "Smoke test — YYYY-MM-DD" section (same convention as the
2026-07-17 QA sweep, ids `Q#`/`N#`). Use id prefix **`SM#`** (plain `S#` collides with the
security tasks). Before logging anything, check the existing Q/N/SM tables — don't re-log a
known open finding; note "still present" only if it's load-bearing.

**Etiquette:** observe, don't fix. Log functional bugs, data inconsistencies, nav/state
loss, console/server errors — AND (since 2026-07-18, per user request) a **dedicated UI/UX
evaluation** (section E below). The user still does their own Chrome pass for final taste
calls, but concrete UX findings (readability, touch targets, layout problems, inconsistent
visual language) are in scope for the sweep.

## How to run

- Dev server: `preview_start {name: "dev"}` (.claude/launch.json → `npm run dev`, port 3000,
  autoPort). Next 16 dev server; first compile of each route is slow — a 5–15s first response
  is normal, not a hang.
- Local DB: `data/rr.db` (real library snapshot, 1 user, 4 identities: steam/rawg/trakt/tmdb).
  It's the production-shaped upgrade-path DB — treat writes as acceptable (it's a dev copy)
  but don't bulk-delete.
- Server logs: `preview_logs`; console: `read_console_messages`; network: `read_network_requests`.
- **Live/production run** (e.g. "smoketest the live version" after a deploy): point
  `preview_start`/`navigate` at `https://fandex.org` instead of localhost. No `preview_logs`
  or local DB access — rely on `read_console_messages`/`read_network_requests` + reading actual
  response bodies (status codes alone aren't enough, see SM7). Auth mint recipe below is
  dev-only (needs the dev `.env` JWT_SECRET, wouldn't match prod's) — a live run is anon-only
  by construction, not just by the credential-forging block. Useful trick when another Claude
  session already has `next dev` running in this folder and blocks a fresh `preview_start`:
  `preview_start({url: "http://localhost:3000"})` (or the live URL) still opens a plain browser
  tab pointed at it — that bypasses the "server already running" conflict entirely since it's
  not trying to spawn a second dev server.

## Auth (logged-in state, no OAuth needed)

Sessions are JWTs (`src/lib/session.ts`) signed with `JWT_SECRET` from `.env`
(dev fallback `dev-only-insecure-secret-rr2` if unset — local `.env` DOES set one, so read it).
Payload = `{userId, identityId, provider, displayName, se: <users.session_epoch>}`,
cookie `rr2_session`. Recipe:

1. Get user + epoch + an identity:
   `node -e "const db=require('better-sqlite3')('data/rr.db',{readonly:true}); console.log(JSON.stringify(db.prepare('SELECT id,session_epoch FROM users').get()), JSON.stringify(db.prepare('SELECT id,provider,display_name FROM user_identities').all()))"`
2. Mint (script uses repo's own `jose`; `se` MUST equal current `session_epoch` or the token is rejected):
   write a scratchpad `mint.mjs` that reads `JWT_SECRET` from `.env`, then
   `new SignJWT({userId, identityId, provider, displayName, se}).setProtectedHeader({alg:'HS256'}).setExpirationTime('30d').setIssuedAt().sign(secret)`.
3. In the preview browser: `javascript_tool` → `document.cookie = "rr2_session=<token>; path=/"`,
   then reload. (Server accepts it; httpOnly only matters for reads.) To go anon again, clear it:
   `document.cookie = "rr2_session=; path=/; max-age=0"`.

Never enter real passwords / do real OAuth. The OAuth round-trip itself (Trakt login,
H2c intent-drain across the redirect) can only be verified on live — out of scope here;
test the pieces (dialog opens, return-path cookie set, guard rejects evil paths).

**2026-07-18 update: the mint-and-set-cookie recipe above is now reliably blocked** by the
harness's safety classifier (flagged as credential-forging) — it fired on this run and on
H5.4's own verification attempt (see memory). Don't keep retrying it. Instead: ask the user
to log in themselves in the shared Browser pane (it's the same pane visible in their UI —
they can click a real OAuth provider with their own account), then continue driving once
they confirm. Fall back to an anon-only sweep + a follow-up run if they'd rather do that
later.

## Flow checklist

Anonymous first (public surface), then logged-in. Check console + server logs after each block.

**A. Public / anonymous**
1. `/` landing — renders, login options; known gap: no browse-without-account link (Q2).
2. `/discover` anon — ungated (H2b), items render, search + filters work, no user-specific rows.
3. Item page `/{movie|show|game}/{uuid}/{slug}` — pick one via discover link-through. SSR content,
   OG/meta tags present, `noindex` while `PUBLIC_ITEMS_INDEXABLE` unset. Anon sees REAL star +
   wishlist controls (H2c); interacting opens the sign-in dialog (not a redirect); dialog sets
   return-path cookie; `isSafeReturnPath` rejects `//evil` & absolute URLs.
4. Wrong-slug URL (right uuid, junk slug) — should canonicalize/redirect or still render, not 404.
5. Facet pages (P17): `/person/christopher-nolan`, `/tag/sci-fi`, `/studio/<one>` — resolve via
   provider, grid renders with real `<a>` links, sort re-queries, Load more 60→120, pagination
   past end doesn't error.
6. `/insights/facet?...` legacy URL → 308 to the public facet page.
7. Gated pages anon: `/library` `/insights` `/settings` `/dashboard` — graceful (page shell 200s,
   then client-side redirect to login, not error/blank). Note: **`/wishlist` is not a real route**
   — wishlist is a membership filter (`rr_library_membership`) inside `/library`, not its own page;
   don't test it as a URL (confirmed 2026-07-18, no `src/app/wishlist`).
8. 404s: garbage uuid item URL, unknown person. Known: unbranded default 404 (Q13).
9. `/robots.txt`, `/sitemap.xml` (sitemap is cached-by-default — note staleness only),
   `/api/health` → 200 ok. **On a LIVE run, actually read robots.txt's `Host:`/`Sitemap:`
   values, don't just check the status code** — SM7 (2026-07-19) was a 200 response with a
   dead `localhost:3000` origin baked in at build time (route lacked `dynamic =
   "force-dynamic"`, fixed). A route returning 200 with the wrong content is exactly the
   kind of thing a status-code-only check misses.

**B. API probes (curl or fetch, both auth states)**
10. `/api/discover` anon GET/POST happy path; malformed JSON body → 400 not 500 (S8 zod).
11. Gated APIs anon (`/api/library`, `/api/watchlist` POST, `/api/settings`) → 401, error shape sane.
12. Junk input: watchlist POST with bad posterUrl (S12), bad enum values → 400.

**C. Logged-in (minted cookie)**
13. `/dashboard` + nav pages all render with real data (library ~2k items).
14. Wishlist: add from an item page → appears in `/wishlist` → survives reload → remove → gone.
    (DB write-back to platforms will fire with real tokens — acceptable on dev data, but prefer
    an obscure item and undo it.)
15. Rate an item (stars) → survives reload → shows in the facet-page personal overlay.
16. `/insights` renders; facet link-through → public facet page shows you-vs-crowd overlay.
17. Search in discover: query + filter, persisted across item→Back (usePersistedState; N-positives).
18. Settings: renders, country setting present; don't disconnect anything (bumps epoch → kills
    minted token — re-mint if it happens).
19. Calendar/timeline views on wishlist/library render; known mid-scroll landing (Q3/N2).

**D. Cross-cutting**
20. Back-button spot checks on any NEW surface (full deep-dive already done — N1/N2/N3 known).
21. **Both layouts on every flow**: run each checklist flow in the desktop viewport AND
    `resize_window` preset mobile (375×812) — not just one mobile spot-check at the end.
    Cheap way: after each desktop flow passes, re-run its key screen at mobile width and
    screenshot. Known mobile issues: hamburger overlay translucent (Q9), nav not
    session-aware (Q1).
22. Console errors anywhere = always log; server log warnings/errors after the sweep.
23. Data consistency: same list twice in a row (discover, facet) — stable order, same counts.
24. **Scroll smoothness**: on Discover browse + a big facet page + wishlist/library, scroll
    continuously through the list and click "Load more" / lazy-load boundaries mid-scroll.
    Pass = the viewport position holds steady; fail = jittery jumps, content shifting under
    the cursor when new items/months mount, or scroll position teleporting (beyond the known
    auto-scroll-to-today on mount, N2). Check both layouts — mobile momentum scroll included.
    Evidence: record scrollY before/after a Load more via `javascript_tool`.
25. **Platform sync write-back validation**: after a wishlist add (C.14), verify the change
    actually reached the platform — not just that our API returned 200. How: read the
    provider's own state read-only — for Trakt, GET the user's watchlist from the Trakt API
    using the stored (decrypt-tolerant) token from `user_identities`; for RAWG, GET the
    public wishlist of `@ramses3006`. Confirm the item appears after add and is gone after
    the remove. Steam is read-only (no write-back to verify). Log any drift (200 locally but
    absent on the platform = broken write-back; that's a 🟠).

**E. Dedicated UI/UX evaluation (added 2026-07-18, per user request)**
Run on the main surfaces (landing, Discover, item page, facet page, wishlist/library,
Insights, Settings), desktop + mobile. Screenshot evidence for each finding.
26. **Links — consistent visual language**: are clickable things visibly clickable, and
    styled the same everywhere? (Known inconsistency: facet grids use real `<a>`, browse
    grids use `role="button"` divs — N3.) Hover/focus states present? Visited/unvisited
    treatment consistent? In-text links distinguishable from plain text without hovering?
27. **Readability**: font sizes — body text, metadata lines (dates, "· 2 dates", role
    badges), section headers — comfortably legible at arm's length on mobile? Contrast of
    dim/gray secondary text against the dark background OK (spot-check computed colors vs
    WCAG AA via `javascript_tool`)? Line lengths on wide desktop not overlong?
28. **Touch targets (mobile)**: links/buttons ≥ ~44×44px — measure the quick-action icons
    on cards (rate / watched / wishlist), tag chips, sort buttons, calendar day cells,
    month-scrollbar entries via `getBoundingClientRect`. Adjacent targets far enough apart
    to not mis-tap?
29. **Layout**: wasted or cramped space at each breakpoint; grids reflowing sensibly between
    375px / tablet / wide desktop; no overflow, truncation without tooltip/ellipsis, or
    overlapping elements; sticky headers/filters behaving while scrolling.
30. **More (open-ended)**: anything a demanding user would grumble about — loading/skeleton
    states, focus visibility for keyboard nav, empty states, spacing rhythm, icon-only
    buttons without labels/tooltips. Log with screenshots; user makes final taste calls.
31. **Cross-surface consistency diff** (added 2026-07-19 — the user found Q14/Q15 that the
    sweeps missed): the same conceptual view rendered on different pages must match. Put the
    card grid on Discover, Library/Wishlist, and a facet page side by side (screenshots) and
    diff: card aspect/height, media-type indicator, quick actions, sort UI, badges (Fandex
    Score), dividers/scrubber. Same for list view. Any divergence not obviously
    context-dependent (platform rating, date formatting, person role) is a finding.
32. **Discover filter × sort matrix** (missed Q16/Q17): don't test filters and sorts in
    isolation. Combine each sort with hide-in-library + hide-on-wishlist, and tag-include
    filters with both hides — watch result COUNTS across pages (a shrinking page = post-slice
    filtering) and check via `read_network_requests` whether provider queries actually carry
    the filter, or results are only ever local-catalog matches dressed up as discovery.
33. **Displayed-math sanity** (missed Q20a): wherever the UI shows a headline number WITH a
    breakdown (Fandex Score "why", stats), check the parts plausibly compose to the whole.
    Parts that visibly don't add up are a finding even if the underlying math is correct.
34. **Distribution sanity, logged-in** (missed Q19): for personalized numbers (Fandex Score),
    eyeball the spread across a real library — a tight clump (e.g. everything 40–60) or a
    misleading center is a product finding even when each individual value is "correct".

## Gotchas learned (2026-07-18 run)

- **The preview browser keeps the httpOnly `rr2_session` cookie across sessions** — check
  auth state FIRST (`fetch('/api/library')` → 200 = logged in, 401 = anon) before assuming
  anon. JS cannot delete an httpOnly cookie; use the nav "Log out" button to go anon (this
  bumps `session_epoch`, so re-mint tokens with the NEW epoch afterwards). Epoch is **3** as
  of 2026-07-18.
- If already logged in, run the logged-in sweep FIRST, then logout → anon (saves a mint).
- `javascript_tool`: no top-level `await` (wrap in `Promise`/`.then`); no repeated
  `const` names across calls (wrap in IIFE); `computer {action:"wait"}` requires `tabId`;
  coordinate clicks need a prior screenshot AND screenshot pixels ≠ viewport pixels.
- Set-Cookie inspection: PS 5.1 `Invoke-WebRequest` hides it on redirects — use
  `curl.exe -s -o NUL -D -`.
- Legacy facet redirect param is **`kind`** (not `type`): `/insights/facet?kind=person&key=…`
  → 308; wrong params fall back to `/insights` (intended).
- **Known 401 noise (SM6)**: anon pages fire authed calls — `/api/detail`, `/api/facet/mine`,
  `POST /api/discover/find` (search then falls back to `GET /api/discover?q=`). Don't re-log.
- `GET /api/watchlist` is 405 (POST/DELETE only); use `/api/library` as the auth probe.
- Wishlist remove leaves the row until reload (SM1) — verify removal via network 200 +
  reload, not the UI.
- View mode is a single global `rr_view_mode` localStorage key (SM2) — toggling Calendar on
  one page changes ALL pages incl. anon Discover; reset to card/list when done.
- Write tests: Steam is read-only; a game wishlist add/remove goes to RAWG (net-zero
  verified safe 2026-07-18). Skip RATING writes — they create real reviews/ratings on the
  user's platform accounts and clearing isn't obviously exposed; note as not-exercised.
- Facet "Highest rated" ranking obscure titles first is SM3 (no vote damping), not a
  provider bug.
- **`navigate` is intermittently denied by the safety classifier** for no reason tied to the
  URL (same URL succeeds on a bare retry seconds later) — don't treat one blocked `navigate`
  as a broken page; just retry once before investigating further. This is separate from the
  cookie-mint block above, which is a hard, consistent block, not intermittent.

## Environment gotchas

- `.env` is loaded by Next dev automatically; JWT_SECRET is set there (don't print it).
- Dev server compiles routes lazily — distinguish "slow first hit" from a real hang.
- CSP is prod-only (dev keeps only frame-ancestors) — don't chase CSP issues locally.
- OMDB key invalid + Letterboxd hidden (memory) — missing RT/IMDb scores on detail pages is a
  KNOWN config gap, not a bug.
- Steam CDN images for delisted games 404 — known noise, not a finding.
