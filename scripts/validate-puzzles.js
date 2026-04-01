#!/usr/bin/env node
'use strict'

const {
  getPuzzleForDate,
  toDateStringUTC,
} = require('../shared/daily-puzzle')
const {
  buildGraph,
  keyForActor,
  keyForFilm,
  shortestDistance,
  validateNoDirectSegmentEdges,
} = require('../shared/hex-graph')
const { readCatalog } = require('../shared/catalog-source')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function addDaysUTC(dateString, days) {
  const d = new Date(`${dateString}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function areAllSegmentsReachable(graph, filmIds, actorIds) {
  const segments = [
    [keyForFilm(filmIds[0]), keyForActor(actorIds[0])],
    [keyForActor(actorIds[0]), keyForFilm(filmIds[1])],
    [keyForFilm(filmIds[1]), keyForActor(actorIds[1])],
    [keyForActor(actorIds[1]), keyForFilm(filmIds[2])],
    [keyForFilm(filmIds[2]), keyForActor(actorIds[2])],
    [keyForActor(actorIds[2]), keyForFilm(filmIds[0])],
  ]

  for (const [startKey, endKey] of segments) {
    if (!Number.isFinite(shortestDistance(graph, startKey, endKey))) return false
  }
  return true
}

function validateGeneratedPuzzleShape(payload, graph) {
  const puzzle = payload.puzzle
  assert(puzzle && typeof puzzle.id === 'string' && puzzle.id.length > 0, 'Puzzle must have id')
  assert(Array.isArray(puzzle.films) && puzzle.films.length === 3, `${puzzle.id}: films must have 3 items`)
  assert(Array.isArray(puzzle.actors) && puzzle.actors.length === 3, `${puzzle.id}: actors must have 3 items`)

  const filmIds = puzzle.films.map((f) => f.id)
  const actorIds = puzzle.actors.map((a) => a.id)

  assert(new Set(filmIds).size === 3, `${puzzle.id}: films must be unique`)
  assert(new Set(actorIds).size === 3, `${puzzle.id}: actors must be unique`)

  for (const film of puzzle.films) {
    assert(graph.films.has(film.id), `${puzzle.id}: unknown film id ${film.id}`)
    assert(typeof film.title === 'string' && film.title.length > 0, `${puzzle.id}: film title required`)
  }
  for (const actor of puzzle.actors) {
    assert(graph.actors.has(actor.id), `${puzzle.id}: unknown actor id ${actor.id}`)
    assert(typeof actor.name === 'string' && actor.name.length > 0, `${puzzle.id}: actor name required`)
  }

  const segmentCheck = validateNoDirectSegmentEdges(graph, filmIds, actorIds)
  assert(segmentCheck.ok, `${puzzle.id}: ${segmentCheck.reason}`)
  assert(
    areAllSegmentsReachable(graph, filmIds, actorIds),
    `${puzzle.id}: one or more adjacent segments has no reachable path`,
  )
}

function main() {
  const startDate = toDateStringUTC(process.argv[2] || new Date())
  const dayCount = Number(process.argv[3] || 14)
  assert(Number.isInteger(dayCount) && dayCount > 0, 'dayCount must be positive integer')

  const catalog = readCatalog()
  const graph = buildGraph(catalog)
  const lines = []

  for (let i = 0; i < dayCount; i += 1) {
    const date = addDaysUTC(startDate, i)
    const payload = getPuzzleForDate(date)
    validateGeneratedPuzzleShape(payload, graph)

    lines.push(
      `${date}: ${payload.puzzle.id} profile=${payload.selectedProfile ? payload.selectedProfile.name : 'n/a'} pass=${payload.selectedProfile ? payload.selectedProfile.relaxationPass : 'n/a'} known=${Number((payload.averageKnownness || 0).toFixed(3))}`,
    )
  }

  console.log(`OK: validated ${dayCount} generated puzzle(s) from ${startDate}`)
  for (const line of lines) console.log(`- ${line}`)
}

main()
