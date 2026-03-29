'use strict'

const { connectLambda } = require('@netlify/blobs')
const { getPuzzleForDateWithFallback } = require('../../shared/puzzle-history')

exports.handler = async function handler(event) {
  try {
    if (event && event.blobs && typeof connectLambda === 'function') {
      connectLambda(event)
    }

    const date = event.queryStringParameters && event.queryStringParameters.date
    const payload = await getPuzzleForDateWithFallback(date)

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
      body: JSON.stringify(payload),
    }
  } catch (error) {
    return {
      statusCode: 400,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        error: 'Failed to load daily puzzle',
        details: error.message,
      }),
    }
  }
}
