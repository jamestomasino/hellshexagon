'use strict'

const { toDateStringUTC } = require('../../shared/puzzle-history')
const { submitFirstSuccessfulSolve, getScoreboardForDate } = require('../../shared/scoreboard-store')

const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX_ATTEMPTS_PER_UID = 10
const RATE_LIMIT_MAX_ATTEMPTS_PER_IP = 40
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

function getClientIp(event) {
  const headers = event && event.headers ? event.headers : {}
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || ''
  const first = String(forwarded)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)[0]
  return first || 'unknown-ip'
}

function checkRateLimit(anonUid, dateString, clientIp) {
  const now = Date.now()
  trimAttemptLog(now)
  const uidKey = `uid:${dateString}:${anonUid}`
  const ipKey = `ip:${dateString}:${clientIp}`
  const uidKept = (attemptLog.get(uidKey) || []).filter((time) => now - time <= RATE_LIMIT_WINDOW_MS)
  const ipKept = (attemptLog.get(ipKey) || []).filter((time) => now - time <= RATE_LIMIT_WINDOW_MS)

  if (uidKept.length >= RATE_LIMIT_MAX_ATTEMPTS_PER_UID || ipKept.length >= RATE_LIMIT_MAX_ATTEMPTS_PER_IP) {
    attemptLog.set(uidKey, uidKept)
    attemptLog.set(ipKey, ipKept)
    return {
      allowed: false,
      retryAfterSec: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
      scope: uidKept.length >= RATE_LIMIT_MAX_ATTEMPTS_PER_UID ? 'uid' : 'ip',
    }
  }

  uidKept.push(now)
  ipKept.push(now)
  attemptLog.set(uidKey, uidKept)
  attemptLog.set(ipKey, ipKept)
  return { allowed: true, retryAfterSec: 0, scope: null }
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
    const clientIp = getClientIp(event)

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

    const rate = checkRateLimit(anonUid, date, clientIp)
    if (!rate.allowed) {
      console.warn('[submit-score] rate limited', {
        date,
        anonUid,
        clientIp,
        scope: rate.scope,
      })
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
    console.error('[submit-score] failed', {
      error: error && error.message ? error.message : String(error),
      method: event && event.httpMethod ? event.httpMethod : 'unknown',
    })
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
