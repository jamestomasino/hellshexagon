# Puzzle Curation (Anchor Model)

## Intent

Generate daily puzzles that are unsolved by default:

- 3 well-known films
- 3 well-known actors
- no immediate one-hop shortcuts on the six connected anchor pairs
- at least one full alternating loop solution within the node budget

## Puzzle shape

Each puzzle stores anchors only:

- `films`: `[F1, F2, F3]`
- `actors`: `[A1, A2, A3]`
- `maxNodes`: node cap for a valid loop (currently `32`)

Players then build:

`F1 -> ... -> A1 -> ... -> F2 -> ... -> A2 -> ... -> F3 -> ... -> A3 -> ... -> F1`

with alternating film/actor nodes and no repeats.

## Catalog + graph

- Canonical local graph: `data/catalog.json`
- Edges in `credits` define film <-> actor adjacency.
- Validation and seed generation are deterministic against this graph.

## Validation command

Run:

`node scripts/validate-puzzles.js`

Checks:

- schema shape and known IDs
- unique anchors
- connected anchor pairs have no direct film-actor edge:
  - `F1-A1`, `A1-F2`, `F2-A2`, `A2-F3`, `F3-A3`, `A3-F1`
- a full alternating loop exists within `<= maxNodes` (capped at 32)

## Candidate generation

Run:

`node scripts/find-seeds.js 10 150000`

Arguments:

- first arg: target number of seeds
- second arg: random attempt count
