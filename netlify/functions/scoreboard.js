'use strict'

const { toDateStringUTC } = require('../../shared/puzzle-history')
const { getScoreboardForDate } = require('../../shared/scoreboard-store')

exports.handler = async function handler(event) {
  try {
    const params = event && event.queryStringParameters ? event.queryStringParameters : {}
    const date = toDateStringUTC(params.date)
    const scoreboard = await getScoreboardForDate(date)

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=60, s-maxage=120',
      },
      body: JSON.stringify(scoreboard),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'Failed to load scoreboard',
        details: error && error.message ? error.message : String(error),
      }),
    }
  }
}
