#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { logNorm, toNumber } = require('./score-utils')

function parseArgs(argv) {
  const out = {
    filmsFile: null,
    peopleFile: null,
    creditsFile: null,
    outFile: path.join(process.cwd(), 'tmp', 'output', 'actor_candidates.json'),
    limit: 20000,
  }

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--films') out.filmsFile = argv[++i]
    else if (a === '--people') out.peopleFile = argv[++i]
    else if (a === '--credits') out.creditsFile = argv[++i]
    else if (a === '--out') out.outFile = argv[++i]
    else if (a === '--limit') out.limit = Number(argv[++i])
    else if (a === '--help') out.help = true
  }

  return out
}

function printHelp() {
  console.log('Usage: node scripts/catalog/build-actor-candidates.js --films <film_candidates.json> --people <tmdb_people.jsonl> --credits <tmdb_credits.jsonl> [--out <file>] [--limit 20000]')
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

function castWeight(order) {
  const n = Number(order)
  if (!Number.isFinite(n) || n < 0) return 0.25
  if (n <= 2) return 1
  if (n <= 5) return 0.7
  if (n <= 10) return 0.45
  return 0.25
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.filmsFile || !args.peopleFile || !args.creditsFile) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }

  const films = readJsonFile(args.filmsFile)
  const people = readJsonLines(args.peopleFile)
  const credits = readJsonLines(args.creditsFile)

  const selectedFilmIds = new Set(films.map((f) => Number(f.id)).filter((id) => Number.isInteger(id) && id > 0))
  const peopleMap = new Map()

  for (const p of people) {
    const id = Number(p.id)
    if (!Number.isInteger(id) || id <= 0) continue
    peopleMap.set(id, {
      id,
      name: String(p.name || '').trim(),
      popularity: toNumber(p.popularity, 0),
    })
  }

  const stats = new Map()
  for (const c of credits) {
    const filmId = Number(c.movie_id || c.film_id || c.id_movie)
    const actorId = Number(c.person_id || c.actor_id || c.id_person)
    if (!selectedFilmIds.has(filmId)) continue
    if (!Number.isInteger(actorId) || actorId <= 0) continue

    const dept = String(c.department || '').toLowerCase()
    if (dept && dept !== 'acting') continue

    if (!stats.has(actorId)) {
      stats.set(actorId, {
        filmIds: new Set(),
        weightedDensity: 0,
      })
    }

    const row = stats.get(actorId)
    if (row.filmIds.has(filmId)) continue
    row.filmIds.add(filmId)
    row.weightedDensity += castWeight(c.order)
  }

  const densityValues = [...stats.values()].map((s) => s.weightedDensity)
  const maxDensity = Math.max(1, ...densityValues)
  let maxPopularity = 1
  for (const [actorId] of stats) {
    const p = peopleMap.get(actorId)
    if (p && p.popularity > maxPopularity) maxPopularity = p.popularity
  }

  const scored = []
  for (const [actorId, s] of stats) {
    const p = peopleMap.get(actorId)
    if (!p || !p.name) continue
    const densityNorm = logNorm(s.weightedDensity, maxDensity)
    const popNorm = logNorm(p.popularity, maxPopularity)
    const actorScore = densityNorm * 0.75 + popNorm * 0.25

    scored.push({
      id: actorId,
      name: p.name,
      popularity: p.popularity,
      film_density: s.filmIds.size,
      weighted_density: Number(s.weightedDensity.toFixed(4)),
      actor_score: Number(actorScore.toFixed(6)),
    })
  }

  scored.sort((a, b) => b.actor_score - a.actor_score)
  const limited = scored.slice(0, Math.max(1, args.limit))

  fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
  fs.writeFileSync(args.outFile, `${JSON.stringify(limited, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    selectedFilms: selectedFilmIds.size,
    creditedActors: scored.length,
    output: limited.length,
    outFile: args.outFile,
  }, null, 2))
}

main()
