'use strict'

const {
  ensureSchema,
  normalizeQuery,
  getCachedSearch,
  cacheSearchResults,
} = require('../../shared/neon-cache')
const { tmdbFetch } = require('../../shared/tmdb')

const MAX_LIMIT = 30
const MIN_QUERY_LENGTH = 2

function toPositiveInt(value, fallback) {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) return fallback
  return n
}

function normalizeTitle(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitTitleAndYear(query) {
  const raw = String(query || '').trim()
  const match = raw.match(/^(.*?)(?:\s*\((\d{4})\)|\s+(\d{4}))\s*$/)
  if (!match) {
    return { title: normalizeTitle(raw), year: null }
  }
  const year = match[2] || match[3] || null
  return {
    title: normalizeTitle(match[1]),
    year,
  }
}

function rankFilmResult(item, queryInfo) {
  const titleNorm = normalizeTitle(item && item.title)
  if (!titleNorm) return -Infinity

  let score = 0
  if (queryInfo.title && titleNorm === queryInfo.title) score += 300
  else if (queryInfo.title && titleNorm.startsWith(`${queryInfo.title} `)) score += 220
  else if (queryInfo.title && titleNorm.startsWith(queryInfo.title)) score += 170
  else if (queryInfo.title && titleNorm.includes(` ${queryInfo.title} `)) score += 120
  else if (queryInfo.title && titleNorm.includes(queryInfo.title)) score += 60

  const releaseDate = typeof item.release_date === 'string' ? item.release_date : null
  const year = releaseDate && releaseDate.length >= 4 ? releaseDate.slice(0, 4) : null
  if (queryInfo.year && year === queryInfo.year) score += 180

  const popularity = item && item.popularity != null ? Number(item.popularity) : 0
  if (Number.isFinite(popularity)) score += Math.min(popularity / 10, 40)

  return score
}

function mapTmdbResults(kind, payload, limit, rawQuery) {
  const items = Array.isArray(payload && payload.results) ? payload.results : []
  if (kind === 'actor') {
    return items
      .filter((item) => Number.isInteger(item.id) && item.id > 0 && item.name)
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        kind: 'actor',
        label: item.name,
        popularity: item.popularity == null ? null : Number(item.popularity),
      }))
  }

  const queryInfo = splitTitleAndYear(rawQuery)
  return items
    .filter((item) => Number.isInteger(item.id) && item.id > 0 && item.title)
    .sort((a, b) => rankFilmResult(b, queryInfo) - rankFilmResult(a, queryInfo))
    .slice(0, limit)
    .map((item) => {
      const releaseDate = typeof item.release_date === 'string' ? item.release_date : null
      const year = releaseDate && releaseDate.length >= 4 ? releaseDate.slice(0, 4) : null
      return {
        id: item.id,
        kind: 'film',
        label: year ? `${item.title} (${year})` : item.title,
        title: item.title,
        releaseDate,
        popularity: item.popularity == null ? null : Number(item.popularity),
      }
    })
}

exports.handler = async function handler(event) {
  try {
    await ensureSchema()

    const params = event && event.queryStringParameters ? event.queryStringParameters : {}
    const kind = params.kind === 'film' ? 'film' : params.kind === 'actor' ? 'actor' : null
    const rawQuery = params.q
    const normalizedQuery = normalizeQuery(rawQuery)
    const limit = Math.min(toPositiveInt(params.limit, 20), MAX_LIMIT)

    if (!kind) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'Expected kind=actor or kind=film' }),
      }
    }

    if (normalizedQuery.length < MIN_QUERY_LENGTH) {
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=60, s-maxage=60',
        },
        body: JSON.stringify({
          kind,
          query: rawQuery || '',
          normalizedQuery,
          cached: false,
          results: [],
        }),
      }
    }

    const cached = await getCachedSearch(kind, normalizedQuery)
    if (cached && cached.results.length > 0) {
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=120, s-maxage=1200, stale-while-revalidate=86400',
        },
        body: JSON.stringify({
          kind,
          query: rawQuery || '',
          normalizedQuery,
          cached: true,
          results: cached.results.slice(0, limit),
        }),
      }
    }

    const endpoint = kind === 'actor' ? '/search/person' : '/search/movie'
    const tmdbPayload = await tmdbFetch(endpoint, {
      query: rawQuery,
      include_adult: 'false',
      page: '1',
      language: 'en-US',
    })

    const results = mapTmdbResults(kind, tmdbPayload, limit, rawQuery)
    await cacheSearchResults(kind, normalizedQuery, results)

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=120, s-maxage=1200, stale-while-revalidate=86400',
      },
      body: JSON.stringify({
        kind,
        query: rawQuery || '',
        normalizedQuery,
        cached: false,
        results,
      }),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'Search failed',
        details: error.message,
      }),
    }
  }
}
