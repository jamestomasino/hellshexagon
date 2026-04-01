'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  getPuzzleForDate,
} = require('../shared/daily-puzzle')
const { readCatalog } = require('../shared/catalog-source')
const {
  buildGraph,
  keyForActor,
  keyForFilm,
  shortestDistance,
  validateNoDirectSegmentEdges,
} = require('../shared/hex-graph')

function segmentReachable(graph, filmIds, actorIds) {
  const segments = [
    [keyForFilm(filmIds[0]), keyForActor(actorIds[0])],
    [keyForActor(actorIds[0]), keyForFilm(filmIds[1])],
    [keyForFilm(filmIds[1]), keyForActor(actorIds[1])],
    [keyForActor(actorIds[1]), keyForFilm(filmIds[2])],
    [keyForFilm(filmIds[2]), keyForActor(actorIds[2])],
    [keyForActor(actorIds[2]), keyForFilm(filmIds[0])],
  ]
  return segments.every(([start, end]) => Number.isFinite(shortestDistance(graph, start, end)))
}

test('generated puzzle satisfies unconstrained generation rules', () => {
  const payload = getPuzzleForDate('2026-04-07')
  const puzzle = payload.puzzle
  const filmIds = puzzle.films.map((f) => f.id)
  const actorIds = puzzle.actors.map((a) => a.id)

  const catalog = readCatalog()
  const graph = buildGraph(catalog)

  assert.equal(filmIds.length, 3)
  assert.equal(actorIds.length, 3)
  assert.equal(new Set(filmIds).size, 3)
  assert.equal(new Set(actorIds).size, 3)
  assert.equal(validateNoDirectSegmentEdges(graph, filmIds, actorIds).ok, true)
  assert.equal(segmentReachable(graph, filmIds, actorIds), true)
})

test('weekday difficulty trend keeps Monday more known than Sunday on average', () => {
  const mondayDates = ['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27']
  const sundayDates = ['2026-04-05', '2026-04-12', '2026-04-19', '2026-04-26']

  const mondayAvg = mondayDates
    .map((date) => Number(getPuzzleForDate(date).averageKnownness || 0))
    .reduce((sum, n) => sum + n, 0) / mondayDates.length
  const sundayAvg = sundayDates
    .map((date) => Number(getPuzzleForDate(date).averageKnownness || 0))
    .reduce((sum, n) => sum + n, 0) / sundayDates.length

  assert.equal(Number.isFinite(mondayAvg), true)
  assert.equal(Number.isFinite(sundayAvg), true)
  assert.ok(
    mondayAvg > sundayAvg,
    `Expected Monday avgKnownness (${mondayAvg.toFixed(3)}) > Sunday avgKnownness (${sundayAvg.toFixed(3)})`,
  )
})
