'use strict'

const { getPuzzleForDateWithoutGeneration, toDateStringUTC } = require('../../shared/puzzle-history')

function isValidDateParam(value) {
  if (value === undefined || value === null || value === '') return true
  if (typeof value !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  try {
    return toDateStringUTC(value) === value
  } catch (_error) {
    return false
  }
}

exports.handler = async function handler(event) {
  const startedAt = Date.now()
  const withTiming = (headers) => ({
    ...(headers || {}),
    'x-elapsed-ms': String(Date.now() - startedAt),
  })
  try {
    const date = event.queryStringParameters && event.queryStringParameters.date

    if (!isValidDateParam(date)) {
      return {
        statusCode: 400,
        headers: {
          ...withTiming({ 'content-type': 'application/json; charset=utf-8' }),
        },
        body: JSON.stringify({
          error: 'Invalid date parameter. Use YYYY-MM-DD.',
        }),
      }
    }

    const payload = await getPuzzleForDateWithoutGeneration(date)
    if (!payload || !payload.puzzle) {
      return {
        statusCode: 404,
        headers: {
          ...withTiming({ 'content-type': 'application/json; charset=utf-8' }),
        },
        body: JSON.stringify({
          error: 'No active puzzle available yet',
        }),
      }
    }

    return {
      statusCode: 200,
      headers: {
        ...withTiming({
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=300',
        }),
      },
      body: JSON.stringify(payload),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        ...withTiming({ 'content-type': 'application/json; charset=utf-8' }),
      },
      body: JSON.stringify({
        error: 'Failed to load daily puzzle',
        details: error && error.message ? error.message : String(error),
      }),
    }
  }
}
