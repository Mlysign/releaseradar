# Fandex

Track upcoming **games, movies, and shows** in one release calendar, synced from your
connected accounts (Trakt, TMDB, Steam, RAWG) with a personalized discover feed, taste-based
recommendations, and an insights view.

## Stack

- **Next.js 16** (App Router) + **React 19**, TypeScript, Tailwind CSS v4
- **SQLite** via `better-sqlite3` (single-file DB, WAL) — see *Hosting model* below
- Auth: JWT sessions (`jose`) over an httpOnly cookie; OAuth/OpenID per provider
- Tests: Vitest (`npm test`)

## Local development

```bash
npm install
cp .env.example .env   # then fill in the values (see table below)
npm run dev            # http://localhost:3000
```

`npm test` runs the suite. `npm run build` produces the production build.

## Environment variables

| Variable | Required | Purpose |
|---|:--:|---|
| `JWT_SECRET` | ✅ (prod) | Session signing. Generate: `openssl rand -hex 32`. **The server refuses to start in production without it.** |
| `TMDB_API_KEY` | ✅ | Movies & TV (core data source) |
| `RAWG_API_KEY` | ✅ | Games (core data source) |
| `NEXT_PUBLIC_BASE_URL` | ✅ | Public origin, no trailing slash (e.g. `https://app.example.com`) — used for OAuth redirects |
| `DB_PATH` | — | SQLite file path. Defaults to `./data/rr.db`; **set to the mounted volume in production** (e.g. `/app/data/rr.db`) |
| `STEAM_API_KEY` | ⬚ | Steam integration |
| `TRAKT_CLIENT_ID` / `TRAKT_CLIENT_SECRET` / `TRAKT_REDIRECT_URI` | ⬚ | Trakt integration |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | ⬚ | IGDB game metadata (skipped if unset) |
| `OMDB_API_KEY` | ⬚ | Rotten Tomatoes / IMDb scores |

Required vars are validated once at boot ([`src/lib/config.ts`](src/lib/config.ts) via
[`src/instrumentation.ts`](src/instrumentation.ts)) — a missing one fails fast in production with a
list of what's missing.

## Hosting model

`better-sqlite3` is a synchronous, in-process, single-file database. The app therefore runs as
**one always-on Node process with a persistent disk** — *not* serverless and *not* multi-instance.
The chosen target is a **single-instance container on [Railway](https://railway.app)** with a mounted
volume for the DB. (See `docs/archive/history.md` for the full rationale.)

## Deploy to Railway

The repo ships a multi-stage [`Dockerfile`](Dockerfile) that builds Next's `standalone` output and
runs it as a non-root user. Railway auto-detects and builds it.

1. **Push to GitHub** (Railway deploys from the repo).
2. **New Project → Deploy from GitHub repo** → select this repo. Railway detects the `Dockerfile`.
3. **Add a Volume** and mount it at **`/app/data`**. ⚠️ Without this, the DB resets on every deploy.
4. **Set environment variables** (table above). At minimum: `JWT_SECRET`, `TMDB_API_KEY`,
   `RAWG_API_KEY`, `NEXT_PUBLIC_BASE_URL`, and `DB_PATH=/app/data/rr.db`. Plus any provider keys you use.
5. Pick the **EU (Amsterdam)** region if available (data residency / latency).
6. Deploy. The container serves on `$PORT` (Railway sets it; the standalone server honors it).
7. **Custom domain:** add it in Railway, then create the shown **CNAME** at your domain's DNS.
   Railway provisions HTTPS automatically.
8. **OAuth redirect URIs:** in each provider's app settings, register the **production** callback URLs
   (Trakt callback, TMDB, Steam return/realm, Letterboxd). Set `TRAKT_REDIRECT_URI` +
   `NEXT_PUBLIC_BASE_URL` to the production origin. (The `localhost` defaults won't work in prod.)

### Migrating existing data

To carry over an existing local `data/rr.db` (library, wishlist, ratings), copy it into the Railway
volume once via the Railway CLI (`railway run` / volume upload). Otherwise the instance starts empty
and rebuilds from your connected accounts on first sync.

### Backups (recommended before relying on it)

The Railway volume is a single copy. Set up **[Litestream](https://litestream.io)** to continuously
replicate `rr.db` to S3-compatible object storage (Cloudflare R2 / Backblaze B2) with auto-restore on a
fresh container, and test a restore. Tracked as **P5** in `TASKS.md`.

## Project docs

- `STATUS.md` — short human-readable digest of live state + next actions (read this first)
- `TASKS.md` — execution tracker (source of truth) for what's still open, incl. a one-paragraph summary of the (all-resolved) audit/review findings
- `docs/archive/history.md` — everything finished: completed phases, resolved audit findings, closed bugs/QA findings (moved out of the working set 2026-07-18 to keep the active docs short — grep it, don't read it end to end)
- `PLATFORMS.md` — platform integration capability reference
- `AGENTS.md` — contributor/agent notes: this Next.js version has breaking changes (read the bundled docs), the project doc map, load-bearing data-model invariants, and model/agent-routing guidance
