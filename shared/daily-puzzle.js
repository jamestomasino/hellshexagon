'use strict'

const fs = require('fs')
const path = require('path')

const DAY_MS = 24 * 60 * 60 * 1000

function normalizeDateInput(input) {
  if (input === undefined || input === null || input === '') return new Date()
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date input: ${input}`)
  }
  return parsed
}

function daysSinceEpochUTC(date) {
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return Math.floor(utc / DAY_MS)
}

function readPuzzles() {
  const candidates = [
    path.join(__dirname, '..', 'data', 'puzzles.json'),
    path.join(process.cwd(), 'data', 'puzzles.json'),
    '/var/task/data/puzzles.json',
  ]

  let parsed = null
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      parsed = JSON.parse(raw)
      break
    } catch (_error) {
      // try next candidate path
    }
  }

  if (!parsed) {
    // Last resort for bundlers that rewrite paths but still support static JSON require.
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      parsed = require('../data/puzzles.json')
    } catch (_error) {
      throw new Error('Puzzle dataset file not found in function bundle')
    }
  }

  if (Array.isArray(parsed) === false || parsed.length === 0) {
    throw new Error('Puzzle dataset must contain at least one puzzle')
  }

  return parsed
}

function getDatasetIndexByDay(dayIndex, size) {
  return Math.abs(dayIndex) % size
}

function getPuzzleOverlap(puzzle, usedFilmIds, usedActorIds) {
  let score = 0
  for (const film of puzzle.films || []) {
    if (usedFilmIds.has(film.id)) score += 1
  }
  for (const actor of puzzle.actors || []) {
    if (usedActorIds.has(actor.id)) score += 1
  }
  return score
}

function getPuzzleForDate(inputDate) {
  const date = normalizeDateInput(inputDate)
  const puzzles = readPuzzles()
  const dayIndex = daysSinceEpochUTC(date)
  const index = getDatasetIndexByDay(dayIndex, puzzles.length)
  const puzzle = puzzles[index]

  return {
    date: date.toISOString().slice(0, 10),
    datasetSize: puzzles.length,
    index,
    puzzle,
  }
}

function getPuzzleForDateAvoidingUsage(inputDate, usage) {
  const date = normalizeDateInput(inputDate)
  const puzzles = readPuzzles()
  const dayIndex = daysSinceEpochUTC(date)
  const daySlot = getDatasetIndexByDay(dayIndex, puzzles.length)
  const usedFilmIds = new Set((usage && usage.filmIds) || [])
  const usedActorIds = new Set((usage && usage.actorIds) || [])

  const eligible = []
  for (let i = 0; i < puzzles.length; i += 1) {
    const overlap = getPuzzleOverlap(puzzles[i], usedFilmIds, usedActorIds)
    if (overlap === 0) {
      eligible.push(i)
    }
  }

  if (eligible.length > 0) {
    const eligibleIndex = daySlot % eligible.length
    const selected = eligible[eligibleIndex]
    return {
      date: date.toISOString().slice(0, 10),
      datasetSize: puzzles.length,
      index: selected,
      puzzle: puzzles[selected],
      strategy: 'avoid-reuse',
      reuseExhausted: false,
      eligibleCount: eligible.length,
    }
  }

  let minOverlap = Number.POSITIVE_INFINITY
  const leastOverlap = []
  for (let i = 0; i < puzzles.length; i += 1) {
    const overlap = getPuzzleOverlap(puzzles[i], usedFilmIds, usedActorIds)
    if (overlap < minOverlap) {
      minOverlap = overlap
      leastOverlap.length = 0
      leastOverlap.push(i)
    } else if (overlap === minOverlap) {
      leastOverlap.push(i)
    }
  }

  const selected = leastOverlap[daySlot % leastOverlap.length]
  return {
    date: date.toISOString().slice(0, 10),
    datasetSize: puzzles.length,
    index: selected,
    puzzle: puzzles[selected],
    strategy: 'least-overlap-fallback',
    reuseExhausted: true,
    overlap: minOverlap,
    eligibleCount: 0,
  }
}

module.exports = {
  getPuzzleForDate,
  getPuzzleForDateAvoidingUsage,
  readPuzzles,
}
