#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

function parseArgs(argv) {
  const out = {
    filmsFile: null,
    actorsFile: null,
    creditsFile: null,
    outFile: path.join(process.cwd(), 'tmp', 'output', 'catalog.generated.json'),
    maxCreditsPerFilm: 20,
  }

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--films') out.filmsFile = argv[++i]
    else if (a === '--actors') out.actorsFile = argv[++i]
    else if (a === '--credits') out.creditsFile = argv[++i]
    else if (a === '--out') out.outFile = argv[++i]
    else if (a === '--max-credits-per-film') out.maxCreditsPerFilm = Number(argv[++i])
    else if (a === '--help') out.help = true
  }

  return out
}

function printHelp() {
  console.log('Usage: node scripts/catalog/build-catalog-graph.js --films <film_candidates.json> --actors <actor_candidates.json> --credits <tmdb_credits.jsonl> [--out <file>] [--max-credits-per-film 20]')
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readJsonLines(file) {
  const raw = fs.readFileSync(file, 'utf8')
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines.map((line, idx) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid JSON on line ${idx + 1}: ${error.message}`)
    }
  })
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.filmsFile || !args.actorsFile || !args.creditsFile) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }

  const films = readJsonFile(args.filmsFile)
  const actors = readJsonFile(args.actorsFile)
  const credits = readJsonLines(args.creditsFile)

  const filmSet = new Set(films.map((f) => Number(f.id)).filter((id) => Number.isInteger(id) && id > 0))
  const actorSet = new Set(actors.map((a) => Number(a.id)).filter((id) => Number.isInteger(id) && id > 0))

  const perFilmCount = new Map()
  const edgeSet = new Set()
  const edges = []

  for (const c of credits) {
    const filmId = Number(c.movie_id || c.film_id || c.id_movie)
    const actorId = Number(c.person_id || c.actor_id || c.id_person)
    if (!filmSet.has(filmId) || !actorSet.has(actorId)) continue

    const dept = String(c.department || '').toLowerCase()
    if (dept && dept !== 'acting') continue

    const count = perFilmCount.get(filmId) || 0
    if (count >= args.maxCreditsPerFilm) continue

    const edgeKey = `${filmId}:${actorId}`
    if (edgeSet.has(edgeKey)) continue

    edgeSet.add(edgeKey)
    perFilmCount.set(filmId, count + 1)
    edges.push([filmId, actorId])
  }

  const out = {
    films: films.map((f) => ({
      id: Number(f.id),
      title: f.title,
      year: Number(f.year),
      popularity: f.popularity == null ? null : Number(f.popularity),
      vote_count: f.vote_count == null ? null : Number(f.vote_count),
      revenue: f.revenue == null ? null : Number(f.revenue),
      knownness: f.knownness == null ? null : Number(f.knownness),
    })),
    actors: actors.map((a) => ({
      id: Number(a.id),
      name: a.name,
      popularity: a.popularity == null ? null : Number(a.popularity),
      film_density: a.film_density == null ? null : Number(a.film_density),
      actor_score: a.actor_score == null ? null : Number(a.actor_score),
    })),
    credits: edges,
  }

  fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
  fs.writeFileSync(args.outFile, `${JSON.stringify(out, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    films: out.films.length,
    actors: out.actors.length,
    credits: out.credits.length,
    outFile: args.outFile,
  }, null, 2))
}

main()
