# Hell's Hexagon

Static-first daily puzzle app, deployed on Netlify with zero always-on backend.

## V1 objective

- One puzzle per UTC day
- No paid database dependency
- No realtime multiplayer yet

## Architecture

- Frontend: `index.html`, `styles.css`, `app.js`
- Scene textures: baked PNG assets in `assets/textures/*` (default render path)
- Seed dataset: `data/puzzles.json`
- Deterministic daily selector: `shared/daily-puzzle.js`
- Puzzle history persistence (Neon): `shared/puzzle-history.js`
- Leaderboard + first-success persistence (Neon): `shared/scoreboard-store.js`
- Functions:
  - `netlify/functions/daily-puzzle.js`
  - `netlify/functions/puzzle-dates.js`
  - `netlify/functions/rotate-daily.js` (scheduled)
  - `netlify/functions/scoreboard.js`
  - `netlify/functions/submit-score.js`
- Netlify config + rewrites: `netlify.toml`

## API surface

Netlify rewrites hide raw function paths:

- `/api/daily` -> `/.netlify/functions/daily-puzzle`
- `/api/dates` -> `/.netlify/functions/puzzle-dates`
- `/api/rotate` -> `/.netlify/functions/rotate-daily` (mostly for local/debug)
- `/api/search` -> `/.netlify/functions/search-entities`
- `/api/check-edge` -> `/.netlify/functions/check-edge`
- `/api/scoreboard` -> `/.netlify/functions/scoreboard`
- `/api/submit-score` -> `/.netlify/functions/submit-score`

## Daily puzzle behavior

- `/api/daily?date=YYYY-MM-DD` returns one puzzle payload.
- Source of truth is Neon/Postgres history table (`hh_daily_puzzle`).
- Scheduled rotate job ensures the current UTC day's puzzle exists in history.
- New generation avoids reusing any exact film or actor IDs when possible.
- If the dataset is exhausted, generation falls back to the least-overlap puzzle for that day.
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
   - `NETLIFY_DATABASE_URL` (preferred Neon/Postgres connection string)
   - `DATABASE_URL` (fallback Neon/Postgres connection string)
   - `TMDB_TOKEN` (server-side bearer token for TMDB cache misses)
3. Scheduled function config is in `netlify.toml`:
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
- Three.js scene uses baked textures by default and automatically falls back to procedural textures if baked assets fail to load.

## Validate dataset

- `node scripts/validate-puzzles.js`

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

## Scoring + leaderboard API

Current implementation:

- User builds chains and clicks **Check puzzle** to validate edges.
- A solved puzzle requires:
  - All edges valid.
  - Total nodes `<= 36`.
- On successful solve, client submits:
  - `date`
  - anonymous UID (`anonUid`, stored in localStorage + cookie)
  - `totalNodes`
  - `totalLinks`
- Server counts only the **first successful solve per anon UID per day**:
  - uniqueness key: `(puzzle_date, anon_uid)`
- Leaderboard endpoint (`GET /api/scoreboard?date=YYYY-MM-DD`) returns:
  - `solves`
  - `shortestChain`
  - `histogram` of solve node counts
- Submit endpoint (`POST /api/submit-score`) returns:
  - `accepted: true` when first success for that anon UID/day
  - `accepted: false` when already counted

Reliability notes:

- `submit-score` includes in-memory rate limits (per-UID and per-IP windows).
- Client retries submit on transient failures with short backoff.
- Leaderboard panel handles offline/failure states gracefully.
