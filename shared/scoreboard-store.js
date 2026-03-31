'use strict'

const { neon } = require('@netlify/neon')

const DB_TABLE_SCORE = 'hh_daily_solve_score'

let sqlClient = null
let schemaReadyPromise = null

function getSql() {
  if (sqlClient) return sqlClient
  if (!process.env.NETLIFY_DATABASE_URL && !process.env.DATABASE_URL) {
    throw new Error('Missing NETLIFY_DATABASE_URL (or DATABASE_URL) for score storage')
  }
  sqlClient = neon()
  return sqlClient
}

async function ensureSchema() {
  if (schemaReadyPromise) return schemaReadyPromise

  schemaReadyPromise = (async () => {
    const sql = getSql()
    await sql`
      CREATE TABLE IF NOT EXISTS hh_daily_solve_score (
        id BIGSERIAL PRIMARY KEY,
        puzzle_date TEXT NOT NULL,
        anon_uid TEXT NOT NULL,
        total_nodes INTEGER NOT NULL,
        total_links INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (puzzle_date, anon_uid)
      )
    `

    await sql`
      CREATE INDEX IF NOT EXISTS idx_hh_daily_solve_score_date_nodes
      ON hh_daily_solve_score (puzzle_date, total_nodes)
    `
  })()

  try {
    await schemaReadyPromise
  } catch (error) {
    schemaReadyPromise = null
    throw error
  }
}

async function getScoreboardForDate(dateString) {
  await ensureSchema()
  const sql = getSql()

  const summaryRows = await sql`
    SELECT COUNT(*)::INT AS solves, MIN(total_nodes)::INT AS shortest_chain
    FROM hh_daily_solve_score
    WHERE puzzle_date = ${dateString}
  `
  const summary = summaryRows[0] || { solves: 0, shortest_chain: null }

  const histogramRows = await sql`
    SELECT total_nodes::INT AS nodes, COUNT(*)::INT AS count
    FROM hh_daily_solve_score
    WHERE puzzle_date = ${dateString}
    GROUP BY total_nodes
    ORDER BY total_nodes ASC
  `

  return {
    date: dateString,
    solves: Number(summary.solves || 0),
    shortestChain: summary.shortest_chain == null ? null : Number(summary.shortest_chain),
    histogram: histogramRows.map((row) => ({
      nodes: Number(row.nodes),
      count: Number(row.count),
    })),
  }
}

async function submitFirstSuccessfulSolve(input) {
  const dateString = input.date
  const anonUid = input.anonUid
  const totalNodes = Number(input.totalNodes)
  const totalLinks = Number(input.totalLinks)

  await ensureSchema()
  const sql = getSql()

  const rows = await sql`
    INSERT INTO hh_daily_solve_score (puzzle_date, anon_uid, total_nodes, total_links)
    VALUES (${dateString}, ${anonUid}, ${totalNodes}, ${totalLinks})
    ON CONFLICT (puzzle_date, anon_uid) DO NOTHING
    RETURNING id
  `

  return {
    accepted: rows.length > 0,
  }
}

module.exports = {
  DB_TABLE_SCORE,
  ensureSchema,
  getScoreboardForDate,
  submitFirstSuccessfulSolve,
}
