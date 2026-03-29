#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  buildGraph,
  findLoopSolution,
  validateNoDirectSegmentEdges,
} = require('./lib/hex-solver')

const puzzlesFile = path.join(__dirname, '..', 'data', 'puzzles.json')
const catalogFile = path.join(__dirname, '..', 'data', 'catalog.json')

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function validatePuzzleShape(puzzle, graph) {
  assert(typeof puzzle.id === 'string' && puzzle.id.length > 0, 'Puzzle must have id')
  assert(Array.isArray(puzzle.films) && puzzle.films.length === 3, `${puzzle.id}: films must have 3 items`)
  assert(Array.isArray(puzzle.actors) && puzzle.actors.length === 3, `${puzzle.id}: actors must have 3 items`)
  assert(
    puzzle.maxNodes === undefined || Number.isInteger(puzzle.maxNodes),
    `${puzzle.id}: maxNodes must be integer if provided`,
  )

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
}

function main() {
  const puzzles = readJson(puzzlesFile)
  const catalog = readJson(catalogFile)
  const graph = buildGraph(catalog)

  assert(Array.isArray(puzzles) && puzzles.length > 0, 'puzzles.json must contain non-empty array')

  const ids = new Set()
  const lines = []

  for (const puzzle of puzzles) {
    assert(!ids.has(puzzle.id), `Duplicate puzzle id: ${puzzle.id}`)
    ids.add(puzzle.id)

    validatePuzzleShape(puzzle, graph)
    const filmIds = puzzle.films.map((item) => item.id)
    const actorIds = puzzle.actors.map((item) => item.id)

    const segmentCheck = validateNoDirectSegmentEdges(graph, filmIds, actorIds)
    assert(segmentCheck.ok, `${puzzle.id}: ${segmentCheck.reason}`)

    const maxNodes = puzzle.maxNodes || 32
    assert(maxNodes <= 32, `${puzzle.id}: maxNodes cannot exceed 32`)

    const solution = findLoopSolution(graph, filmIds, actorIds, {
      maxTotalNodes: maxNodes,
      segmentMaxNodes: 10,
      segmentPathLimit: 24,
    })
    assert(solution, `${puzzle.id}: no valid loop solution found <= ${maxNodes} nodes`)

    lines.push(`${puzzle.id}: solvable in ${solution.nodeCount} nodes`)
  }

  console.log(`OK: ${puzzles.length} puzzles validated`)
  for (const line of lines) console.log(`- ${line}`)
}

main()
