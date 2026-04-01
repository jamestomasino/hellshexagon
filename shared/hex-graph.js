'use strict'

function keyForFilm(id) {
  return `film:${id}`
}

function keyForActor(id) {
  return `actor:${id}`
}

function buildGraph(catalog) {
  const films = new Map(catalog.films.map((item) => [item.id, item]))
  const actors = new Map(catalog.actors.map((item) => [item.id, item]))
  const neighbors = new Map()

  function ensure(key) {
    if (!neighbors.has(key)) neighbors.set(key, new Set())
  }

  for (const [filmId, actorId] of catalog.credits) {
    if (!films.has(filmId) || !actors.has(actorId)) {
      throw new Error(`Invalid credit edge film=${filmId} actor=${actorId}`)
    }

    const filmKey = keyForFilm(filmId)
    const actorKey = keyForActor(actorId)
    ensure(filmKey)
    ensure(actorKey)
    neighbors.get(filmKey).add(actorKey)
    neighbors.get(actorKey).add(filmKey)
  }

  return { films, actors, neighbors }
}

function shortestDistance(graph, startKey, endKey) {
  if (startKey === endKey) return 0
  const queue = [[startKey, 0]]
  const seen = new Set([startKey])

  while (queue.length > 0) {
    const [node, dist] = queue.shift()
    const next = graph.neighbors.get(node) || new Set()
    for (const candidate of next) {
      if (seen.has(candidate)) continue
      if (candidate === endKey) return dist + 1
      seen.add(candidate)
      queue.push([candidate, dist + 1])
    }
  }

  return Number.POSITIVE_INFINITY
}

function hasFilmActorDirectEdge(graph, filmId, actorId) {
  return graph.neighbors.get(keyForFilm(filmId))?.has(keyForActor(actorId)) === true
}

function validateNoDirectSegmentEdges(graph, filmIds, actorIds) {
  const checks = [
    ['F1-A1', filmIds[0], actorIds[0]],
    ['A1-F2', filmIds[1], actorIds[0]],
    ['F2-A2', filmIds[1], actorIds[1]],
    ['A2-F3', filmIds[2], actorIds[1]],
    ['F3-A3', filmIds[2], actorIds[2]],
    ['A3-F1', filmIds[0], actorIds[2]],
  ]

  for (const [label, filmId, actorId] of checks) {
    if (hasFilmActorDirectEdge(graph, filmId, actorId)) {
      return { ok: false, reason: `Direct edge exists for connected pair ${label}` }
    }
  }

  return { ok: true }
}

module.exports = {
  buildGraph,
  keyForActor,
  keyForFilm,
  shortestDistance,
  validateNoDirectSegmentEdges,
}
