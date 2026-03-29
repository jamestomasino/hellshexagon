'use strict'

const { getPuzzleForDate, getPuzzleForDateAvoidingUsage } = require('./daily-puzzle')

const STORE_NAME = process.env.PUZZLE_STORE_NAME || 'hells-hexagon-puzzles'
const INDEX_KEY = 'history/index'
const USAGE_INDEX_KEY = 'history/usage'

let blobsApi = null
try {
  // Available in Netlify runtime. Keep optional for local fallback.
  blobsApi = require('@netlify/blobs')
} catch (_error) {
  blobsApi = null
}

function hasBlobs() {
  return Boolean(blobsApi && typeof blobsApi.getStore === 'function')
}

function getStore() {
  if (!hasBlobs()) return null

  try {
    return blobsApi.getStore(STORE_NAME)
  } catch (error) {
    const isMissingEnv =
      error && (error.name === 'MissingBlobsEnvironmentError' || /MissingBlobsEnvironmentError/.test(error.message || ''))
    if (isMissingEnv) {
      try {
        const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID
        const token =
          process.env.NETLIFY_BLOBS_TOKEN ||
          process.env.NETLIFY_AUTH_TOKEN ||
          process.env.NETLIFY_TOKEN ||
          process.env.NETLIFY_API_TOKEN ||
          process.env.BLOBS_TOKEN
        const options = token ? { name: STORE_NAME, siteID, token } : { name: STORE_NAME, siteID }
        return blobsApi.getStore(options)
      } catch (retryError) {
        const retryMissingEnv =
          retryError &&
          (retryError.name === 'MissingBlobsEnvironmentError' ||
            /MissingBlobsEnvironmentError/.test(retryError.message || ''))
        if (retryMissingEnv) return null
        throw retryError
      }
    }
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

function entryKey(dateString) {
  return `history/${dateString}`
}

async function getHistoryIndex(store) {
  const index = await store.get(INDEX_KEY, { type: 'json' })
  if (!index || !Array.isArray(index.dates)) {
    return { dates: [] }
  }
  return index
}

async function putHistoryIndex(store, index) {
  await store.setJSON(INDEX_KEY, {
    dates: Array.from(new Set(index.dates)).sort(),
    updatedAt: new Date().toISOString(),
  })
}

async function getUsageIndex(store) {
  const usage = await store.get(USAGE_INDEX_KEY, { type: 'json' })
  if (!usage || !Array.isArray(usage.filmIds) || !Array.isArray(usage.actorIds)) {
    return { filmIds: [], actorIds: [], rebuiltFromDates: 0 }
  }
  return {
    filmIds: usage.filmIds,
    actorIds: usage.actorIds,
    rebuiltFromDates: typeof usage.rebuiltFromDates === 'number' ? usage.rebuiltFromDates : null,
  }
}

async function putUsageIndex(store, usage) {
  await store.setJSON(USAGE_INDEX_KEY, {
    filmIds: Array.from(new Set(usage.filmIds)).sort((a, b) => a - b),
    actorIds: Array.from(new Set(usage.actorIds)).sort((a, b) => a - b),
    rebuiltFromDates: typeof usage.rebuiltFromDates === 'number' ? usage.rebuiltFromDates : null,
    updatedAt: new Date().toISOString(),
  })
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

async function rebuildUsageFromHistory(store, historyDates) {
  const usage = {
    filmIds: [],
    actorIds: [],
    rebuiltFromDates: historyDates.length,
  }

  for (const dateString of historyDates) {
    const entry = await getPuzzleEntry(store, dateString)
    if (!entry || !entry.puzzle) continue
    const merged = mergePuzzleIntoUsage(usage, entry.puzzle)
    usage.filmIds = merged.filmIds
    usage.actorIds = merged.actorIds
  }

  await putUsageIndex(store, usage)
  return usage
}

async function ensureUsageCatchUp(store) {
  const history = await getHistoryIndex(store)
  const usage = await getUsageIndex(store)
  const dateCount = history.dates.length

  const needsRebuild =
    dateCount > 0 &&
    (usage.rebuiltFromDates === null || usage.rebuiltFromDates !== dateCount)

  if (!needsRebuild) return usage

  return await rebuildUsageFromHistory(store, history.dates)
}

async function savePuzzleEntry(store, dateString, puzzle) {
  const now = new Date().toISOString()
  await store.setJSON(entryKey(dateString), {
    date: dateString,
    puzzle,
    generatedAt: now,
    version: 1,
  })

  const index = await getHistoryIndex(store)
  index.dates.push(dateString)
  await putHistoryIndex(store, index)
  const dateCount = Array.from(new Set(index.dates)).length

  const usage = await getUsageIndex(store)
  const mergedUsage = mergePuzzleIntoUsage(usage, puzzle)
  mergedUsage.rebuiltFromDates = dateCount
  await putUsageIndex(store, mergedUsage)
}

async function getPuzzleEntry(store, dateString) {
  return await store.get(entryKey(dateString), { type: 'json' })
}

async function ensurePuzzleForDate(inputDate) {
  const dateString = toDateStringUTC(inputDate)
  const store = getStore()

  if (!store) {
    const fallback = getPuzzleForDate(dateString)
    return {
      date: dateString,
      puzzle: fallback.puzzle,
      source: 'dataset-fallback-no-blobs',
      generatedAt: null,
      datasetSize: fallback.datasetSize,
      index: fallback.index,
    }
  }

  const usage = await ensureUsageCatchUp(store)

  const existing = await getPuzzleEntry(store, dateString)
  if (existing && existing.puzzle) {
    return {
      date: dateString,
      puzzle: existing.puzzle,
      source: 'blobs-history',
      generatedAt: existing.generatedAt || null,
      datasetSize: null,
      index: null,
    }
  }

  const generated = getPuzzleForDateAvoidingUsage(dateString, usage)
  await savePuzzleEntry(store, dateString, generated.puzzle)

  return {
    date: dateString,
    puzzle: generated.puzzle,
    source: generated.reuseExhausted ? 'blobs-generated-overlap-fallback' : 'blobs-generated',
    generatedAt: new Date().toISOString(),
    datasetSize: generated.datasetSize,
    index: generated.index,
    strategy: generated.strategy,
    reuseExhausted: generated.reuseExhausted,
    overlap: generated.overlap || 0,
  }
}

async function getPuzzleForDateWithFallback(inputDate) {
  const dateString = toDateStringUTC(inputDate)
  const store = getStore()

  if (!store) {
    const fallback = getPuzzleForDate(dateString)
    return {
      date: dateString,
      puzzle: fallback.puzzle,
      source: 'dataset-fallback-no-blobs',
      generatedAt: null,
      datasetSize: fallback.datasetSize,
      index: fallback.index,
    }
  }

  const existing = await getPuzzleEntry(store, dateString)
  if (existing && existing.puzzle) {
    return {
      date: dateString,
      puzzle: existing.puzzle,
      source: 'blobs-history',
      generatedAt: existing.generatedAt || null,
      datasetSize: null,
      index: null,
    }
  }

  const fallback = getPuzzleForDate(dateString)
  return {
    date: dateString,
    puzzle: fallback.puzzle,
    source: 'dataset-fallback-miss',
    generatedAt: null,
    datasetSize: fallback.datasetSize,
    index: fallback.index,
  }
}

async function listPuzzleDates() {
  const store = getStore()
  if (!store) return []

  const index = await getHistoryIndex(store)
  return index.dates
}

module.exports = {
  hasBlobs,
  toDateStringUTC,
  ensurePuzzleForDate,
  getPuzzleForDateWithFallback,
  listPuzzleDates,
}
