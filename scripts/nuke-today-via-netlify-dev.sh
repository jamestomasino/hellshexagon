#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${1:-8899}"
GEN_OPTIONS="${DAILY_GENERATION_OPTIONS_OVERRIDE:-9}"
TMP_FN_PATH="netlify/functions/__tmp-nuke-today.js"
TMP_REGEN_FN_PATH="netlify/functions/__tmp-regenerate-today.js"
DEV_LOG="tmp/netlify-dev-nuke.log"
mkdir -p tmp

cleanup() {
  rm -f "$TMP_FN_PATH"
  rm -f "$TMP_REGEN_FN_PATH"
  if [[ -n "${DEV_PID:-}" ]]; then
    kill "$DEV_PID" >/dev/null 2>&1 || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cat > "$TMP_FN_PATH" <<'JS'
'use strict'

const { neon } = require('@netlify/neon')
const { toDateStringUTC } = require('../../shared/puzzle-history')

exports.handler = async function handler(event) {
  if (event && event.httpMethod && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  const date = event && event.queryStringParameters && event.queryStringParameters.date
    ? toDateStringUTC(event.queryStringParameters.date)
    : toDateStringUTC(new Date())

  const dbUrl = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL
  if (!dbUrl) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'DATABASE_URL is not configured' }),
    }
  }

  const sql = neon(dbUrl)
  const beforeRows = await sql`SELECT COUNT(*)::int AS count FROM hh_daily_puzzle WHERE date = ${date}`
  await sql`DELETE FROM hh_daily_puzzle WHERE date = ${date}`
  const afterRows = await sql`SELECT COUNT(*)::int AS count FROM hh_daily_puzzle WHERE date = ${date}`

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      date,
      deleted: Number(beforeRows[0] && beforeRows[0].count ? beforeRows[0].count : 0),
      remaining: Number(afterRows[0] && afterRows[0].count ? afterRows[0].count : 0),
    }),
  }
}
JS

cat > "$TMP_REGEN_FN_PATH" <<'JS'
'use strict'

const { ensurePuzzleForDate, toDateStringUTC } = require('../../shared/puzzle-history')

exports.handler = async function handler(event) {
  const date = event && event.queryStringParameters && event.queryStringParameters.date
    ? toDateStringUTC(event.queryStringParameters.date)
    : toDateStringUTC(new Date())

  const payload = await ensurePuzzleForDate(date)
  return {
    statusCode: 200,
    body: JSON.stringify(payload),
  }
}
JS

DAILY_GENERATION_OPTIONS="$GEN_OPTIONS" netlify dev --port "$PORT" >"$DEV_LOG" 2>&1 &
DEV_PID=$!

for _ in $(seq 1 60); do
  if curl -sS "http://127.0.0.1:${PORT}/.netlify/functions/__tmp-nuke-today" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if ! kill -0 "$DEV_PID" >/dev/null 2>&1; then
    echo "netlify dev exited unexpectedly; see $DEV_LOG" >&2
    exit 1
  fi
 done

TODAY="$(date -u +%F)"

NUKE_RAW="$(curl -sS -X POST "http://127.0.0.1:${PORT}/.netlify/functions/__tmp-nuke-today?date=${TODAY}")"
ROTATE_RAW="$(curl -sS "http://127.0.0.1:${PORT}/.netlify/functions/__tmp-regenerate-today?date=${TODAY}")"
DAILY_RAW="$(curl -sS "http://127.0.0.1:${PORT}/api/daily?date=${TODAY}")"

node -e "const tryParse=(text,label)=>{try{return JSON.parse(text)}catch(e){console.error('Failed to parse '+label+' response as JSON:'); console.error(text); process.exit(1)}}; const nuke=tryParse(process.argv[1],'nuke'); const rotate=tryParse(process.argv[2],'regenerate'); const daily=tryParse(process.argv[3],'daily'); console.log(JSON.stringify({today: process.argv[4], generationOptionsOverride: Number(process.argv[5]), nuke, regenerate: rotate, dailySummary: {date: daily.date, puzzleId: daily.puzzle && daily.puzzle.id, difficultyProfile: daily.puzzle && daily.puzzle.difficultyProfile, averageKnownness: daily.puzzle && daily.puzzle.averageKnownness, knownnessBand: daily.puzzle && daily.puzzle.knownnessBand}}, null, 2));" "$NUKE_RAW" "$ROTATE_RAW" "$DAILY_RAW" "$TODAY" "$GEN_OPTIONS"
