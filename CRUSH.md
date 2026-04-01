# CRUSH.md: Hells Hexagon Agentic Guide

## Build, Lint, and Test Commands

- **Install tools (optional):**
  - `npm i -g netlify-cli`
- **Run local dev (site + functions):**
  - `netlify dev`
- **Run one-off function test in Node:**
  - `node -e "const fn=require('./netlify/functions/daily-puzzle').handler; fn({queryStringParameters:{date:'2026-03-29'}}).then(r=>console.log(r.body))"`
- **Static preview without functions:**
  - `python -m http.server 8080`

## Stack Summary

- Static frontend: plain HTML/CSS/JS
- Three.js board rendering uses baked textures from `assets/textures/` by default, with automatic procedural fallback if asset loads fail.
- Netlify Functions: `netlify/functions/*.js`
- Daily puzzle catalog: `server-data/catalog.json`
- Shared server logic: `shared/daily-puzzle.js`, `shared/puzzle-history.js`, `shared/scoreboard-store.js`
- Neon/Postgres is required for persisted daily history, TMDB cache, and leaderboard scoring.

## Formatting & Code Style

- Use plain JavaScript (Node/CommonJS) for Netlify functions.
- Use single quotes and no semicolons in JS files.
- Keep browser code framework-free unless migration is intentional.
- Prefer small, readable modules over large utility files.
- Keep generation catalog data in `server-data/` (private function-only path).

## API & Function Conventions

- Public endpoint redirects live in `netlify.toml`.
- Function names map directly to `/.netlify/functions/<name>`.
- Scheduled jobs use `exports.config = { schedule: '@daily' }`.
- Always return JSON with explicit `statusCode`.

## Reliability Constraints

- Core behavior expects Neon to be configured (`NETLIFY_DATABASE_URL` preferred).
- Frontend should work if functions are temporarily unavailable.
- Keep fallback UX clear when API calls fail (toasts/status text).

## Planned Work (Do Not Implement Yet)

- Manual future puzzle preset workflow:
  - We will add an admin/manual way to set a puzzle for a future date.
  - Even if a future date has a pre-set puzzle in storage, the date picker must not show dates later than server-calculated "today".
  - `rotate-daily` must not overwrite a manually pre-set puzzle when that date arrives.
  - Difficulty handling must be defined for manual presets:
    - whether to trust stored/manual difficulty metadata
    - or to recompute difficulty from puzzle anchors at read/rotate time
    - and how this affects leaderboard/display consistency.

## Security & Secrets

- Required env vars:
  - `NETLIFY_DATABASE_URL` (or `DATABASE_URL`) for Neon access
  - `TMDB_TOKEN` for TMDB API fallback/cache misses
- Keep all credentials in Netlify environment variables.

## Scoring Rules (Current)

- Validation occurs only when the player clicks `Check puzzle`.
- A win requires all actor-film edges valid and no duplicate middle-node violations.
- Successful score submissions are first-success only per `(puzzle_date, anon_uid)`.
- Public stats shown per puzzle date:
  - shortest chain
  - solve count
  - solve histogram

---
Update this file whenever architecture, command flows, or coding conventions change.
