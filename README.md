# Hell's Hexagon

Static-first daily puzzle version of Hell's Hexagon, designed to be deployed on Netlify Free and left alone.

## V1 objective

- One daily puzzle
- No always-on backend
- No paid database dependency
- No realtime multiplayer yet

## Current architecture

- Static frontend: `index.html`, `styles.css`, `app.js`
- Puzzle seed dataset: `data/puzzles.json`
- Curation notes: `data/CURATION.md`
- Daily selection logic: `shared/daily-puzzle.js`
- History/persistence helper: `shared/puzzle-history.js`
- Netlify Function API endpoint: `/api/daily`
- Netlify Function API endpoint: `/api/dates`
- Netlify Scheduled Function: daily `rotate-daily` job
- Netlify Blobs store for daily generated puzzle history

This keeps running costs near zero and avoids long-lived infrastructure.

## Local development

1. Install Netlify CLI if needed:
   - `npm i -g netlify-cli`
2. Run locally:
   - `netlify dev`
3. Open the shown localhost URL.

## Deployment

1. Push this repo to GitHub.
2. Connect repo in Netlify.
3. Deploy with default settings (`publish = .`, functions in `netlify/functions`).

## Daily puzzle behavior

- `/api/daily` returns one puzzle for a date.
- Primary source: Netlify Blobs history (`history/YYYY-MM-DD`).
- Scheduled generator writes today's puzzle to Blobs each day.
- If Blobs is unavailable or the date is missing, API falls back to deterministic seed selection from `data/puzzles.json`.
- Frontend falls back to local `data/puzzles.json` if the function is unavailable.
- `/api/dates` returns generated historical dates for date-picker UI.
- Puzzle records are unsolved anchor sets:
  - 3 films (`F1, F2, F3`) and 3 actors (`A1, A2, A3`)
  - players build the alternating hex loop themselves
  - connected anchor pairs cannot be direct one-hop film-actor links
  - validator guarantees at least one loop solution in `<= 32` total nodes

## Scheduled function

- `netlify/functions/rotate-daily.js`
- Schedule: `@daily`
- Current behavior: ensures today's puzzle is stored in Blobs and appends date index.

This is intentionally lightweight for V1. Later we can make this job publish richer metadata or trigger notifications.

## Next V1 build steps

1. Expand `data/puzzles.json` with a larger curated seed set.
2. Add client-side ring-entry UI (film/actor entry and validation).
3. Add local scoring and shareable result strings.
4. Add optional TMDb-backed helper search behind a function, with hard usage caps.

## Dataset validation

- `node scripts/validate-puzzles.js`

## Original long-term direction (deferred)

Multiplayer rooms, realtime collaboration, and persistent storage are deferred to post-V1 to keep this release free and maintenance-light.
