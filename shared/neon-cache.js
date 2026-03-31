'use strict'

const { neon } = require('@netlify/neon')

const SEARCH_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7
const EDGE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 180

let sqlClient = null
let schemaReadyPromise = null

function getSql() {
  if (sqlClient) return sqlClient
  if (!process.env.NETLIFY_DATABASE_URL && !process.env.DATABASE_URL) {
    throw new Error('Missing NETLIFY_DATABASE_URL (or DATABASE_URL) for Neon connection')
  }
  sqlClient = neon()
  return sqlClient
}

async function ensureSchema() {
  if (schemaReadyPromise) return schemaReadyPromise
  schemaReadyPromise = (async () => {
    const sql = getSql()

    await sql`
      CREATE TABLE IF NOT EXISTS tmdb_actor (
        id BIGINT PRIMARY KEY,
        name TEXT NOT NULL,
        popularity REAL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

    await sql`
      CREATE TABLE IF NOT EXISTS tmdb_film (
        id BIGINT PRIMARY KEY,
        title TEXT NOT NULL,
        release_date DATE,
        popularity REAL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

    await sql`
      CREATE TABLE IF NOT EXISTS tmdb_search_cache (
        kind TEXT NOT NULL,
        normalized_query TEXT NOT NULL,
        result_ids BIGINT[] NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        hit_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (kind, normalized_query)
      )
    `

    await sql`
      CREATE TABLE IF NOT EXISTS tmdb_edge_check (
        actor_id BIGINT NOT NULL,
        film_id BIGINT NOT NULL,
        is_valid BOOLEAN NOT NULL,
        checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (actor_id, film_id)
      )
    `
  })()

  try {
    await schemaReadyPromise
  } catch (error) {
    schemaReadyPromise = null
    throw error
  }
}

function normalizeQuery(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function parseTmdbYear(releaseDate) {
  if (!releaseDate) return null
  if (releaseDate instanceof Date && !Number.isNaN(releaseDate.getTime())) {
    return String(releaseDate.getUTCFullYear())
  }
  const text = String(releaseDate)
  const isoMatch = text.match(/^(\d{4})-\d{2}-\d{2}/)
  if (isoMatch) return isoMatch[1]
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return String(parsed.getUTCFullYear())
}

function toIsoDateString(value) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const text = String(value)
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoMatch) return isoMatch[1]
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

async function hydrateSearchResults(kind, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const sql = getSql()

  if (kind === 'actor') {
    const rows = await sql`
      SELECT ord.id::BIGINT AS id, a.name, a.popularity
      FROM unnest(${ids}::BIGINT[]) WITH ORDINALITY AS ord(id, n)
      LEFT JOIN tmdb_actor a ON a.id = ord.id
      ORDER BY ord.n ASC
    `

    return rows
      .filter((row) => row.name)
      .map((row) => ({
        id: Number(row.id),
        kind: 'actor',
        label: row.name,
        popularity: row.popularity == null ? null : Number(row.popularity),
      }))
  }

  const rows = await sql`
    SELECT ord.id::BIGINT AS id, f.title, f.release_date, f.popularity
    FROM unnest(${ids}::BIGINT[]) WITH ORDINALITY AS ord(id, n)
    LEFT JOIN tmdb_film f ON f.id = ord.id
    ORDER BY ord.n ASC
  `

  return rows
    .filter((row) => row.title)
    .map((row) => {
      const releaseDate = toIsoDateString(row.release_date)
      const year = parseTmdbYear(releaseDate)
      return {
        id: Number(row.id),
        kind: 'film',
        label: year ? `${row.title} (${year})` : row.title,
        title: row.title,
        releaseDate,
        popularity: row.popularity == null ? null : Number(row.popularity),
      }
    })
}

async function getCachedSearch(kind, normalizedQuery, ttlMs = SEARCH_CACHE_TTL_MS) {
  const sql = getSql()
  const rows = await sql`
    SELECT result_ids, updated_at
    FROM tmdb_search_cache
    WHERE kind = ${kind} AND normalized_query = ${normalizedQuery}
  `

  if (!rows[0]) return null
  const updatedAt = new Date(rows[0].updated_at).getTime()
  if (Date.now() - updatedAt > ttlMs) return null

  const resultIds = Array.isArray(rows[0].result_ids) ? rows[0].result_ids.map((id) => Number(id)) : []

  const results = await hydrateSearchResults(kind, resultIds)
  return {
    updatedAt,
    resultIds,
    results,
  }
}

async function cacheSearchResults(kind, normalizedQuery, results) {
  const sql = getSql()
  const ids = results.map((entry) => Number(entry.id)).filter((id) => Number.isInteger(id) && id > 0)

  for (const entry of results) {
    if (kind === 'actor') {
      await sql`
        INSERT INTO tmdb_actor (id, name, popularity, updated_at)
        VALUES (${entry.id}, ${entry.label}, ${entry.popularity == null ? null : Number(entry.popularity)}, NOW())
        ON CONFLICT (id)
        DO UPDATE SET name = EXCLUDED.name, popularity = EXCLUDED.popularity, updated_at = NOW()
      `
    } else {
      await sql`
        INSERT INTO tmdb_film (id, title, release_date, popularity, updated_at)
        VALUES (
          ${entry.id},
          ${entry.title || entry.label},
          ${entry.releaseDate || null},
          ${entry.popularity == null ? null : Number(entry.popularity)},
          NOW()
        )
        ON CONFLICT (id)
        DO UPDATE SET
          title = EXCLUDED.title,
          release_date = EXCLUDED.release_date,
          popularity = EXCLUDED.popularity,
          updated_at = NOW()
      `
    }
  }

  await sql`
    INSERT INTO tmdb_search_cache (kind, normalized_query, result_ids, updated_at, hit_count)
    VALUES (${kind}, ${normalizedQuery}, ${ids}::BIGINT[], NOW(), 1)
    ON CONFLICT (kind, normalized_query)
    DO UPDATE SET
      result_ids = EXCLUDED.result_ids,
      updated_at = NOW(),
      hit_count = tmdb_search_cache.hit_count + 1
  `
}

async function getCachedEdge(actorId, filmId, ttlMs = EDGE_CACHE_TTL_MS) {
  const sql = getSql()
  const rows = await sql`
    SELECT is_valid, checked_at
    FROM tmdb_edge_check
    WHERE actor_id = ${actorId} AND film_id = ${filmId}
  `

  if (!rows[0]) return null
  const checkedAt = new Date(rows[0].checked_at).getTime()
  if (Date.now() - checkedAt > ttlMs) return null

  return {
    isValid: Boolean(rows[0].is_valid),
    checkedAt,
  }
}

async function cacheEdgeResult(actorId, filmId, isValid) {
  const sql = getSql()
  await sql`
    INSERT INTO tmdb_edge_check (actor_id, film_id, is_valid, checked_at)
    VALUES (${actorId}, ${filmId}, ${Boolean(isValid)}, NOW())
    ON CONFLICT (actor_id, film_id)
    DO UPDATE SET is_valid = EXCLUDED.is_valid, checked_at = NOW()
  `
}

module.exports = {
  SEARCH_CACHE_TTL_MS,
  EDGE_CACHE_TTL_MS,
  ensureSchema,
  normalizeQuery,
  getCachedSearch,
  cacheSearchResults,
  getCachedEdge,
  cacheEdgeResult,
}
