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
- Shared server logic: `shared/daily-puzzle.js`
- No mandatory database for V1

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

- No paid dependencies required for core V1 behavior.
- Frontend should work if functions are temporarily unavailable.
- Avoid introducing databases or realtime services in V1 unless explicitly requested.

## Security & Secrets

- No secrets are required for current V1.
- If adding external APIs later, keep keys in Netlify environment variables.

---
Update this file whenever architecture, command flows, or coding conventions change.
