# Catalog Pipeline (Local Experiment)

This document describes the local ETL flow for building a large puzzle catalog (films, actors, credits) to replace small hand-curated `catalog.json`.

## Goals

- Build a candidate universe of **3,000-10,000 well-known films**.
- Build actor pool from those films and compute **film density score**.
- Keep puzzle generation viable for progressive weekday difficulty.
- Keep source data off public web routes in production packaging.

## Proposed Source Inputs

Use local source files in `tmp/sources/` (downloaded separately):

- `tmdb_movies.jsonl`
  - one movie per line
  - expected fields: `id,title,release_date,popularity,vote_count,revenue,original_language,origin_country`
- `tmdb_people.jsonl`
  - one person per line
  - expected fields: `id,name,popularity`
- `tmdb_credits.jsonl`
  - one credit edge per line
  - expected fields: `movie_id,person_id,department,job,order`

Optional augment inputs:

- IMDb datasets (`title.basics`, `title.ratings`, `title.principals`) mapped by external IDs.

## Scoring Model

## Film knownness score

Film knownness is a weighted score (0-1):

- `vote_count_norm` (log-normalized): 0.40
- `popularity_norm`: 0.25
- `revenue_norm` (log-normalized): 0.20
- `recency_norm` (mild penalty for very old unless highly voted): 0.15

Additional hard filters:

- release year >= 1970 (configurable)
- language preference `en` (or bilingual list)
- country preference includes `US` when available
- minimum vote count floor

## Actor film density score

From filtered film universe:

- `film_density = count(distinct selected films where actor appears)`
- weighted density with cast order:
  - lead/top cast credits weighted higher
  - cameos/background lower

Actor score (0-1) blend:

- density_norm: 0.75
- actor_popularity_norm: 0.25

## Output Files

Generated files in `tmp/output/`:

- `film_candidates.json` (filtered + scored + ranked)
- `actor_candidates.json` (scored + ranked)
- `catalog.generated.json` with shape:
  - `films`: `[{ id, title, year, popularity, vote_count, revenue, knownness }]`
  - `actors`: `[{ id, name, popularity, film_density, actor_score }]`
  - `credits`: `[[filmId, actorId], ...]`

## Weekday Difficulty Profiles

Monday easiest -> Sunday hardest should be controlled by:

- solve node window (`minSolveNodes`, `maxSolveNodes`)
- knownness percentile band (high knownness early week, lower knownness late week)

Important: On tiny catalogs, strict filters collapse the pool.
Use adaptive relaxation passes in experiments to guarantee candidate output.

## Commands (local)

Build film candidates:

`node scripts/catalog/build-film-candidates.js --in tmp/sources/tmdb_movies.jsonl --out tmp/output/film_candidates.json --limit 5000`

Build actor candidates:

`node scripts/catalog/build-actor-candidates.js --films tmp/output/film_candidates.json --people tmp/sources/tmdb_people.jsonl --credits tmp/sources/tmdb_credits.jsonl --out tmp/output/actor_candidates.json --limit 20000`

Build catalog graph payload:

`node scripts/catalog/build-catalog-graph.js --films tmp/output/film_candidates.json --actors tmp/output/actor_candidates.json --credits tmp/sources/tmdb_credits.jsonl --out tmp/output/catalog.generated.json`

Run weekday generation experiment:

`node scripts/experiment-daily-generator.js 2026-04-05 5000 10 8`

## Production Packaging Note

When ready to switch production:

- Store final catalog at a non-public path (e.g. `server-data/catalog.json`).
- Ensure function bundling includes it via `netlify.toml` `included_files`.
- Keep static publish routing from exposing raw source dumps.
