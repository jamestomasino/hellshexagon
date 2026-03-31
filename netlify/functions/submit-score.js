'use strict'

const { toDateStringUTC } = require('../../shared/puzzle-history')
const { submitFirstSuccessfulSolve, getScoreboardForDate } = require('../../shared/scoreboard-store')

const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX_ATTEMPTS = 12
const attemptLog = new Map()

function parsePositiveInt(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

function trimAttemptLog(nowMs) {
  for (const [key, timestamps] of attemptLog.entries()) {
    const kept = timestamps.filter((time) => nowMs - time <= RATE_LIMIT_WINDOW_MS)
    if (kept.length === 0) attemptLog.delete(key)
    else attemptLog.set(key, kept)
  }
}

function checkRateLimit(anonUid, dateString) {
  const now = Date.now()
  trimAttemptLog(now)
  const key = `${dateString}:${anonUid}`
  const existing = attemptLog.get(key) || []
  const kept = existing.filter((time) => now - time <= RATE_LIMIT_WINDOW_MS)
  if (kept.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    attemptLog.set(key, kept)
    return { allowed: false, retryAfterSec: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) }
  }
  kept.push(now)
  attemptLog.set(key, kept)
  return { allowed: true, retryAfterSec: 0 }
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

    const rate = checkRateLimit(anonUid, date)
    if (!rate.allowed) {
      return {
        statusCode: 429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': String(rate.retryAfterSec),
        },
        body: JSON.stringify({ error: 'Rate limit exceeded, try again shortly.' }),
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
