'use strict'

const {
  ensureSchema,
  normalizeQuery,
  getCachedSearch,
  cacheSearchResults,
} = require('../../shared/neon-cache')
const { tmdbFetch } = require('../../shared/tmdb')

const MAX_LIMIT = 12
const MIN_QUERY_LENGTH = 2

function toPositiveInt(value, fallback) {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) return fallback
  return n
}

function mapTmdbResults(kind, payload, limit) {
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

  return items
    .filter((item) => Number.isInteger(item.id) && item.id > 0 && item.title)
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
    const limit = Math.min(toPositiveInt(params.limit, 10), MAX_LIMIT)

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

    const results = mapTmdbResults(kind, tmdbPayload, limit)
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
