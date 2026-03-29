#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  buildGraph,
  findLoopSolution,
  validateNoDirectSegmentEdges,
} = require('./lib/hex-solver')

const catalogFile = path.join(__dirname, '..', 'data', 'catalog.json')
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
const graph = buildGraph(catalog)

const films = catalog.films
const actors = catalog.actors

function sample3(items) {
  const picked = new Set()
  while (picked.size < 3) picked.add(Math.floor(Math.random() * items.length))
  return [...picked].map((idx) => items[idx])
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function makeSeed(filmSet, actorSet) {
  return {
    films: filmSet.map((f) => ({ id: f.id, title: f.title, year: f.year })),
    actors: actorSet.map((a) => ({ id: a.id, name: a.name })),
  }
}

function main() {
  const target = Number(process.argv[2] || 8)
  const attempts = Number(process.argv[3] || 5000)
  const found = []
  const seen = new Set()

  for (let i = 0; i < attempts && found.length < target; i += 1) {
    const filmSet = sample3(films)
    const actorSet = sample3(actors)

    const key = `${filmSet.map((f) => f.id).sort().join(',')}|${actorSet.map((a) => a.id).sort().join(',')}`
    if (seen.has(key)) continue
    seen.add(key)

    const segmentCheck = validateNoDirectSegmentEdges(
      graph,
      filmSet.map((f) => f.id),
      actorSet.map((a) => a.id),
    )
    if (!segmentCheck.ok) continue

    const solution = findLoopSolution(
      graph,
      filmSet.map((f) => f.id),
      actorSet.map((a) => a.id),
      { maxTotalNodes: 32, segmentMaxNodes: 10, segmentPathLimit: 20 },
    )
    if (!solution) continue

    const id = `us-${String(found.length + 1).padStart(3, '0')}-${slugify(filmSet[0].title)}`
    found.push({
      id,
      regionBias: 'US-mainstream',
      maxNodes: 32,
      films: filmSet.map((f) => ({ id: f.id, title: f.title, year: f.year })),
      actors: actorSet.map((a) => ({ id: a.id, name: a.name })),
      baselineSolvedNodeCount: solution.nodeCount,
    })
  }

  console.log(JSON.stringify(found, null, 2))
  console.error(`Found ${found.length} candidate seeds after ${attempts} attempts`)
}

main()
