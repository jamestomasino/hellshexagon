'use strict'

const { getPuzzleForDate } = require('./daily-puzzle')

const STORE_NAME = process.env.PUZZLE_STORE_NAME || 'hells-hexagon-puzzles'
const INDEX_KEY = 'history/index'

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
        const options = token ? { siteID, token } : { siteID }
        return blobsApi.getStore(STORE_NAME, options)
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

  const generated = getPuzzleForDate(dateString)
  await savePuzzleEntry(store, dateString, generated.puzzle)

  return {
    date: dateString,
    puzzle: generated.puzzle,
    source: 'blobs-generated',
    generatedAt: new Date().toISOString(),
    datasetSize: generated.datasetSize,
    index: generated.index,
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
