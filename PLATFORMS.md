# Platform Evaluation & Capability Reference

Living reference for every external platform Fandex integrates with or has
considered: what each can do, and its current status. One table, expand as new
platforms are assessed.

> Current-state rows are authoritative from code (`src/lib/sources/catalog.ts`,
> `types.ts`, `constants.ts`). Candidate rows are evaluations against the current
> API landscape (last updated 2026-07-14).

## Two roles a platform can play

- **Connectable** — user authenticates and we sync both ways (pull wishlist/library, push ratings, status, wishlist add/remove). Backed by a `MediaSource` adapter.
- **Metadata / database provider** — read-only catalog, scores, and enrichment. No per-user write-back.

A platform can be both. A capability is only claimed when the matching adapter method exists; consumers check capabilities declaratively.

## Status legend

`Implemented` live · `Hidden` built but hidden in UI · `To do` chosen for integration · `To evaluate` candidate, not decided · `Rejected` ruled out

## All platforms

Capabilities: **R** read, **W** write, blank = not supported. Rating column for
metadata providers means score read only. **`*`** marks a capability the platform
has in its data model but that is not reachable through a supported official API
(unofficial scraper, closed, or no API — see Notes).

| Platform | Media | Role | Status | Auth | Wishlist | Library | Rating | Review | Status W | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Trakt.tv | movie, show | Connectable | Implemented | oauth | R/W | R | R/W | | yes | Rating and watched history are separate. |
| Steam | game | Connectable | Implemented | openid | R | R | | | | Read-only; wishlist pull only. |
| RAWG | game | Connectable | Implemented | credentials | R/W | R | R/W | | yes | No review text. |
| TMDB | movie, show | Connectable | Implemented | oauth | R/W | R | R/W | | | No watched concept; library = rated items. |
| Letterboxd | movie | Connectable | Hidden | oauth | R/W | R | R/W | R | yes | Hidden until a working API key exists. |
| IGDB | game | Metadata | Implemented | | | | R | | | Games catalog + community/critic scores. |
| IMDb | movie, show | Metadata | Implemented ⚠️ | | | | R | | | Rating via OMDB — **inherits the OMDB key gap below** (no scores in prod today). |
| Rotten Tomatoes | movie, show | Metadata | Implemented ⚠️ | | | | R | | | Critic score, also sourced from OMDB (`Ratings[Source="Rotten Tomatoes"]`) — **inherits the OMDB key gap below**. |
| Metacritic | movie, show, game | Metadata | Implemented | | | | R | | | Critic score. |
| OMDB | movie, show | Metadata | Implemented ⚠️ | apikey | | | R | | | Feeds IMDb rating, box office, awards. **⚠️ Config, not code: the `OMDB_API_KEY` is currently invalid, so no IMDb/RT scores actually land in prod.** Check this before debugging a missing rating. |
| Hardcover | book (+ audiobook format) | Connectable + Metadata | To do | token (OAuth TBC) | R/W | R | R/W | R/W | yes | Best books connector; modern free GraphQL API. Doubles as books database provider. Risk: multi-user auth flow unconfirmed (see deep dive). |
| Open Library | book | Metadata (+ light write) | To do | account | R/W | R | | | partial | Free open catalog + covers; primary books metadata source. |
| AniList | anime, manga | Connectable + Metadata | To do | oauth | R/W | R | R/W | R | yes | Full write mutations; extends the show model. |
| Google Books | book | Metadata | To evaluate | apikey / oauth | W | R | | | | Bookshelf write is dated; secondary metadata only. |
| StoryGraph | book | Connectable | To evaluate | | | | | | | No official API; only a fragile unofficial cookie scraper. |
| MyAnimeList | anime, manga | Connectable | To evaluate | oauth | R/W | R | R/W | | yes | Alternative / secondary id source to AniList. |
| MusicBrainz / Discogs | music | Metadata | To evaluate | | | | | | | Album catalog for a future music type. |
| Spotify / Last.fm | music | Connectable | To evaluate | oauth | | R | | | | User listening data; weak wishlist/rating semantics. |
| Podcast Index / Listen Notes | podcast | Metadata | To evaluate | apikey | | | | | | Podcast catalog; little standard write-back. |
| BoardGameGeek | board game | Metadata (read-only) | To evaluate | token (July 2025) | R public | R public | R | | | XML API2 is read-only (no write-back); collection is async + throttled; opens board games as a new type. See deep dive. |
| Backloggd | game | Connectable (read) / Metadata | To evaluate | none (scrape) | R* | R* | R* | R* | | Unofficial scraper only (public profiles). Built on IGDB ids → a Backloggd wishlist merges/dedupes cleanly with RAWG. Value = merging a user's Backloggd + RAWG wishlists. Blocker is access method, not data. See deep dive. |
| Goodreads | book | Connectable | Rejected | oauth (closed) | R/W* | R* | R/W* | R/W* | yes* | Full API existed but closed to new keys since Dec 2020, never reopened. Capabilities unreachable. |
| Audible / Libro.fm | audiobook | Connectable | Rejected | none (no public API) | R/W* | R* | R/W* | | yes* | No public API (only unofficial/reverse-engineered clients). Model audiobooks as a book format instead. |

## Key finding: audiobooks are a format, not a platform

Hardcover, Open Library, and Literal all model an audiobook as an edition of the
same book with a format flag. Adding a `book` media type plus a format facet
(ebook / physical / audiobook) covers audiobooks with no separate integration.
Do not build Audible/Libro.fm connectors.

## Priority

1. **Books** — Hardcover (connectable) + Open Library (metadata). Biggest gap, cleanest write API, includes audiobooks as a format.
2. **Anime / manga** — AniList. Low-friction extension of the show model.
3. **Later phase** — music, podcasts, board games.

## Adding a connectable platform

The registry pattern means: implement the `MediaSource` contract, add a `CATALOG`
entry declaring its capabilities, register it in `registry.ts`. No per-provider
`if` branches elsewhere.

1. Add the `SourceMeta` entry to `CATALOG` (label, color, media types, auth, capabilities).
2. Implement an adapter under `src/lib/sources/adapters/`, covering only the methods its capabilities claim.
3. Register it in `SOURCES` in `registry.ts`.
4. Add auth routes and token handling for its auth model.
5. Handle ID resolution (cross-ref via TMDB/ISBN where possible, else search).

## Deep dives (2026-07-14)

Detailed evaluations for platforms where the one-line table row hides an
important caveat.

### Hardcover — verdict: integrate, gate on auth

GraphQL (Hasura) endpoint at `api.hardcover.app/v1/graphql`. Full read/write:
`me { user_books }` filtered by `status_id` (1 want-to-read, 2 reading, 3 read,
5 DNF) gives wishlist + library in one model; ratings, reviews (`review_raw`),
and custom lists are readable; writes go through mutations like `insert_user_book`
and `insert_list_book`, and per the maintainer anything the UI can do is
available (rating + status writes included). Rich metadata (contributors, tags,
series, covers) means it can also be the books database provider.

Two risks before committing:
- **Auth for multi-user.** Documented access is a personal Bearer API key from
  account settings. Whether Hardcover offers a proper third-party OAuth app flow
  is **unconfirmed (<60% confidence)**. If it does not, each user must paste their
  own token — poor onboarding. Verify this first.
- **Stability.** Still self-described as early-access; schema shifts (they already
  removed `_eq` title search for performance). Rate limiting is informal: space
  writes to ~1/sec, concurrent writes to one list error.

### BoardGameGeek — verdict: metadata/read-only only

Official access is XML API2 (`boardgamegeek.com/xmlapi2/`). As of **July 2, 2025**
the XML APIs require registration/authorization and an API token. It is a read
API (things, collection, plays, hot items, geeklists, search) with **no official
write path** for ratings or collection changes. Reading a private collection
needs authentication as that user, and there is no clean OAuth (the frontend uses
a username/password login endpoint + cookie). The collection endpoint is async
(returns 202 "queued", must poll) and the whole API is aggressively throttled.

Value is real but narrow: it opens **board games** as a new media type (nothing
else covers them) with an excellent catalog (ranks, weights, player-count polls,
a CSV ranks dump), but only as read-only public data. Pursue only if board games
are wanted as a category; do not expect write-back.

### Backloggd — verdict: to evaluate (blocked on access method)

No official public API — only an unofficial community scraper working on public
profiles. So there is no OAuth and no write-back, and scraping is fragile plus
ToS-risky.

The reason it stays on the table: **wishlist merging.** Backloggd is built on
**IGDB**, and we already key games on IGDB ids, so a user's Backloggd wishlist
would dedupe and merge cleanly with their RAWG wishlist at the id level with no
extra matching work. If the goal is a single combined game wishlist across
sources, Backloggd read access adds real value. The blocker is purely the access
method (scrape vs official API), not data compatibility.

Open questions before committing:
- Does Backloggd expose a user's wishlist on a public profile (scrapeable), or is
  it private/behind login? Confirm the wishlist specifically is readable.
- Are we willing to depend on an unofficial scraper (breakage + ToS risk), or wait
  for an official API? Their dev team is active but has announced none.

Note it adds no *metadata* we lack (IGDB already covers that) and overlaps the
video-game space Steam and RAWG already handle. The unique value is the user's
Backloggd wishlist/logs, nothing else.
