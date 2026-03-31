#!/usr/bin/env node
'use strict'

const { getStore } = require('@netlify/blobs')
const { Pool } = require('pg')

const DEFAULT_STORE_NAME = process.env.PUZZLE_STORE_NAME || 'hells-hexagon-puzzles'
const DB_TABLE_DAILY = 'hh_daily_puzzle'

function parseArgs(argv) {
  const args = {
    store: DEFAULT_STORE_NAME,
    dryRun: false,
    onlyMissing: false,
    limit: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--store' && argv[i + 1]) {
      args.store = argv[i + 1]
      i += 1
    } else if (arg === '--dry-run') {
      args.dryRun = true
    } else if (arg === '--only-missing') {
      args.onlyMissing = true
    } else if (arg === '--limit' && argv[i + 1]) {
      const parsed = Number(argv[i + 1])
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value: ${argv[i + 1]}`)
      }
      args.limit = Math.floor(parsed)
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/migrate-blobs-to-neon.js [options]\n\nOptions:\n  --store <name>       Blob store name (default: ${DEFAULT_STORE_NAME})\n  --only-missing       Skip rows that already exist in Neon\n  --limit <n>          Migrate only first n dates from history index\n  --dry-run            Read and validate only, do not write to Neon\n  --help               Show this message\n`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
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

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const databaseUrl = requireEnv('DATABASE_URL', process.env.DATABASE_URL)
  const siteID = requireEnv('NETLIFY_SITE_ID or SITE_ID', process.env.NETLIFY_SITE_ID || process.env.SITE_ID)
  const token = requireEnv(
    'NETLIFY_BLOBS_TOKEN (or BLOBS_TOKEN/NETLIFY_AUTH_TOKEN/NETLIFY_TOKEN/NETLIFY_API_TOKEN)',
    process.env.NETLIFY_BLOBS_TOKEN ||
      process.env.BLOBS_TOKEN ||
      process.env.NETLIFY_AUTH_TOKEN ||
      process.env.NETLIFY_TOKEN ||
      process.env.NETLIFY_API_TOKEN,
  )

  const store = getStore({ name: args.store, siteID, token })
  const pool = new Pool({ connectionString: databaseUrl, max: 4 })

  try {
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
      throw new Error('No blob history dates found (index and list both empty)')
    }

    const targetDates = args.limit ? allDates.slice(0, args.limit) : allDates

    await ensureDbSchema(pool)
    const existingDates = args.onlyMissing ? await getExistingDates(pool) : new Set()

    console.log('[migrate] starting', {
      store: args.store,
      indexDates: indexDates.length,
      listedDates: listedDates.length,
      allDates: allDates.length,
      targetDates: targetDates.length,
      dryRun: args.dryRun,
      onlyMissing: args.onlyMissing,
    })

    let migrated = 0
    let skippedMissing = 0
    let skippedExisting = 0
    let invalidEntries = 0

    for (const dateString of targetDates) {
      if (args.onlyMissing && existingDates.has(dateString)) {
        skippedExisting += 1
        continue
      }

      const entry = await store.get(`history/${dateString}`, { type: 'json' })
      if (!entry || !entry.puzzle) {
        skippedMissing += 1
        continue
      }

      if (typeof entry !== 'object' || typeof entry.date !== 'string') {
        invalidEntries += 1
        continue
      }

      if (!args.dryRun) {
        await upsertDailyRow(pool, dateString, entry.puzzle, entry.generatedAt || new Date().toISOString())
      }

      migrated += 1
    }

    const summaryRes = await pool.query(
      `SELECT COUNT(*)::INT AS count, MIN(date) AS first_date, MAX(date) AS last_date FROM ${DB_TABLE_DAILY}`,
    )
    const summary = summaryRes.rows[0] || { count: 0, first_date: null, last_date: null }

    console.log('[migrate] done', {
      migrated,
      skippedMissing,
      skippedExisting,
      invalidEntries,
      dbCount: Number(summary.count || 0),
      dbFirstDate: summary.first_date,
      dbLastDate: summary.last_date,
    })
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error('[migrate] failed', {
    message: error && error.message ? error.message : String(error),
  })
  process.exit(1)
})
