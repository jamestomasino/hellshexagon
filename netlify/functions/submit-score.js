'use strict'

const { toDateStringUTC } = require('../../shared/puzzle-history')
const { submitFirstSuccessfulSolve, getScoreboardForDate } = require('../../shared/scoreboard-store')

function parsePositiveInt(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

exports.handler = async function handler(event) {
  try {
    const method = event && event.httpMethod ? event.httpMethod.toUpperCase() : 'GET'
    if (method !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'Method not allowed' }),
      }
    }

    let body = {}
    try {
      body = event && event.body ? JSON.parse(event.body) : {}
    } catch (_error) {
      body = {}
    }

    const date = toDateStringUTC(body.date)
    const anonUid = typeof body.anonUid === 'string' ? body.anonUid.trim() : ''
    const totalNodes = parsePositiveInt(body.totalNodes)
    const totalLinks = parsePositiveInt(body.totalLinks)

    if (!anonUid) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'Missing anonUid' }),
      }
    }

    if (!totalNodes || !totalLinks) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'Missing totalNodes/totalLinks' }),
      }
    }

    const result = await submitFirstSuccessfulSolve({
      date,
      anonUid,
      totalNodes,
      totalLinks,
    })

    const scoreboard = await getScoreboardForDate(date)

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        ok: true,
        accepted: result.accepted,
        scoreboard,
      }),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'Failed to submit score',
        details: error && error.message ? error.message : String(error),
      }),
    }
  }
}
