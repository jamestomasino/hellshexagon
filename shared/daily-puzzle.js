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
  const file = path.join(__dirname, '..', 'data', 'puzzles.json')
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = JSON.parse(raw)

  if (Array.isArray(parsed) === false || parsed.length === 0) {
    throw new Error('Puzzle dataset must contain at least one puzzle')
  }

  return parsed
}

function getPuzzleForDate(inputDate) {
  const date = normalizeDateInput(inputDate)
  const puzzles = readPuzzles()
  const dayIndex = daysSinceEpochUTC(date)
  const index = Math.abs(dayIndex) % puzzles.length
  const puzzle = puzzles[index]

  return {
    date: date.toISOString().slice(0, 10),
    datasetSize: puzzles.length,
    index,
    puzzle,
  }
}

module.exports = {
  getPuzzleForDate,
}
