'use strict'

function keyForFilm(id) {
  return `film:${id}`
}

function keyForActor(id) {
  return `actor:${id}`
}

function parseNodeKey(key) {
  const [type, rawId] = key.split(':')
  return { type, id: Number(rawId) }
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

function enumerateSimplePaths(graph, startKey, endKey, options) {
  const maxNodes = options.maxNodes
  const minNodes = options.minNodes || 2
  const limit = options.limit || 30
  const out = []
  const path = [startKey]
  const seen = new Set([startKey])

  function dfs(node) {
    if (out.length >= limit) return
    if (path.length > maxNodes) return

    if (node === endKey) {
      if (path.length >= minNodes) out.push([...path])
      return
    }

    const next = graph.neighbors.get(node) || new Set()
    for (const candidate of next) {
      if (seen.has(candidate)) continue
      seen.add(candidate)
      path.push(candidate)
      dfs(candidate)
      path.pop()
      seen.delete(candidate)
      if (out.length >= limit) return
    }
  }

  dfs(startKey)
  out.sort((a, b) => a.length - b.length)
  return out
}

function pairwise(items) {
  const out = []
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) out.push([items[i], items[j]])
  }
  return out
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

function findLoopSolution(graph, filmIds, actorIds, options) {
  const maxTotalNodes = options.maxTotalNodes || 32
  const segmentMaxNodes = options.segmentMaxNodes || 10
  const segmentPathLimit = options.segmentPathLimit || 24

  const segments = [
    [keyForFilm(filmIds[0]), keyForActor(actorIds[0])],
    [keyForActor(actorIds[0]), keyForFilm(filmIds[1])],
    [keyForFilm(filmIds[1]), keyForActor(actorIds[1])],
    [keyForActor(actorIds[1]), keyForFilm(filmIds[2])],
    [keyForFilm(filmIds[2]), keyForActor(actorIds[2])],
    [keyForActor(actorIds[2]), keyForFilm(filmIds[0])],
  ]

  const segmentPaths = []
  for (const [startKey, endKey] of segments) {
    const paths = enumerateSimplePaths(graph, startKey, endKey, {
      minNodes: 4,
      maxNodes: segmentMaxNodes,
      limit: segmentPathLimit,
    })
    if (paths.length === 0) return null
    segmentPaths.push(paths)
  }

  const cycleStart = segments[0][0]
  const used = new Set([cycleStart])
  const picked = []
  let nodeCount = 1

  function backtrack(index) {
    if (index === segmentPaths.length) {
      return { paths: picked.map((path) => [...path]), nodeCount }
    }

    const candidates = segmentPaths[index]
    for (const path of candidates) {
      const added = []
      let valid = true
      let delta = 0

      for (let i = 1; i < path.length; i += 1) {
        const key = path[i]
        const isFinalClosure = index === segmentPaths.length - 1 && i === path.length - 1 && key === cycleStart
        if (isFinalClosure) continue
        if (used.has(key)) {
          valid = false
          break
        }
        used.add(key)
        added.push(key)
        delta += 1
      }

      if (!valid) {
        for (const key of added) used.delete(key)
        continue
      }

      if (nodeCount + delta > maxTotalNodes) {
        for (const key of added) used.delete(key)
        continue
      }

      picked.push(path)
      nodeCount += delta
      const found = backtrack(index + 1)
      if (found) return found
      nodeCount -= delta
      picked.pop()
      for (const key of added) used.delete(key)
    }

    return null
  }

  return backtrack(0)
}

module.exports = {
  buildGraph,
  findLoopSolution,
  keyForActor,
  keyForFilm,
  parseNodeKey,
  shortestDistance,
  validateNoDirectSegmentEdges,
}
