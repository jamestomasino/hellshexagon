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
- Netlify Functions: `netlify/functions/*.js`
- Daily puzzle data: `data/puzzles.json`
- Shared server logic: `shared/daily-puzzle.js`, `shared/puzzle-history.js`, `shared/scoreboard-store.js`
- Neon/Postgres is required for persisted daily history, TMDB cache, and leaderboard scoring.

## Formatting & Code Style

- Use plain JavaScript (Node/CommonJS) for Netlify functions.
- Use single quotes and no semicolons in JS files.
- Keep browser code framework-free unless migration is intentional.
- Prefer small, readable modules over large utility files.
- Keep all durable game data as JSON files in `data/` for V1.

## API & Function Conventions

- Public endpoint redirects live in `netlify.toml`.
- Function names map directly to `/.netlify/functions/<name>`.
- Scheduled jobs use `exports.config = { schedule: '@daily' }`.
- Always return JSON with explicit `statusCode`.

## Reliability Constraints

- Core behavior expects Neon to be configured (`NETLIFY_DATABASE_URL` preferred).
- Frontend should work if functions are temporarily unavailable.
- Keep fallback UX clear when API calls fail (toasts/status text).

## Security & Secrets

- Required env vars:
  - `NETLIFY_DATABASE_URL` (or `DATABASE_URL`) for Neon access
  - `TMDB_TOKEN` for TMDB API fallback/cache misses
- Keep all credentials in Netlify environment variables.

## Scoring Rules (Current)

- Validation occurs only when the player clicks `Check puzzle`.
- A win requires all actor-film edges valid and total node count `<= 36`.
- Successful score submissions are first-success only per `(puzzle_date, anon_uid)`.
- Public stats shown per puzzle date:
  - shortest chain
  - solve count
  - solve histogram

---
Update this file whenever architecture, command flows, or coding conventions change.
