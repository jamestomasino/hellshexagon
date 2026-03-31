'use strict'

const { Pool } = require('pg')
const { getPuzzleForDate, getPuzzleForDateAvoidingUsage } = require('./daily-puzzle')

const DB_TABLE_DAILY = 'hh_daily_puzzle'

let dbPool = null
let dbSchemaReadyPromise = null

function hasDatabase() {
  return Boolean(process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL)
}

function getDbPool() {
  if (!hasDatabase()) return null
  if (dbPool) return dbPool

  dbPool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL,
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

async function ensurePuzzleForDate(inputDate) {
  const dateString = toDateStringUTC(inputDate)

  if (!hasDatabase()) {
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

async function getPuzzleForDateWithFallback(inputDate) {
  const dateString = toDateStringUTC(inputDate)

  if (!hasDatabase()) {
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

async function listPuzzleDates() {
  if (!hasDatabase()) return []
  return await dbListPuzzleDates()
}

module.exports = {
  hasDatabase,
  toDateStringUTC,
  ensurePuzzleForDate,
  getPuzzleForDateWithFallback,
  listPuzzleDates,
}
