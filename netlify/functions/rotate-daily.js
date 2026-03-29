'use strict'

const { ensurePuzzleForDate, toDateStringUTC } = require('../../shared/puzzle-history')

exports.handler = async function handler() {
  const today = toDateStringUTC(new Date())
  const payload = await ensurePuzzleForDate(today)

  console.log('[rotate-daily] Daily puzzle stored', {
    date: payload.date,
    puzzleId: payload.puzzle && payload.puzzle.id,
    source: payload.source,
  })

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      date: payload.date,
      puzzleId: payload.puzzle && payload.puzzle.id,
      source: payload.source,
    }),
  }
}
