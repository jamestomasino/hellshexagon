'use strict'

const {
  ensureSchema,
  getCachedEdge,
  cacheEdgeResult,
} = require('../../shared/neon-cache')
const { tmdbFetch } = require('../../shared/tmdb')

function parseNumeric(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

function parseBoolean(value) {
  if (value === undefined || value === null || value === '') return false
  const normalized = String(value).toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

async function parseInput(event) {
  const params = event && event.queryStringParameters ? event.queryStringParameters : {}

  let actorId = parseNumeric(params.actorId)
  let filmId = parseNumeric(params.filmId)
  const skipCache = parseBoolean(params.skipCache || params.refresh)

  if ((actorId && filmId) || !event || !event.body) {
    return { actorId, filmId, skipCache }
  }

  try {
    const parsed = JSON.parse(event.body)
    actorId = actorId || parseNumeric(parsed.actorId)
    filmId = filmId || parseNumeric(parsed.filmId)
  } catch (_error) {
    // no-op
  }

  return { actorId, filmId, skipCache }
}

exports.handler = async function handler(event) {
  try {
    await ensureSchema()

    const { actorId, filmId, skipCache } = await parseInput(event)
    if (!actorId || !filmId) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'Expected actorId and filmId as positive integers' }),
      }
    }

    const cached = skipCache ? null : await getCachedEdge(actorId, filmId)
    if (cached && !skipCache) {
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800',
        },
        body: JSON.stringify({
          actorId,
          filmId,
          isValid: cached.isValid,
          cached: true,
          skipCache,
          checkedAt: new Date(cached.checkedAt).toISOString(),
        }),
      }
    }

    const credits = await tmdbFetch(`/person/${actorId}/movie_credits`, { language: 'en-US' })
    const cast = Array.isArray(credits && credits.cast) ? credits.cast : []
    const isValid = cast.some((movie) => Number(movie.id) === filmId)

    await cacheEdgeResult(actorId, filmId, isValid)

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800',
      },
      body: JSON.stringify({
        actorId,
        filmId,
        isValid,
        cached: false,
        skipCache,
        checkedAt: new Date().toISOString(),
      }),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'Edge validation failed',
        details: error.message,
      }),
    }
  }
}
