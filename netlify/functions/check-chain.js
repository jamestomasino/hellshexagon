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

exports.handler = async function handler(event) {
  try {
    await ensureSchema()

    const method = event && event.httpMethod ? event.httpMethod.toUpperCase() : 'GET'
    if (method !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'Method not allowed' }),
      }
    }

    let payload = {}
    try {
      payload = event && event.body ? JSON.parse(event.body) : {}
    } catch (_error) {
      payload = {}
    }

    const skipCache = parseBoolean(payload.skipCache)
    const rawEdges = Array.isArray(payload.edges) ? payload.edges : []
    const pairs = rawEdges
      .map((edge) => ({
        actorId: parseNumeric(edge && edge.actorId),
        filmId: parseNumeric(edge && edge.filmId),
      }))
      .filter((edge) => edge.actorId && edge.filmId)

    if (pairs.length === 0) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ results: [] }),
      }
    }

    const resultsByKey = new Map()
    const unresolvedByActor = new Map()

    for (const pair of pairs) {
      const key = `${pair.actorId}:${pair.filmId}`
      if (resultsByKey.has(key)) continue
      if (!skipCache) {
        const cached = await getCachedEdge(pair.actorId, pair.filmId)
        if (cached) {
          resultsByKey.set(key, Boolean(cached.isValid))
          continue
        }
      }
      if (!unresolvedByActor.has(pair.actorId)) unresolvedByActor.set(pair.actorId, new Set())
      unresolvedByActor.get(pair.actorId).add(pair.filmId)
    }

    for (const [actorId, filmIds] of unresolvedByActor.entries()) {
      const credits = await tmdbFetch(`/person/${actorId}/movie_credits`, { language: 'en-US' })
      const cast = Array.isArray(credits && credits.cast) ? credits.cast : []
      const castIds = new Set(cast.map((movie) => Number(movie.id)).filter((id) => Number.isInteger(id) && id > 0))
      for (const filmId of filmIds.values()) {
        const isValid = castIds.has(filmId)
        resultsByKey.set(`${actorId}:${filmId}`, isValid)
        await cacheEdgeResult(actorId, filmId, isValid)
      }
    }

    const results = pairs.map((pair) => ({
      actorId: pair.actorId,
      filmId: pair.filmId,
      isValid: Boolean(resultsByKey.get(`${pair.actorId}:${pair.filmId}`)),
    }))

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
      },
      body: JSON.stringify({ results }),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'Chain validation failed',
        details: error && error.message ? error.message : String(error),
      }),
    }
  }
}

