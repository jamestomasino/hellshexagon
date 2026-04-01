#!/usr/bin/env node
'use strict'

const {
  buildGraph,
  keyForActor,
  keyForFilm,
  shortestDistance,
  validateNoDirectSegmentEdges,
} = require('./lib/hex-solver')
const { readCatalog } = require('../shared/catalog-source')

const catalog = readCatalog()
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

function areAllSegmentsReachable(graphRef, filmIds, actorIds) {
  const segments = [
    [keyForFilm(filmIds[0]), keyForActor(actorIds[0])],
    [keyForActor(actorIds[0]), keyForFilm(filmIds[1])],
    [keyForFilm(filmIds[1]), keyForActor(actorIds[1])],
    [keyForActor(actorIds[1]), keyForFilm(filmIds[2])],
    [keyForFilm(filmIds[2]), keyForActor(actorIds[2])],
    [keyForActor(actorIds[2]), keyForFilm(filmIds[0])],
  ]
  let totalDistance = 0
  for (const [startKey, endKey] of segments) {
    const dist = shortestDistance(graphRef, startKey, endKey)
    if (!Number.isFinite(dist)) return null
    totalDistance += dist
  }
  return totalDistance
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

    const totalDistance = areAllSegmentsReachable(
      graph,
      filmSet.map((f) => f.id),
      actorSet.map((a) => a.id),
    )
    if (totalDistance == null) continue

    const id = `us-${String(found.length + 1).padStart(3, '0')}-${slugify(filmSet[0].title)}`
    found.push({
      id,
      regionBias: 'US-mainstream',
      generationRule: 'catalog-v2-unconstrained',
      films: filmSet.map((f) => ({ id: f.id, title: f.title, year: f.year })),
      actors: actorSet.map((a) => ({ id: a.id, name: a.name })),
      baselineDistance: totalDistance,
    })
  }

  console.log(JSON.stringify(found, null, 2))
  console.error(`Found ${found.length} candidate seeds after ${attempts} attempts`)
}

main()
