'use strict'

const { Pool } = require('pg')
const { getPuzzleForDate, getPuzzleForDateAvoidingUsage } = require('./daily-puzzle')

const STORE_NAME = process.env.PUZZLE_STORE_NAME || 'hells-hexagon-puzzles'
const INDEX_KEY = 'history/index'
const USAGE_INDEX_KEY = 'history/usage'

const DB_TABLE_DAILY = 'hh_daily_puzzle'

let blobsApi = null
try {
  // Available in Netlify runtime. Keep optional for local fallback.
  blobsApi = require('@netlify/blobs')
} catch (_error) {
  blobsApi = null
}

let dbPool = null
let dbSchemaReadyPromise = null
let dbBackfillPromise = null

function hasDatabase() {
  return Boolean(process.env.DATABASE_URL)
}

function getDbPool() {
  if (!hasDatabase()) return null
  if (dbPool) return dbPool

  dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })

  return dbPool
}

async function ensureDbSchema() {
  const db = getDbPool()
  if (!db) return
  if (dbSchemaReadyPromise) return dbSchemaReadyPromise

  dbSchemaReadyPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${DB_TABLE_DAILY} (
        date TEXT PRIMARY KEY,
        puzzle JSONB NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        version INTEGER NOT NULL DEFAULT 1
      )
    `)
  })()

  try {
    await dbSchemaReadyPromise
  } catch (error) {
    dbSchemaReadyPromise = null
    throw error
  }
}

function hasBlobs() {
  return Boolean(blobsApi && typeof blobsApi.getStore === 'function')
}

function getStore() {
  if (!hasBlobs()) return null

  try {
    return blobsApi.getStore(STORE_NAME)
  } catch (error) {
    const isMissingEnv =
      error && (error.name === 'MissingBlobsEnvironmentError' || /MissingBlobsEnvironmentError/.test(error.message || ''))
    if (isMissingEnv) {
      try {
        const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID
        const token =
          process.env.NETLIFY_BLOBS_TOKEN ||
          process.env.NETLIFY_AUTH_TOKEN ||
          process.env.NETLIFY_TOKEN ||
          process.env.NETLIFY_API_TOKEN ||
          process.env.BLOBS_TOKEN
        const options = token ? { name: STORE_NAME, siteID, token } : { name: STORE_NAME, siteID }
        return blobsApi.getStore(options)
      } catch (retryError) {
        const retryMissingEnv =
          retryError &&
          (retryError.name === 'MissingBlobsEnvironmentError' ||
            /MissingBlobsEnvironmentError/.test(retryError.message || ''))
        if (retryMissingEnv) return null
        throw retryError
      }
    }
    throw error
  }
}

function toDateStringUTC(input) {
  if (input === undefined || input === null || input === '') {
    return new Date().toISOString().slice(0, 10)
  }

  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date input: ${input}`)
  }

  return parsed.toISOString().slice(0, 10)
}

function entryKey(dateString) {
  return `history/${dateString}`
}

async function getHistoryIndex(store) {
  const index = await store.get(INDEX_KEY, { type: 'json' })
  if (!index || !Array.isArray(index.dates)) {
    return { dates: [] }
  }
  return index
}

async function putHistoryIndex(store, index) {
  await store.setJSON(INDEX_KEY, {
    dates: Array.from(new Set(index.dates)).sort(),
    updatedAt: new Date().toISOString(),
  })
}

async function getUsageIndex(store) {
  const usage = await store.get(USAGE_INDEX_KEY, { type: 'json' })
  if (!usage || !Array.isArray(usage.filmIds) || !Array.isArray(usage.actorIds)) {
    return { filmIds: [], actorIds: [], rebuiltFromDates: 0 }
  }
  return {
    filmIds: usage.filmIds,
    actorIds: usage.actorIds,
    rebuiltFromDates: typeof usage.rebuiltFromDates === 'number' ? usage.rebuiltFromDates : null,
  }
}

async function putUsageIndex(store, usage) {
  await store.setJSON(USAGE_INDEX_KEY, {
    filmIds: Array.from(new Set(usage.filmIds)).sort((a, b) => a - b),
    actorIds: Array.from(new Set(usage.actorIds)).sort((a, b) => a - b),
    rebuiltFromDates: typeof usage.rebuiltFromDates === 'number' ? usage.rebuiltFromDates : null,
    updatedAt: new Date().toISOString(),
  })
}

function mergePuzzleIntoUsage(usage, puzzle) {
  const filmIds = new Set(usage.filmIds || [])
  const actorIds = new Set(usage.actorIds || [])

  for (const film of puzzle.films || []) {
    if (typeof film.id === 'number') filmIds.add(film.id)
  }
  for (const actor of puzzle.actors || []) {
    if (typeof actor.id === 'number') actorIds.add(actor.id)
  }

  return {
    filmIds: Array.from(filmIds),
    actorIds: Array.from(actorIds),
    rebuiltFromDates: usage.rebuiltFromDates,
  }
}

async function rebuildUsageFromHistory(store, historyDates) {
  const usage = {
    filmIds: [],
    actorIds: [],
    rebuiltFromDates: historyDates.length,
  }

  for (const dateString of historyDates) {
    const entry = await getPuzzleEntry(store, dateString)
    if (!entry || !entry.puzzle) continue
    const merged = mergePuzzleIntoUsage(usage, entry.puzzle)
    usage.filmIds = merged.filmIds
    usage.actorIds = merged.actorIds
  }

  await putUsageIndex(store, usage)
  return usage
}

async function ensureUsageCatchUp(store) {
  const history = await getHistoryIndex(store)
  const usage = await getUsageIndex(store)
  const dateCount = history.dates.length

  const needsRebuild =
    dateCount > 0 &&
    (usage.rebuiltFromDates === null || usage.rebuiltFromDates !== dateCount)

  if (!needsRebuild) return usage

  return await rebuildUsageFromHistory(store, history.dates)
}

async function savePuzzleEntry(store, dateString, puzzle) {
  const now = new Date().toISOString()
  await store.setJSON(entryKey(dateString), {
    date: dateString,
    puzzle,
    generatedAt: now,
    version: 1,
  })

  const index = await getHistoryIndex(store)
  index.dates.push(dateString)
  await putHistoryIndex(store, index)
  const dateCount = Array.from(new Set(index.dates)).length

  const usage = await getUsageIndex(store)
  const mergedUsage = mergePuzzleIntoUsage(usage, puzzle)
  mergedUsage.rebuiltFromDates = dateCount
  await putUsageIndex(store, mergedUsage)
}

async function getPuzzleEntry(store, dateString) {
  return await store.get(entryKey(dateString), { type: 'json' })
}

async function dbGetPuzzleEntry(dateString) {
  await ensureDbSchema()
  const db = getDbPool()
  const res = await db.query(
    `
    SELECT date, puzzle, generated_at
    FROM ${DB_TABLE_DAILY}
    WHERE date = $1
    `,
    [dateString],
  )

  if (!res.rows[0]) return null
  return {
    date: res.rows[0].date,
    puzzle: res.rows[0].puzzle,
    generatedAt: res.rows[0].generated_at ? new Date(res.rows[0].generated_at).toISOString() : null,
  }
}

async function dbSavePuzzleEntry(dateString, puzzle, generatedAtISO) {
  await ensureDbSchema()
  const db = getDbPool()
  await db.query(
    `
    INSERT INTO ${DB_TABLE_DAILY} (date, puzzle, generated_at, version)
    VALUES ($1, $2::jsonb, $3::timestamptz, 1)
    ON CONFLICT (date)
    DO UPDATE SET puzzle = EXCLUDED.puzzle, generated_at = EXCLUDED.generated_at, version = EXCLUDED.version
    `,
    [dateString, JSON.stringify(puzzle), generatedAtISO || new Date().toISOString()],
  )
}

async function dbListPuzzleDates() {
  await ensureDbSchema()
  const db = getDbPool()
  const res = await db.query(
    `
    SELECT date
    FROM ${DB_TABLE_DAILY}
    ORDER BY date ASC
    `,
  )
  return res.rows.map((row) => row.date)
}

async function dbGetUsage() {
  await ensureDbSchema()
  const db = getDbPool()
  const res = await db.query(`SELECT puzzle FROM ${DB_TABLE_DAILY}`)

  const usage = {
    filmIds: [],
    actorIds: [],
    rebuiltFromDates: res.rows.length,
  }

  for (const row of res.rows) {
    if (!row || !row.puzzle) continue
    const merged = mergePuzzleIntoUsage(usage, row.puzzle)
    usage.filmIds = merged.filmIds
    usage.actorIds = merged.actorIds
  }

  return usage
}

async function maybeBackfillDbFromBlobs() {
  if (!hasDatabase()) return
  if (dbBackfillPromise) return dbBackfillPromise

  dbBackfillPromise = (async () => {
    await ensureDbSchema()
    const db = getDbPool()
    const countRes = await db.query(`SELECT COUNT(*)::INT AS count FROM ${DB_TABLE_DAILY}`)
    const count = countRes.rows[0] ? Number(countRes.rows[0].count) : 0
    if (count > 0) return

    const store = getStore()
    if (!store) return

    const history = await getHistoryIndex(store)
    for (const dateString of history.dates) {
      const entry = await getPuzzleEntry(store, dateString)
      if (!entry || !entry.puzzle) continue
      await dbSavePuzzleEntry(dateString, entry.puzzle, entry.generatedAt || new Date().toISOString())
    }
  })()

  try {
    await dbBackfillPromise
  } catch (error) {
    dbBackfillPromise = null
    throw error
  }
}

async function ensurePuzzleForDate(inputDate) {
  const dateString = toDateStringUTC(inputDate)

  if (hasDatabase()) {
    await maybeBackfillDbFromBlobs()

    const existing = await dbGetPuzzleEntry(dateString)
    if (existing && existing.puzzle) {
      return {
        date: dateString,
        puzzle: existing.puzzle,
        source: 'neon-history',
        generatedAt: existing.generatedAt || null,
        datasetSize: null,
        index: null,
      }
    }

    const usage = await dbGetUsage()
    const generated = getPuzzleForDateAvoidingUsage(dateString, usage)
    const generatedAt = new Date().toISOString()
    await dbSavePuzzleEntry(dateString, generated.puzzle, generatedAt)

    return {
      date: dateString,
      puzzle: generated.puzzle,
      source: generated.reuseExhausted ? 'neon-generated-overlap-fallback' : 'neon-generated',
      generatedAt,
      datasetSize: generated.datasetSize,
      index: generated.index,
      strategy: generated.strategy,
      reuseExhausted: generated.reuseExhausted,
      overlap: generated.overlap || 0,
    }
  }

  const store = getStore()

  if (!store) {
    const fallback = getPuzzleForDate(dateString)
    return {
      date: dateString,
      puzzle: fallback.puzzle,
      source: 'dataset-fallback-no-storage',
      generatedAt: null,
      datasetSize: fallback.datasetSize,
      index: fallback.index,
    }
  }

  const usage = await ensureUsageCatchUp(store)

  const existing = await getPuzzleEntry(store, dateString)
  if (existing && existing.puzzle) {
    return {
      date: dateString,
      puzzle: existing.puzzle,
      source: 'blobs-history',
      generatedAt: existing.generatedAt || null,
      datasetSize: null,
      index: null,
    }
  }

  const generated = getPuzzleForDateAvoidingUsage(dateString, usage)
  await savePuzzleEntry(store, dateString, generated.puzzle)

  return {
    date: dateString,
    puzzle: generated.puzzle,
    source: generated.reuseExhausted ? 'blobs-generated-overlap-fallback' : 'blobs-generated',
    generatedAt: new Date().toISOString(),
    datasetSize: generated.datasetSize,
    index: generated.index,
    strategy: generated.strategy,
    reuseExhausted: generated.reuseExhausted,
    overlap: generated.overlap || 0,
  }
}

async function getPuzzleForDateWithFallback(inputDate) {
  const dateString = toDateStringUTC(inputDate)

  if (hasDatabase()) {
    await maybeBackfillDbFromBlobs()

    const existing = await dbGetPuzzleEntry(dateString)
    if (existing && existing.puzzle) {
      return {
        date: dateString,
        puzzle: existing.puzzle,
        source: 'neon-history',
        generatedAt: existing.generatedAt || null,
        datasetSize: null,
        index: null,
      }
    }

    const fallback = getPuzzleForDate(dateString)
    return {
      date: dateString,
      puzzle: fallback.puzzle,
      source: 'dataset-fallback-miss',
      generatedAt: null,
      datasetSize: fallback.datasetSize,
      index: fallback.index,
    }
  }

  const store = getStore()
  if (!store) {
    const fallback = getPuzzleForDate(dateString)
    return {
      date: dateString,
      puzzle: fallback.puzzle,
      source: 'dataset-fallback-no-storage',
      generatedAt: null,
      datasetSize: fallback.datasetSize,
      index: fallback.index,
    }
  }

  const existing = await getPuzzleEntry(store, dateString)
  if (existing && existing.puzzle) {
    return {
      date: dateString,
      puzzle: existing.puzzle,
      source: 'blobs-history',
      generatedAt: existing.generatedAt || null,
      datasetSize: null,
      index: null,
    }
  }

  const fallback = getPuzzleForDate(dateString)
  return {
    date: dateString,
    puzzle: fallback.puzzle,
    source: 'dataset-fallback-miss',
    generatedAt: null,
    datasetSize: fallback.datasetSize,
    index: fallback.index,
  }
}

async function listPuzzleDates() {
  if (hasDatabase()) {
    await maybeBackfillDbFromBlobs()
    return await dbListPuzzleDates()
  }

  const store = getStore()
  if (!store) return []

  const index = await getHistoryIndex(store)
  return index.dates
}

module.exports = {
  hasBlobs,
  hasDatabase,
  toDateStringUTC,
  ensurePuzzleForDate,
  getPuzzleForDateWithFallback,
  listPuzzleDates,
}
