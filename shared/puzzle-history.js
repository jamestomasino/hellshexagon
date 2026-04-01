'use strict'

const { neon } = require('@netlify/neon')
const {
  getPuzzleForDate,
  getPuzzleForDateAvoidingUsage,
  createRandomGenerationSeed,
  getTargetFlamesForDate,
  getTargetDifficultyScoreForDate,
  getTargetKnownnessForFlames,
  knownnessToFlames,
  knownnessToDifficultyScore,
} = require('./daily-puzzle')

let sqlClient = null
let dbSchemaReadyPromise = null

function hasDatabase() {
  return Boolean(process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL)
}

function getSql() {
  if (!hasDatabase()) return null
  if (sqlClient) return sqlClient
  sqlClient = neon()
  return sqlClient
}

async function ensureDbSchema() {
  const sql = getSql()
  if (!sql) return
  if (dbSchemaReadyPromise) return dbSchemaReadyPromise

  dbSchemaReadyPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS hh_daily_puzzle (
        date TEXT PRIMARY KEY,
        puzzle JSONB NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        version INTEGER NOT NULL DEFAULT 1
      )
    `
  })()

  try {
    await dbSchemaReadyPromise
  } catch (error) {
    dbSchemaReadyPromise = null
    throw error
  }
}

function toDateStringUTC(input) {
  if (input === undefined || input === null || input === '') {
    return new Date().toISOString().slice(0, 10)
  }

  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date input: ${input}`)
  }

  return parsed.toISOString().slice(0, 10)
}

async function dbGetPuzzleEntry(dateString) {
  await ensureDbSchema()
  const sql = getSql()
  const rows = await sql`
    SELECT date, puzzle, generated_at
    FROM hh_daily_puzzle
    WHERE date = ${dateString}
  `

  if (!rows[0]) return null
  return {
    date: rows[0].date,
    puzzle: rows[0].puzzle,
    generatedAt: rows[0].generated_at ? new Date(rows[0].generated_at).toISOString() : null,
  }
}

async function dbSavePuzzleEntry(dateString, puzzle, generatedAtISO) {
  await ensureDbSchema()
  const sql = getSql()
  await sql`
    INSERT INTO hh_daily_puzzle (date, puzzle, generated_at, version)
    VALUES (${dateString}, ${JSON.stringify(puzzle)}::jsonb, ${generatedAtISO || new Date().toISOString()}::timestamptz, 1)
    ON CONFLICT (date)
    DO UPDATE SET puzzle = EXCLUDED.puzzle, generated_at = EXCLUDED.generated_at, version = EXCLUDED.version
  `
}

async function dbListPuzzleDates() {
  await ensureDbSchema()
  const sql = getSql()
  const rows = await sql`
    SELECT date
    FROM hh_daily_puzzle
    ORDER BY date ASC
  `
  return rows.map((row) => row.date)
}

async function dbGetLatestPuzzleEntryOnOrBefore(dateString) {
  await ensureDbSchema()
  const sql = getSql()
  const rows = await sql`
    SELECT date, puzzle, generated_at
    FROM hh_daily_puzzle
    WHERE date <= ${dateString}
    ORDER BY date DESC
    LIMIT 1
  `
  if (!rows[0]) return null
  return {
    date: rows[0].date,
    puzzle: rows[0].puzzle,
    generatedAt: rows[0].generated_at ? new Date(rows[0].generated_at).toISOString() : null,
  }
}

async function dbGetLatestPuzzleEntry() {
  await ensureDbSchema()
  const sql = getSql()
  const rows = await sql`
    SELECT date, puzzle, generated_at
    FROM hh_daily_puzzle
    ORDER BY date DESC
    LIMIT 1
  `
  if (!rows[0]) return null
  return {
    date: rows[0].date,
    puzzle: rows[0].puzzle,
    generatedAt: rows[0].generated_at ? new Date(rows[0].generated_at).toISOString() : null,
  }
}

function addDaysToDateStringUTC(dateString, deltaDays) {
  const d = new Date(`${dateString}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

function mergePuzzleIntoUsage(usage, puzzle) {
  const filmIds = new Set(usage.filmIds || [])
  const actorIds = new Set(usage.actorIds || [])

  for (const film of puzzle.films || []) {
    if (typeof film.id === 'number') filmIds.add(film.id)
  }
  for (const actor of puzzle.actors || []) {
    if (typeof actor.id === 'number') actorIds.add(actor.id)
  }

  return {
    filmIds: Array.from(filmIds),
    actorIds: Array.from(actorIds),
    rebuiltFromDates: usage.rebuiltFromDates,
  }
}

function parseOptionCount() {
  const parsed = Number(process.env.DAILY_GENERATION_OPTIONS || 9)
  if (!Number.isFinite(parsed)) return 9
  return Math.max(1, Math.min(32, Math.floor(parsed)))
}

function parseRotateAttemptsPerPass() {
  const parsed = Number(process.env.ROTATE_ATTEMPTS_PER_PASS || 24)
  if (!Number.isFinite(parsed)) return 24
  return Math.max(12, Math.min(300, Math.floor(parsed)))
}

function parseRotateMaxRelaxationPass() {
  const parsed = Number(process.env.ROTATE_MAX_RELAXATION_PASS || 3)
  if (!Number.isFinite(parsed)) return 3
  return Math.max(0, Math.min(5, Math.floor(parsed)))
}

function compareGenerationOptions(a, b) {
  if (a.flameDelta !== b.flameDelta) return a.flameDelta - b.flameDelta
  if (a.scoreDelta !== b.scoreDelta) return a.scoreDelta - b.scoreDelta
  if (a.relaxationPass !== b.relaxationPass) return a.relaxationPass - b.relaxationPass
  if (a.overlap !== b.overlap) return a.overlap - b.overlap
  if (a.knownnessDelta !== b.knownnessDelta) return a.knownnessDelta - b.knownnessDelta
  if (a.distanceScore !== b.distanceScore) return b.distanceScore - a.distanceScore
  if (a.seed < b.seed) return -1
  if (a.seed > b.seed) return 1
  return 0
}

function scoreGenerationOption(targetFlames, targetDifficultyScore, targetKnownness, entry) {
  const averageKnownness = Number.isFinite(entry.generated.averageKnownness) ? entry.generated.averageKnownness : 0
  const estimatedFlames = knownnessToFlames(averageKnownness)
  const estimatedDifficultyScore = knownnessToDifficultyScore(averageKnownness)
  const relaxationPass = entry.generated.selectedProfile && Number.isInteger(entry.generated.selectedProfile.relaxationPass)
    ? entry.generated.selectedProfile.relaxationPass
    : 99
  const overlap = Number.isFinite(entry.generated.overlap) ? entry.generated.overlap : 0
  const distanceScore = Number.isFinite(entry.generated.distanceScore) ? entry.generated.distanceScore : 0
  return {
    ...entry,
    averageKnownness,
    estimatedFlames,
    estimatedDifficultyScore,
    scoreDelta: Math.abs(targetDifficultyScore - estimatedDifficultyScore),
    flameDelta: Math.abs(targetFlames - estimatedFlames),
    knownnessDelta: Math.abs(targetKnownness - averageKnownness),
    relaxationPass,
    overlap,
    distanceScore,
  }
}

function isGoodEnoughGenerationOption(scored) {
  if (!scored) return false
  return scored.flameDelta === 0 && scored.relaxationPass === 0 && scored.overlap === 0
}

function chooseBestGenerationOption(targetFlames, targetDifficultyScore, scoredOptions) {
  if (!Array.isArray(scoredOptions) || scoredOptions.length === 0) {
    throw new Error('Unable to generate any puzzle options')
  }

  const scored = [...scoredOptions].sort(compareGenerationOptions)
  const selected = scored[0]
  selected.generated.selectionByDifficulty = {
    targetFlames,
    targetDifficultyScore: Number(targetDifficultyScore.toFixed(3)),
    estimatedDifficultyScore: Number(selected.estimatedDifficultyScore.toFixed(3)),
    estimatedFlames: selected.estimatedFlames,
    optionsEvaluated: scored.length,
    chosenSeed: selected.seed,
  }
  return selected
}

async function dbGetUsage(targetDateString) {
  await ensureDbSchema()
  const sql = getSql()
  const target = toDateStringUTC(targetDateString)
  const windowStart = addDaysToDateStringUTC(target, -183)
  const rows = await sql`
    SELECT puzzle
    FROM hh_daily_puzzle
    WHERE date >= ${windowStart} AND date < ${target}
  `

  const usage = {
    filmIds: [],
    actorIds: [],
    rebuiltFromDates: rows.length,
    windowStart,
    windowEndExclusive: target,
  }

  for (const row of rows) {
    if (!row || !row.puzzle) continue
    const merged = mergePuzzleIntoUsage(usage, row.puzzle)
    usage.filmIds = merged.filmIds
    usage.actorIds = merged.actorIds
  }

  return usage
}

async function ensurePuzzleForDate(inputDate) {
  const dateString = toDateStringUTC(inputDate)

  if (!hasDatabase()) {
    const generated = getPuzzleForDate(dateString)
    const targetFlames = getTargetFlamesForDate(dateString)
    const estimatedFlames = knownnessToFlames(generated.averageKnownness)
    return {
      date: dateString,
      puzzle: generated.puzzle,
      source: 'catalog-generated-no-storage',
      generatedAt: null,
      strategy: generated.strategy || null,
      difficultyProfile: generated.selectedProfile ? generated.selectedProfile.name : null,
      knownnessBand: generated.knownnessBand || null,
      distanceScore: Number.isFinite(generated.distanceScore) ? generated.distanceScore : null,
      averageKnownness: Number.isFinite(generated.averageKnownness) ? generated.averageKnownness : null,
      targetDifficultyFlames: targetFlames,
      estimatedDifficultyFlames: estimatedFlames,
      relaxationPass: generated.selectedProfile && Number.isInteger(generated.selectedProfile.relaxationPass)
        ? generated.selectedProfile.relaxationPass
        : null,
    }
  }

  const existing = await dbGetPuzzleEntry(dateString)
  if (existing && existing.puzzle) {
    return {
      date: dateString,
      puzzle: existing.puzzle,
      source: 'neon-history',
      generatedAt: existing.generatedAt || null,
    }
  }

  const usage = await dbGetUsage(dateString)
  const optionCount = parseOptionCount()
  const attemptsPerPass = parseRotateAttemptsPerPass()
  const maxRelaxationPass = parseRotateMaxRelaxationPass()
  const targetFlames = getTargetFlamesForDate(dateString)
  const targetDifficultyScore = getTargetDifficultyScoreForDate(dateString)
  const targetKnownness = getTargetKnownnessForFlames(targetFlames)
  const scoredOptions = []
  for (let i = 0; i < optionCount; i += 1) {
    const seed = createRandomGenerationSeed(dateString)
    const generated = getPuzzleForDateAvoidingUsage(dateString, usage, {
      seed,
      attemptsPerPass,
      maxRelaxationPass,
    })
    const scored = scoreGenerationOption(targetFlames, targetDifficultyScore, targetKnownness, { seed, generated })
    scoredOptions.push(scored)
    if (isGoodEnoughGenerationOption(scored)) break
  }
  const selected = chooseBestGenerationOption(targetFlames, targetDifficultyScore, scoredOptions)
  const generated = selected.generated
  const generationSeed = selected.seed
  const generatedAt = new Date().toISOString()
  await dbSavePuzzleEntry(dateString, generated.puzzle, generatedAt)

  return {
    date: dateString,
    puzzle: generated.puzzle,
    source: generated.reuseExhausted ? 'neon-generated-overlap-fallback' : 'neon-generated',
    generatedAt,
    strategy: generated.strategy,
    reuseExhausted: generated.reuseExhausted,
    overlap: generated.overlap || 0,
    difficultyProfile: generated.selectedProfile ? generated.selectedProfile.name : null,
    knownnessBand: generated.knownnessBand || null,
    distanceScore: Number.isFinite(generated.distanceScore) ? generated.distanceScore : null,
    averageKnownness: Number.isFinite(generated.averageKnownness) ? generated.averageKnownness : null,
    targetDifficultyFlames: generated.selectionByDifficulty
      ? generated.selectionByDifficulty.targetFlames
      : getTargetFlamesForDate(dateString),
    estimatedDifficultyFlames: generated.selectionByDifficulty
      ? generated.selectionByDifficulty.estimatedFlames
      : knownnessToFlames(generated.averageKnownness),
    targetDifficultyScore: generated.selectionByDifficulty
      ? generated.selectionByDifficulty.targetDifficultyScore
      : Number(targetDifficultyScore.toFixed(3)),
    estimatedDifficultyScore: generated.selectionByDifficulty
      ? generated.selectionByDifficulty.estimatedDifficultyScore
      : Number(knownnessToDifficultyScore(generated.averageKnownness).toFixed(3)),
    relaxationPass: generated.selectedProfile && Number.isInteger(generated.selectedProfile.relaxationPass)
      ? generated.selectedProfile.relaxationPass
      : null,
    generationSeed,
    generationOptionsEvaluated: generated.selectionByDifficulty
      ? generated.selectionByDifficulty.optionsEvaluated
      : scoredOptions.length,
  }
}

async function getPuzzleForDateWithFallback(inputDate) {
  const dateString = toDateStringUTC(inputDate)

  if (!hasDatabase()) {
    const generated = getPuzzleForDate(dateString)
    const targetFlames = getTargetFlamesForDate(dateString)
    const estimatedFlames = knownnessToFlames(generated.averageKnownness)
    return {
      date: dateString,
      puzzle: generated.puzzle,
      source: 'catalog-generated-no-storage',
      generatedAt: null,
      strategy: generated.strategy || null,
      difficultyProfile: generated.selectedProfile ? generated.selectedProfile.name : null,
      knownnessBand: generated.knownnessBand || null,
      distanceScore: Number.isFinite(generated.distanceScore) ? generated.distanceScore : null,
      averageKnownness: Number.isFinite(generated.averageKnownness) ? generated.averageKnownness : null,
      targetDifficultyFlames: targetFlames,
      estimatedDifficultyFlames: estimatedFlames,
      relaxationPass: generated.selectedProfile && Number.isInteger(generated.selectedProfile.relaxationPass)
        ? generated.selectedProfile.relaxationPass
        : null,
    }
  }

  const existing = await dbGetPuzzleEntry(dateString)
  if (existing && existing.puzzle) {
    return {
      date: dateString,
      puzzle: existing.puzzle,
      source: 'neon-history',
      generatedAt: existing.generatedAt || null,
    }
  }
  return await ensurePuzzleForDate(dateString)
}

async function getPuzzleForDateWithoutGeneration(inputDate) {
  const requestedDate = toDateStringUTC(inputDate)
  const today = toDateStringUTC(new Date())
  const targetDate = requestedDate > today ? today : requestedDate

  if (!hasDatabase()) {
    const generated = getPuzzleForDate(targetDate)
    const targetFlames = getTargetFlamesForDate(targetDate)
    const estimatedFlames = knownnessToFlames(generated.averageKnownness)
    return {
      date: targetDate,
      puzzle: generated.puzzle,
      source: 'catalog-generated-no-storage',
      generatedAt: null,
      strategy: generated.strategy || null,
      difficultyProfile: generated.selectedProfile ? generated.selectedProfile.name : null,
      knownnessBand: generated.knownnessBand || null,
      distanceScore: Number.isFinite(generated.distanceScore) ? generated.distanceScore : null,
      averageKnownness: Number.isFinite(generated.averageKnownness) ? generated.averageKnownness : null,
      targetDifficultyFlames: targetFlames,
      estimatedDifficultyFlames: estimatedFlames,
      relaxationPass: generated.selectedProfile && Number.isInteger(generated.selectedProfile.relaxationPass)
        ? generated.selectedProfile.relaxationPass
        : null,
      requestedDate,
      redirected: targetDate !== requestedDate,
    }
  }

  const exact = await dbGetPuzzleEntry(targetDate)
  if (exact && exact.puzzle) {
    return {
      date: exact.date,
      puzzle: exact.puzzle,
      source: 'neon-history',
      generatedAt: exact.generatedAt || null,
      requestedDate,
      redirected: exact.date !== requestedDate,
    }
  }

  const prior = await dbGetLatestPuzzleEntryOnOrBefore(targetDate)
  if (prior && prior.puzzle) {
    return {
      date: prior.date,
      puzzle: prior.puzzle,
      source: 'neon-history-fallback-latest-active',
      generatedAt: prior.generatedAt || null,
      requestedDate,
      redirected: prior.date !== requestedDate,
    }
  }

  const latest = await dbGetLatestPuzzleEntry()
  if (latest && latest.puzzle) {
    return {
      date: latest.date,
      puzzle: latest.puzzle,
      source: 'neon-history-fallback-latest-any',
      generatedAt: latest.generatedAt || null,
      requestedDate,
      redirected: latest.date !== requestedDate,
    }
  }

  return null
}

async function listPuzzleDates() {
  if (!hasDatabase()) return []
  return await dbListPuzzleDates()
}

module.exports = {
  hasDatabase,
  toDateStringUTC,
  ensurePuzzleForDate,
  getPuzzleForDateWithFallback,
  getPuzzleForDateWithoutGeneration,
  listPuzzleDates,
}
