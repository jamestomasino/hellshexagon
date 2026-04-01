#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

function parseArgs(argv) {
  const out = {
    moviesOut: path.join(process.cwd(), 'tmp', 'sources', 'tmdb_movies.jsonl'),
    creditsOut: path.join(process.cwd(), 'tmp', 'sources', 'tmdb_credits.jsonl'),
    peopleOut: path.join(process.cwd(), 'tmp', 'sources', 'tmdb_people.jsonl'),
    targetFilms: 3000,
    castPerFilm: 12,
    minYear: 1970,
    maxPagesPerFeed: 180,
    language: 'en-US',
    region: 'US',
    concurrency: 8,
  }

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--movies-out') out.moviesOut = argv[++i]
    else if (a === '--credits-out') out.creditsOut = argv[++i]
    else if (a === '--people-out') out.peopleOut = argv[++i]
    else if (a === '--target-films') out.targetFilms = Number(argv[++i])
    else if (a === '--cast-per-film') out.castPerFilm = Number(argv[++i])
    else if (a === '--min-year') out.minYear = Number(argv[++i])
    else if (a === '--max-pages-per-feed') out.maxPagesPerFeed = Number(argv[++i])
    else if (a === '--language') out.language = String(argv[++i] || 'en-US')
    else if (a === '--region') out.region = String(argv[++i] || 'US')
    else if (a === '--concurrency') out.concurrency = Number(argv[++i])
    else if (a === '--help') out.help = true
  }

  return out
}

function printHelp() {
  console.log(
    'Usage: node scripts/catalog/fetch-tmdb-sources.js [--target-films 3000] [--cast-per-film 12] [--max-pages-per-feed 180] [--concurrency 8] [--movies-out <file>] [--credits-out <file>] [--people-out <file>]'
  )
}

function getToken() {
  const token = process.env.TMDB_TOKEN
  if (!token) throw new Error('Missing TMDB_TOKEN environment variable')
  return token
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function tmdbFetch(pathname, params, token) {
  const url = new URL(`https://api.themoviedb.org/3${pathname}`)
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    url.searchParams.set(k, String(v))
  })

  let attempt = 0
  while (attempt < 6) {
    attempt += 1
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
    if (response.ok) return await response.json()

    const shouldRetry = response.status === 429 || response.status >= 500
    if (!shouldRetry || attempt >= 6) {
      const details = await response.text().catch(() => '')
      throw new Error(`TMDB ${pathname} failed (${response.status}): ${details || 'no details'}`)
    }

    const backoffMs = 400 * 2 ** (attempt - 1)
    await sleep(backoffMs)
  }

  throw new Error(`TMDB ${pathname} failed after retries`)
}

function movieScore(m) {
  const votes = Number(m.vote_count || 0)
  const pop = Number(m.popularity || 0)
  return votes * 1.1 + pop * 25
}

function normalizeMovie(m) {
  return {
    id: Number(m.id),
    title: String(m.title || m.original_title || '').trim(),
    release_date: String(m.release_date || ''),
    vote_count: Number(m.vote_count || 0),
    popularity: Number(m.popularity || 0),
    revenue: Number(m.revenue || 0),
    original_language: String(m.original_language || '').toLowerCase(),
    origin_country: Array.isArray(m.origin_country) ? m.origin_country : [],
  }
}

async function collectMovies(config, token) {
  const feeds = [
    {
      path: '/discover/movie',
      params: {
        include_adult: false,
        include_video: false,
        language: config.language,
        region: config.region,
        sort_by: 'vote_count.desc',
        'vote_count.gte': 50,
        'primary_release_date.gte': `${config.minYear}-01-01`,
      },
    },
    {
      path: '/discover/movie',
      params: {
        include_adult: false,
        include_video: false,
        language: config.language,
        region: config.region,
        sort_by: 'popularity.desc',
        'vote_count.gte': 50,
        'primary_release_date.gte': `${config.minYear}-01-01`,
      },
    },
    {
      path: '/movie/top_rated',
      params: {
        language: config.language,
        region: config.region,
      },
    },
    {
      path: '/movie/popular',
      params: {
        language: config.language,
        region: config.region,
      },
    },
  ]

  const byId = new Map()

  for (const feed of feeds) {
    for (let page = 1; page <= config.maxPagesPerFeed; page += 1) {
      const payload = await tmdbFetch(feed.path, { ...feed.params, page }, token)
      const results = Array.isArray(payload && payload.results) ? payload.results : []
      if (results.length === 0) break
      for (const m of results) {
        const id = Number(m.id)
        if (!Number.isInteger(id) || id <= 0) continue
        const existing = byId.get(id)
        if (!existing || movieScore(m) > movieScore(existing)) byId.set(id, m)
      }
      if (page >= Number(payload.total_pages || page)) break
      if (byId.size >= config.targetFilms * 1.6) break
    }
    if (byId.size >= config.targetFilms * 1.6) break
  }

  const movies = [...byId.values()]
    .map(normalizeMovie)
    .filter((m) => m.id > 0 && m.title && /^\d{4}/.test(m.release_date))
  movies.sort((a, b) => movieScore(b) - movieScore(a))
  return movies.slice(0, config.targetFilms)
}

async function runPool(items, concurrency, worker) {
  const queue = items.slice()
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      if (item == null) return
      await worker(item)
    }
  })
  await Promise.all(workers)
}

async function collectCreditsAndPeople(movies, config, token) {
  const creditsRows = []
  const peopleMap = new Map()
  const failedMovieIds = []

  await runPool(movies, config.concurrency, async (movie) => {
    try {
      const payload = await tmdbFetch(
        `/movie/${movie.id}/credits`,
        { language: config.language },
        token
      )
      const cast = Array.isArray(payload && payload.cast) ? payload.cast : []
      const topCast = cast
        .filter((p) => Number.isInteger(Number(p.id)) && Number(p.id) > 0)
        .sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999))
        .slice(0, config.castPerFilm)

      for (const person of topCast) {
        const personId = Number(person.id)
        const order = Number(person.order)
        creditsRows.push({
          movie_id: movie.id,
          person_id: personId,
          order: Number.isFinite(order) ? order : null,
          department: 'Acting',
        })
        if (!peopleMap.has(personId)) {
          peopleMap.set(personId, {
            id: personId,
            name: String(person.name || '').trim(),
            popularity: Number(person.popularity || 0),
          })
        }
      }
    } catch (_error) {
      failedMovieIds.push(movie.id)
    }
  })

  return {
    creditsRows,
    people: [...peopleMap.values()].filter((p) => p.id > 0 && p.name),
    failedMovieIds,
  }
}

function writeJsonLines(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const text = rows.map((row) => JSON.stringify(row)).join('\n')
  fs.writeFileSync(file, `${text}\n`, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const token = getToken()
  const movies = await collectMovies(args, token)
  const { creditsRows, people, failedMovieIds } = await collectCreditsAndPeople(movies, args, token)

  writeJsonLines(args.moviesOut, movies)
  writeJsonLines(args.creditsOut, creditsRows)
  writeJsonLines(args.peopleOut, people)

  console.log(JSON.stringify({
    ok: true,
    targetFilms: args.targetFilms,
    movies: movies.length,
    people: people.length,
    credits: creditsRows.length,
    failedCredits: failedMovieIds.length,
    outputs: {
      movies: args.moviesOut,
      credits: args.creditsOut,
      people: args.peopleOut,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error))
  process.exit(1)
})
