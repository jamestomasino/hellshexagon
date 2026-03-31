'use strict'

const { connectLambda, getStore } = require('@netlify/blobs')
const { Pool } = require('pg')

const DB_TABLE_DAILY = 'hh_daily_puzzle'

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue
  const normalized = String(value).toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return defaultValue
}

function parseLimit(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.floor(parsed)
}

async function ensureDbSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${DB_TABLE_DAILY} (
      date TEXT PRIMARY KEY,
      puzzle JSONB NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1
    )
  `)
}

async function getExistingDates(pool) {
  const res = await pool.query(`SELECT date FROM ${DB_TABLE_DAILY}`)
  return new Set(res.rows.map((row) => row.date))
}

async function upsertDailyRow(pool, dateString, puzzle, generatedAtISO) {
  await pool.query(
    `
    INSERT INTO ${DB_TABLE_DAILY} (date, puzzle, generated_at, version)
    VALUES ($1, $2::jsonb, $3::timestamptz, 1)
    ON CONFLICT (date)
    DO UPDATE SET puzzle = EXCLUDED.puzzle, generated_at = EXCLUDED.generated_at, version = EXCLUDED.version
    `,
    [dateString, JSON.stringify(puzzle), generatedAtISO || new Date().toISOString()],
  )
}

exports.handler = async function handler(event) {
  const startedAt = Date.now()

  try {
    if (event && event.blobs && typeof connectLambda === 'function') {
      connectLambda(event)
    }

    const method = event && event.httpMethod ? event.httpMethod.toUpperCase() : 'GET'
    if (method !== 'POST' && method !== 'GET') {
      return {
        statusCode: 405,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'Method not allowed' }),
      }
    }

    const params = (event && event.queryStringParameters) || {}
    const storeName = params.store || process.env.PUZZLE_STORE_NAME || 'hells-hexagon-puzzles'
    const dryRun = parseBoolean(params.dryRun, true)
    const onlyMissing = parseBoolean(params.onlyMissing, true)
    const limit = parseLimit(params.limit)

    const store = getStore(storeName)
    const index = await store.get('history/index', { type: 'json' })
    const indexDates = Array.isArray(index && index.dates) ? Array.from(new Set(index.dates)).sort() : []
    const listed = await store.list({ prefix: 'history/' })
    const listedDates = (listed.blobs || [])
      .map((blob) => (blob && typeof blob.key === 'string' ? blob.key : null))
      .filter((key) => key && /^history\/\d{4}-\d{2}-\d{2}$/.test(key))
      .map((key) => key.slice('history/'.length))
      .sort()
    const allDates = Array.from(new Set([...indexDates, ...listedDates])).sort()

    if (allDates.length === 0) {
      return {
        statusCode: 404,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'No blob history dates found', store: storeName }),
      }
    }

    const targetDates = limit ? allDates.slice(0, limit) : allDates

    if (!process.env.DATABASE_URL) {
      return {
        statusCode: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'DATABASE_URL is not configured' }),
      }
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 })

    try {
      await ensureDbSchema(pool)
      const existingDates = onlyMissing ? await getExistingDates(pool) : new Set()

      let migrated = 0
      let skippedExisting = 0
      let skippedMissingBlobEntry = 0
      let invalidEntries = 0

      for (const dateString of targetDates) {
        if (onlyMissing && existingDates.has(dateString)) {
          skippedExisting += 1
          continue
        }

        const entry = await store.get(`history/${dateString}`, { type: 'json' })
        if (!entry || !entry.puzzle) {
          skippedMissingBlobEntry += 1
          continue
        }

        if (typeof entry !== 'object' || typeof entry.date !== 'string') {
          invalidEntries += 1
          continue
        }

        if (!dryRun) {
          await upsertDailyRow(pool, dateString, entry.puzzle, entry.generatedAt || new Date().toISOString())
        }

        migrated += 1
      }

      const summaryRes = await pool.query(
        `SELECT COUNT(*)::INT AS count, MIN(date) AS first_date, MAX(date) AS last_date FROM ${DB_TABLE_DAILY}`,
      )
      const summary = summaryRes.rows[0] || { count: 0, first_date: null, last_date: null }

      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          ok: true,
          mode: dryRun ? 'dry-run' : 'apply',
          store: storeName,
          indexDates: indexDates.length,
          listedDates: listedDates.length,
          allDates: allDates.length,
          targetDates: targetDates.length,
          latestBlobDates: allDates.slice(-3),
          migrated,
          skippedExisting,
          skippedMissingBlobEntry,
          invalidEntries,
          dbCount: Number(summary.count || 0),
          dbFirstDate: summary.first_date,
          dbLastDate: summary.last_date,
          elapsedMs: Date.now() - startedAt,
        }),
      }
    } finally {
      await pool.end()
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        ok: false,
        error: error && error.message ? error.message : String(error),
      }),
    }
  }
}
