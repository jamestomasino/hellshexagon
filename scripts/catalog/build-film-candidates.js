#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { logNorm, minMaxNorm, toNumber } = require('./score-utils')

function parseArgs(argv) {
  const out = {
    inFile: null,
    outFile: path.join(process.cwd(), 'tmp', 'output', 'film_candidates.json'),
    limit: 5000,
    minYear: 1970,
    minVotes: 500,
    language: 'en',
    usOnly: false,
  }

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--in') out.inFile = argv[++i]
    else if (a === '--out') out.outFile = argv[++i]
    else if (a === '--limit') out.limit = Number(argv[++i])
    else if (a === '--min-year') out.minYear = Number(argv[++i])
    else if (a === '--min-votes') out.minVotes = Number(argv[++i])
    else if (a === '--language') out.language = String(argv[++i] || 'en')
    else if (a === '--us-only') out.usOnly = true
    else if (a === '--help') out.help = true
  }

  return out
}

function printHelp() {
  console.log('Usage: node scripts/catalog/build-film-candidates.js --in <tmdb_movies.jsonl> [--out <file>] [--limit 5000] [--min-year 1970] [--min-votes 500] [--language en] [--us-only]')
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

function getYear(releaseDate) {
  const m = String(releaseDate || '').match(/^(\d{4})/)
  return m ? Number(m[1]) : null
}

function hasUSOrigin(item) {
  const countries = Array.isArray(item.origin_country) ? item.origin_country : []
  if (countries.includes('US')) return true
  if (item.production_countries && Array.isArray(item.production_countries)) {
    return item.production_countries.some((c) => c && (c.iso_3166_1 === 'US' || c.code === 'US'))
  }
  return false
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.inFile) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }

  const rows = readJsonLines(args.inFile)
  const mapped = rows.map((r) => {
    const year = getYear(r.release_date)
    return {
      id: Number(r.id),
      title: String(r.title || r.original_title || '').trim(),
      year,
      popularity: toNumber(r.popularity, 0),
      vote_count: toNumber(r.vote_count, 0),
      revenue: toNumber(r.revenue, 0),
      original_language: String(r.original_language || '').toLowerCase(),
      origin_country: Array.isArray(r.origin_country) ? r.origin_country : [],
      _raw: r,
    }
  }).filter((m) => Number.isInteger(m.id) && m.id > 0 && m.title && Number.isInteger(m.year))

  const filtered = mapped.filter((m) => {
    if (m.year < args.minYear) return false
    if (m.vote_count < args.minVotes) return false
    if (args.language && m.original_language && m.original_language !== args.language) return false
    if (args.usOnly && !hasUSOrigin(m._raw)) return false
    return true
  })

  const maxVotes = Math.max(1, ...filtered.map((f) => f.vote_count))
  const maxPopularity = Math.max(1, ...filtered.map((f) => f.popularity))
  const maxRevenue = Math.max(1, ...filtered.map((f) => f.revenue))
  const minYear = Math.min(...filtered.map((f) => f.year))
  const maxYear = Math.max(...filtered.map((f) => f.year))

  const scored = filtered.map((f) => {
    const votesNorm = logNorm(f.vote_count, maxVotes)
    const popNorm = logNorm(f.popularity, maxPopularity)
    const revNorm = logNorm(f.revenue, maxRevenue)
    const recencyNorm = minMaxNorm(f.year, minYear, maxYear)
    const knownness = votesNorm * 0.4 + popNorm * 0.25 + revNorm * 0.2 + recencyNorm * 0.15

    return {
      id: f.id,
      title: f.title,
      year: f.year,
      popularity: f.popularity,
      vote_count: f.vote_count,
      revenue: f.revenue,
      original_language: f.original_language,
      knownness: Number(knownness.toFixed(6)),
    }
  })

  scored.sort((a, b) => b.knownness - a.knownness)
  const limited = scored.slice(0, Math.max(1, args.limit))

  fs.mkdirSync(path.dirname(args.outFile), { recursive: true })
  fs.writeFileSync(args.outFile, `${JSON.stringify(limited, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    input: rows.length,
    filtered: filtered.length,
    output: limited.length,
    outFile: args.outFile,
  }, null, 2))
}

main()
