'use strict'

const { getPuzzleForDate } = require('../../shared/daily-puzzle')

exports.handler = async function handler() {
  const payload = getPuzzleForDate(new Date())

  console.log('[rotate-daily] Daily puzzle ready', {
    date: payload.date,
    puzzleId: payload.puzzle.id,
    index: payload.index,
    datasetSize: payload.datasetSize,
  })

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      date: payload.date,
      puzzleId: payload.puzzle.id,
    }),
  }
}

exports.config = {
  schedule: '@daily',
}
