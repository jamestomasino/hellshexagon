# Hell's Hexagon

Daily movie-connection puzzle built as a static-first web app on Netlify.

Players connect six anchor tiles (3 actors + 3 films) into a full alternating loop by inserting actor/film steps between adjacent anchors.

## What The App Does

- Serves one puzzle per UTC day.
- Lets users play today's puzzle or browse prior puzzle dates.
- Uses TMDB-backed search to fill connection cards in-place.
- Validates links only when user clicks **Check puzzle**.
- Scores by total **steps** (node count) with a win condition of all links valid and `steps <= 36`.
- Stores first successful solve per anonymous user per day.
- Shows per-day leaderboard stats:
  - shortest chain
  - solve count
  - solve-length histogram

## User Flow

1. Load puzzle for selected date.
2. Click two adjacent hex tiles to open that segment editor.
3. Add alternating actor/film cards and pick TMDB results.
4. Repeat around all six adjacent pairings.
5. Click **Check puzzle**.
6. Review segment-by-segment validation and total steps.
7. If successful, submit first success for that day to leaderboard.

## Tech Stack

- Frontend: plain `HTML/CSS/JS` (`index.html`, `styles.css`, `app.js`)
- 3D board: local Three.js ESM bundle (`assets/vendor/three.module.min.js`)
- Server: Netlify Functions (`netlify/functions/*.js`)
- Database: Neon Postgres via `@netlify/neon`
- External data: TMDB API (server-side)

## Persistence & Data Model

Tables created/used by functions:

- `hh_daily_puzzle`
  - Daily puzzle history (date -> puzzle payload)
- `tmdb_actor`
- `tmdb_film`
- `tmdb_search_cache`
- `tmdb_edge_check`
  - TMDB search/edge cache tables
- `hh_daily_solve_score`
  - First-success score records (`UNIQUE (puzzle_date, anon_uid)`)

Seed/source files:

- `data/puzzles.json` (anchor puzzle dataset)
- `data/catalog.json` (supporting catalog data)

## API Endpoints

Public routes (via `netlify.toml` redirects):

- `GET /api/daily?date=YYYY-MM-DD`
- `GET /api/dates`
- `GET /api/search?kind=actor|film&q=...`
- `GET|POST /api/check-edge`
- `POST /api/check-chain`
- `GET /api/scoreboard?date=YYYY-MM-DD`
- `POST /api/submit-score`
- `GET /api/rotate` (debug/local trigger for rotate function)

## Scoring Rules

- Validation is deferred until **Check puzzle**.
- Every adjacent actor-film edge in each segment must be valid in TMDB.
- Duplicate middle-node selections are invalid:
  - duplicate actors/films across inserted nodes
  - duplicates of anchor actors/films
- Win condition:
  - all links valid
  - no duplicate-node violations
  - total steps `<= 36`
- Leaderboard counts only first successful solve per `(date, anon_uid)`.

## Local Development

Prerequisites:

- Node 18+
- Netlify CLI

Setup:

1. `npm install`
2. `netlify dev`
3. Open `http://localhost:8888`

Run tests:

- `npm test`

## Required Environment Variables

- `NETLIFY_DATABASE_URL` (preferred)
- `DATABASE_URL` (fallback)
- `TMDB_TOKEN`

## Performance & Caching

- Three.js served from local minified vendor file.
- Baked textures in `assets/textures/*` are default render path.
- Automatic procedural texture fallback if baked assets fail to load.
- Static cache headers configured in `/_headers`:
  - HTML: revalidate
  - app/css: short-lived cache
  - `/assets/*`: long-lived immutable cache

## Repository Layout

- `app.js` - main client logic and 3D scene
- `styles.css` - main UI styles
- `instructions.html`, `instructions.css` - how-to-play page
- `netlify/functions/` - API handlers
- `shared/` - shared server logic
- `tests/` - node test suite
- `assets/` - textures, fonts, images, vendor JS

## Operational Notes

- `rotate-daily` is scheduled (`@daily`) to ensure current-day puzzle exists in DB.
- App degrades gracefully when individual API calls fail (toasts/status messages).
- Score submission uses retries + rate limiting.
