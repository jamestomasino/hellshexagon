'use strict'

const { neon } = require('@netlify/neon')
const { getPuzzleForDate, getPuzzleForDateAvoidingUsage } = require('./daily-puzzle')

let sqlClient = null
let dbSchemaReadyPromise = null

function hasDatabase() {
  return Boolean(process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL)
}

function getSql() {
  if (!hasDatabase()) return null
  if (sqlClient) return sqlClient
  sqlClient = neon()
  return sqlClient
}

async function ensureDbSchema() {
  const sql = getSql()
  if (!sql) return
  if (dbSchemaReadyPromise) return dbSchemaReadyPromise

  dbSchemaReadyPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS hh_daily_puzzle (
        date TEXT PRIMARY KEY,
        puzzle JSONB NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        version INTEGER NOT NULL DEFAULT 1
      )
    `
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
  const sql = getSql()
  const rows = await sql`
    SELECT date, puzzle, generated_at
    FROM hh_daily_puzzle
    WHERE date = ${dateString}
  `

  if (!rows[0]) return null
  return {
    date: rows[0].date,
    puzzle: rows[0].puzzle,
    generatedAt: rows[0].generated_at ? new Date(rows[0].generated_at).toISOString() : null,
  }
}

async function dbSavePuzzleEntry(dateString, puzzle, generatedAtISO) {
  await ensureDbSchema()
  const sql = getSql()
  await sql`
    INSERT INTO hh_daily_puzzle (date, puzzle, generated_at, version)
    VALUES (${dateString}, ${JSON.stringify(puzzle)}::jsonb, ${generatedAtISO || new Date().toISOString()}::timestamptz, 1)
    ON CONFLICT (date)
    DO UPDATE SET puzzle = EXCLUDED.puzzle, generated_at = EXCLUDED.generated_at, version = EXCLUDED.version
  `
}

async function dbListPuzzleDates() {
  await ensureDbSchema()
  const sql = getSql()
  const rows = await sql`
    SELECT date
    FROM hh_daily_puzzle
    ORDER BY date ASC
  `
  return rows.map((row) => row.date)
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
  const sql = getSql()
  const rows = await sql`SELECT puzzle FROM hh_daily_puzzle`

  const usage = {
    filmIds: [],
    actorIds: [],
    rebuiltFromDates: rows.length,
  }

  for (const row of rows) {
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
