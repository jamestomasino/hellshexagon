'use strict'

const { listPuzzleDates, toDateStringUTC } = require('../../shared/puzzle-history')

exports.handler = async function handler() {
  try {
    const dates = await listPuzzleDates()
    const today = toDateStringUTC(new Date())
    const uniqueDates = Array.from(new Set([today, ...dates])).sort()

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
      body: JSON.stringify({
        dates: uniqueDates,
      }),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        error: 'Failed to list puzzle dates',
        details: error.message,
      }),
    }
  }
}
