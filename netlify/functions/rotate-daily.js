'use strict'

const { connectLambda } = require('@netlify/blobs')
const { ensurePuzzleForDate, toDateStringUTC } = require('../../shared/puzzle-history')

exports.handler = async function handler(event) {
  if (event && event.blobs && typeof connectLambda === 'function') {
    connectLambda(event)
  }

  const today = toDateStringUTC(new Date())
  const payload = await ensurePuzzleForDate(today)

  console.log('[rotate-daily] Daily puzzle stored', {
    date: payload.date,
    puzzleId: payload.puzzle && payload.puzzle.id,
    source: payload.source,
    strategy: payload.strategy || 'deterministic-seed',
    overlap: payload.overlap || 0,
  })

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      date: payload.date,
      puzzleId: payload.puzzle && payload.puzzle.id,
      source: payload.source,
      strategy: payload.strategy || 'deterministic-seed',
      overlap: payload.overlap || 0,
    }),
  }
}
