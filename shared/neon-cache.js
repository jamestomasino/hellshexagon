'use strict'

const { Pool } = require('pg')

const SEARCH_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7
const EDGE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 180

let pool = null
let schemaReadyPromise = null

function getPool() {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL for Neon/Postgres connection')
  }
  pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })
  return pool
}

async function ensureSchema() {
  if (schemaReadyPromise) return schemaReadyPromise
  schemaReadyPromise = (async () => {
    const db = getPool()

    await db.query(`
      CREATE TABLE IF NOT EXISTS tmdb_actor (
        id BIGINT PRIMARY KEY,
        name TEXT NOT NULL,
        popularity REAL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await db.query(`
      CREATE TABLE IF NOT EXISTS tmdb_film (
        id BIGINT PRIMARY KEY,
        title TEXT NOT NULL,
        release_date DATE,
        popularity REAL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await db.query(`
      CREATE TABLE IF NOT EXISTS tmdb_search_cache (
        kind TEXT NOT NULL,
        normalized_query TEXT NOT NULL,
        result_ids BIGINT[] NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        hit_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (kind, normalized_query)
      )
    `)

    await db.query(`
      CREATE TABLE IF NOT EXISTS tmdb_edge_check (
        actor_id BIGINT NOT NULL,
        film_id BIGINT NOT NULL,
        is_valid BOOLEAN NOT NULL,
        checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (actor_id, film_id)
      )
    `)
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
  if (!releaseDate || typeof releaseDate !== 'string') return null
  return releaseDate.slice(0, 4)
}

async function hydrateSearchResults(kind, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const db = getPool()

  if (kind === 'actor') {
    const res = await db.query(
      `
      SELECT ord.id::BIGINT AS id, a.name, a.popularity
      FROM unnest($1::BIGINT[]) WITH ORDINALITY AS ord(id, n)
      LEFT JOIN tmdb_actor a ON a.id = ord.id
      ORDER BY ord.n ASC
      `,
      [ids],
    )

    return res.rows
      .filter((row) => row.name)
      .map((row) => ({
        id: Number(row.id),
        kind: 'actor',
        label: row.name,
        popularity: row.popularity == null ? null : Number(row.popularity),
      }))
  }

  const res = await db.query(
    `
    SELECT ord.id::BIGINT AS id, f.title, f.release_date, f.popularity
    FROM unnest($1::BIGINT[]) WITH ORDINALITY AS ord(id, n)
    LEFT JOIN tmdb_film f ON f.id = ord.id
    ORDER BY ord.n ASC
    `,
    [ids],
  )

  return res.rows
    .filter((row) => row.title)
    .map((row) => {
      const releaseDate = row.release_date ? String(row.release_date) : null
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
  const db = getPool()
  const res = await db.query(
    `
    SELECT result_ids, updated_at
    FROM tmdb_search_cache
    WHERE kind = $1 AND normalized_query = $2
    `,
    [kind, normalizedQuery],
  )

  if (!res.rows[0]) return null
  const updatedAt = new Date(res.rows[0].updated_at).getTime()
  if (Date.now() - updatedAt > ttlMs) return null

  const resultIds = Array.isArray(res.rows[0].result_ids)
    ? res.rows[0].result_ids.map((id) => Number(id))
    : []

  const results = await hydrateSearchResults(kind, resultIds)
  return {
    updatedAt,
    resultIds,
    results,
  }
}

async function cacheSearchResults(kind, normalizedQuery, results) {
  const db = getPool()
  const ids = results.map((entry) => Number(entry.id)).filter((id) => Number.isInteger(id) && id > 0)

  for (const entry of results) {
    if (kind === 'actor') {
      await db.query(
        `
        INSERT INTO tmdb_actor (id, name, popularity, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (id)
        DO UPDATE SET name = EXCLUDED.name, popularity = EXCLUDED.popularity, updated_at = NOW()
        `,
        [entry.id, entry.label, entry.popularity == null ? null : Number(entry.popularity)],
      )
    } else {
      await db.query(
        `
        INSERT INTO tmdb_film (id, title, release_date, popularity, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          title = EXCLUDED.title,
          release_date = EXCLUDED.release_date,
          popularity = EXCLUDED.popularity,
          updated_at = NOW()
        `,
        [
          entry.id,
          entry.title || entry.label,
          entry.releaseDate || null,
          entry.popularity == null ? null : Number(entry.popularity),
        ],
      )
    }
  }

  await db.query(
    `
    INSERT INTO tmdb_search_cache (kind, normalized_query, result_ids, updated_at, hit_count)
    VALUES ($1, $2, $3::BIGINT[], NOW(), 1)
    ON CONFLICT (kind, normalized_query)
    DO UPDATE SET
      result_ids = EXCLUDED.result_ids,
      updated_at = NOW(),
      hit_count = tmdb_search_cache.hit_count + 1
    `,
    [kind, normalizedQuery, ids],
  )
}

async function getCachedEdge(actorId, filmId, ttlMs = EDGE_CACHE_TTL_MS) {
  const db = getPool()
  const res = await db.query(
    `
    SELECT is_valid, checked_at
    FROM tmdb_edge_check
    WHERE actor_id = $1 AND film_id = $2
    `,
    [actorId, filmId],
  )

  if (!res.rows[0]) return null
  const checkedAt = new Date(res.rows[0].checked_at).getTime()
  if (Date.now() - checkedAt > ttlMs) return null

  return {
    isValid: Boolean(res.rows[0].is_valid),
    checkedAt,
  }
}

async function cacheEdgeResult(actorId, filmId, isValid) {
  const db = getPool()
  await db.query(
    `
    INSERT INTO tmdb_edge_check (actor_id, film_id, is_valid, checked_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (actor_id, film_id)
    DO UPDATE SET is_valid = EXCLUDED.is_valid, checked_at = NOW()
    `,
    [actorId, filmId, Boolean(isValid)],
  )
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
