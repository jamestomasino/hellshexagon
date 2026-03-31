# Hell's Hexagon

Static-first daily puzzle app, deployed on Netlify with zero always-on backend.

## V1 objective

- One puzzle per UTC day
- No paid database dependency
- No realtime multiplayer yet

## Architecture

- Frontend: `index.html`, `styles.css`, `app.js`
- Seed dataset: `data/puzzles.json`
- Deterministic daily selector: `shared/daily-puzzle.js`
- Puzzle history persistence (Neon-first, Blobs fallback/backfill): `shared/puzzle-history.js`
- Functions:
  - `netlify/functions/daily-puzzle.js`
  - `netlify/functions/puzzle-dates.js`
  - `netlify/functions/rotate-daily.js` (scheduled)
- Netlify config + rewrites: `netlify.toml`

## API surface

Netlify rewrites hide raw function paths:

- `/api/daily` -> `/.netlify/functions/daily-puzzle`
- `/api/dates` -> `/.netlify/functions/puzzle-dates`
- `/api/rotate` -> `/.netlify/functions/rotate-daily` (mostly for local/debug)
- `/api/search` -> `/.netlify/functions/search-entities`
- `/api/check-edge` -> `/.netlify/functions/check-edge`

## Daily puzzle behavior

- `/api/daily?date=YYYY-MM-DD` returns one puzzle payload.
- Primary source is Neon/Postgres history table (`hh_daily_puzzle`) when `DATABASE_URL` is set.
- If Neon is empty and Blobs history exists, history backfills from Blobs on first access.
- Without Neon, Blobs remains the fallback persistence backend.
- Scheduled rotate job ensures the current UTC day's puzzle exists in history.
- New generation avoids reusing any exact film or actor IDs when possible.
- If the dataset is exhausted, generation falls back to the least-overlap puzzle for that day.
- If Blobs is unavailable, function falls back to deterministic selection from `data/puzzles.json`.
- `/api/dates` returns the set of available historical dates for the date-picker.
- Frontend defaults to today's puzzle and supports loading prior dates.

## Puzzle record format

Each daily record is an unsolved anchor set:

- 3 films (`F1, F2, F3`)
- 3 actors (`A1, A2, A3`)
- Player builds the alternating film/actor loop
- Adjacent anchors cannot be direct one-hop film-actor links
- Validator guarantees at least one loop solution within `<= 32` total nodes

## Netlify setup

1. Connect the repo and deploy normally (`publish = .`).
2. Configure Neon and env vars:
   - `DATABASE_URL` (Neon/Postgres connection string)
   - `TMDB_TOKEN` (server-side bearer token for TMDB cache misses)
3. Configure env vars as needed:
   - `NETLIFY_BLOBS_TOKEN` (optional; only needed when using Blobs fallback or one-time backfill)
   - `PUZZLE_STORE_NAME` (optional; Blobs fallback store name, default: `hells-hexagon-puzzles`)
4. Scheduled function config is in `netlify.toml`:
   - `[functions."rotate-daily"]`
   - `schedule = "@daily"`

## Local development

1. Install dependencies:
   - `npm install`
2. Run Netlify dev:
   - `netlify dev`
3. Open `http://localhost:8888`

Notes:

- Scheduled functions are cron-first. Invoking via HTTP in local dev is only for testing behavior.
- Local fallback source in logs (`dataset-fallback-no-blobs`) means Blobs context/token was not available.

## Validate dataset

- `node scripts/validate-puzzles.js`

## Usage index helper

Rebuild the accumulated usage index from existing history entries:

- `SITE_ID=<site-id> NETLIFY_BLOBS_TOKEN=<token> node scripts/rebuild-usage-index.js`

This is useful if you migrated stores or want to recover `history/usage` without re-rotating days.
The scheduled daily rotation also performs automatic catch-up if `history/usage` is missing or stale.

## Deferred direction

Realtime multiplayer and persistent player progression are intentionally deferred post-V1 to keep operations simple.

## TMDB cache API (Neon-backed)

Shared server-side cache is implemented via Postgres so one user's search/check can benefit the next:

- Search entities:
  - `GET /api/search?kind=actor&q=tom+hanks`
  - `GET /api/search?kind=film&q=apollo+13`
- Edge check (lazy validation cache):
  - `GET /api/check-edge?actorId=31&filmId=568`
  - `POST /api/check-edge` with JSON body `{ "actorId": 31, "filmId": 568 }`

Cache tables are auto-created on first use by Netlify functions:

- `tmdb_actor`
- `tmdb_film`
- `tmdb_search_cache`
- `tmdb_edge_check`

## Future scoring notes

Planned for a later phase (not in current implementation):

- Validate submitted chains strictly as alternating links (`actor -> film -> actor -> ...`).
- Score solves by total node count in the submitted chain.
- Current expected max node count is `36`.
- No user accounts; collect anonymous aggregate solve data only.

Potential leaderboard/stat paths:

- Track per puzzle:
  - successful solve count
  - shortest chain
  - average chain length
- Or store all solve lengths and render a small histogram/high-score distribution per puzzle.
- Optional persistence candidate: Neon database, once backend analytics are in scope.
