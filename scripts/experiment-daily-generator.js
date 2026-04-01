#!/usr/bin/env node
'use strict'

const { readCatalog } = require('../shared/catalog-source')
const {
  buildGraph,
  keyForActor,
  keyForFilm,
  shortestDistance,
  validateNoDirectSegmentEdges,
} = require('./lib/hex-solver')

function toDateStringUTC(input) {
  if (!input) return new Date().toISOString().slice(0, 10)
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${input}`)
  return parsed.toISOString().slice(0, 10)
}

function weekdayIndex(dateString) {
  const d = new Date(`${dateString}T00:00:00Z`)
  const day = d.getUTCDay() // 0 Sunday ... 6 Saturday
  return day === 0 ? 6 : day - 1 // Monday=0 ... Sunday=6
}

function seededRng(seedText) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seedText.length; i += 1) {
    h ^= seedText.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let state = h >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function computeDegrees(catalog) {
  const filmDegree = new Map()
  const actorDegree = new Map()
  for (const [filmId, actorId] of catalog.credits) {
    filmDegree.set(filmId, (filmDegree.get(filmId) || 0) + 1)
    actorDegree.set(actorId, (actorDegree.get(actorId) || 0) + 1)
  }
  return { filmDegree, actorDegree }
}

function getPercentileThreshold(values, pct) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * pct)))
  return sorted[idx]
}

function buildKnownnessMaps(catalog) {
  const { filmDegree, actorDegree } = computeDegrees(catalog)
  const filmDegrees = catalog.films.map((f) => filmDegree.get(f.id) || 0)
  const actorDegrees = catalog.actors.map((a) => actorDegree.get(a.id) || 0)
  const maxFilmDeg = Math.max(1, ...filmDegrees)
  const maxActorDeg = Math.max(1, ...actorDegrees)

  const filmKnownness = new Map()
  const actorKnownness = new Map()

  for (const film of catalog.films) {
    const degNorm = (filmDegree.get(film.id) || 0) / maxFilmDeg
    const popNorm = typeof film.popularity === 'number' && film.popularity > 0 ? Math.min(1, Math.log1p(film.popularity) / 6) : null
    filmKnownness.set(film.id, popNorm == null ? degNorm : popNorm * 0.7 + degNorm * 0.3)
  }

  for (const actor of catalog.actors) {
    const degNorm = (actorDegree.get(actor.id) || 0) / maxActorDeg
    const popNorm = typeof actor.popularity === 'number' && actor.popularity > 0 ? Math.min(1, Math.log1p(actor.popularity) / 6) : null
    actorKnownness.set(actor.id, popNorm == null ? degNorm : popNorm * 0.7 + degNorm * 0.3)
  }

  const filmVals = [...filmKnownness.values()]
  const actorVals = [...actorKnownness.values()]
  return {
    filmKnownness,
    actorKnownness,
    thresholds: {
      filmP20: getPercentileThreshold(filmVals, 0.2),
      filmP35: getPercentileThreshold(filmVals, 0.35),
      filmP50: getPercentileThreshold(filmVals, 0.5),
      filmP70: getPercentileThreshold(filmVals, 0.7),
      actorP20: getPercentileThreshold(actorVals, 0.2),
      actorP35: getPercentileThreshold(actorVals, 0.35),
      actorP50: getPercentileThreshold(actorVals, 0.5),
      actorP70: getPercentileThreshold(actorVals, 0.7),
    },
  }
}

const WEEKDAY_PROFILES = [
  { name: 'Monday', knownMinPct: 0.65, knownMaxPct: 1.0 },
  { name: 'Tuesday', knownMinPct: 0.55, knownMaxPct: 0.95 },
  { name: 'Wednesday', knownMinPct: 0.45, knownMaxPct: 0.9 },
  { name: 'Thursday', knownMinPct: 0.35, knownMaxPct: 0.85 },
  { name: 'Friday', knownMinPct: 0.25, knownMaxPct: 0.8 },
  { name: 'Saturday', knownMinPct: 0.2, knownMaxPct: 0.7 },
  { name: 'Sunday', knownMinPct: 0.15, knownMaxPct: 0.6 },
]

function relaxedProfile(base, pass) {
  // Relax knownness bands quickly on small catalogs.
  const minPct = Math.max(0, base.knownMinPct - pass * 0.12)
  const maxPct = Math.min(1, base.knownMaxPct + pass * 0.1)
  return {
    ...base,
    knownMinPct: minPct,
    knownMaxPct: maxPct,
    relaxationPass: pass,
  }
}

function checkSegmentReachability(graph, filmIds, actorIds) {
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
    const distance = shortestDistance(graph, startKey, endKey)
    if (!Number.isFinite(distance)) return null
    totalDistance += distance
  }
  return totalDistance
}

function sampleK(items, k, rng) {
  const out = []
  const picked = new Set()
  while (out.length < k && picked.size < items.length) {
    const idx = Math.floor(rng() * items.length)
    if (picked.has(idx)) continue
    picked.add(idx)
    out.push(items[idx])
  }
  return out
}

function averageKnownness(items, knownnessMap) {
  if (!items.length) return 0
  let sum = 0
  for (const item of items) sum += knownnessMap.get(item.id) || 0
  return sum / items.length
}

function main() {
  const date = toDateStringUTC(process.argv[2])
  const attempts = Number(process.argv[3] || 5000)
  const keepTop = Number(process.argv[4] || 12)
  const minCandidates = Number(process.argv[5] || 8)

  const catalog = readCatalog()
  const graph = buildGraph(catalog)
  const rng = seededRng(`hh-experiment:${date}`)

  const { filmKnownness, actorKnownness } = buildKnownnessMaps(catalog)
  const baseProfile = WEEKDAY_PROFILES[weekdayIndex(date)]
  const filmValues = catalog.films.map((f) => filmKnownness.get(f.id) || 0)
  const actorValues = catalog.actors.map((a) => actorKnownness.get(a.id) || 0)
  const seen = new Set()
  const candidates = []
  let selectedProfile = null
  let selectedPools = null

  for (let pass = 0; pass < 6; pass += 1) {
    const profile = relaxedProfile(baseProfile, pass)
    const filmKnownMin = getPercentileThreshold(filmValues, profile.knownMinPct)
    const filmKnownMax = getPercentileThreshold(filmValues, profile.knownMaxPct)
    const actorKnownMin = getPercentileThreshold(actorValues, profile.knownMinPct)
    const actorKnownMax = getPercentileThreshold(actorValues, profile.knownMaxPct)

    const filmPool = catalog.films.filter((f) => {
      const score = filmKnownness.get(f.id) || 0
      return score >= filmKnownMin && score <= filmKnownMax
    })
    const actorPool = catalog.actors.filter((a) => {
      const score = actorKnownness.get(a.id) || 0
      return score >= actorKnownMin && score <= actorKnownMax
    })

    selectedProfile = profile
    selectedPools = {
      filmKnownMin,
      filmKnownMax,
      actorKnownMin,
      actorKnownMax,
      filmPoolSize: filmPool.length,
      actorPoolSize: actorPool.length,
    }

    for (let i = 0; i < attempts; i += 1) {
      const filmSet = sampleK(filmPool, 3, rng)
      const actorSet = sampleK(actorPool, 3, rng)
      if (filmSet.length < 3 || actorSet.length < 3) continue

      const signature = `${filmSet.map((f) => f.id).sort((a, b) => a - b).join(',')}|${actorSet.map((a) => a.id).sort((a, b) => a - b).join(',')}`
      if (seen.has(signature)) continue
      seen.add(signature)

      const films = filmSet.map((f) => f.id)
      const actors = actorSet.map((a) => a.id)

      const directCheck = validateNoDirectSegmentEdges(graph, films, actors)
      if (!directCheck.ok) continue

      const totalDistance = checkSegmentReachability(graph, films, actors)
      if (totalDistance == null) continue

      const filmAvg = averageKnownness(filmSet, filmKnownness)
      const actorAvg = averageKnownness(actorSet, actorKnownness)
      const avgKnown = (filmAvg + actorAvg) / 2
      const hardness = totalDistance * 1.2 + (1 - avgKnown) * 12

      candidates.push({
        hardness,
        totalDistance,
        avgKnownness: Number(avgKnown.toFixed(3)),
        films: filmSet.map((f) => `${f.title} (${f.year})`),
        actors: actorSet.map((a) => a.name),
        filmIds: films,
        actorIds: actors,
      })

      if (candidates.length >= minCandidates) break
    }

    if (candidates.length >= minCandidates) break
  }

  candidates.sort((a, b) => b.hardness - a.hardness)

  console.log('=== Hell\'s Hexagon Generator Experiment ===')
  console.log(JSON.stringify({
    date,
    weekdayProfile: baseProfile,
    selectedProfile,
    attempts,
    pool: {
      films: selectedPools ? selectedPools.filmPoolSize : 0,
      actors: selectedPools ? selectedPools.actorPoolSize : 0,
      catalogFilms: catalog.films.length,
      catalogActors: catalog.actors.length,
      knownnessBand: {
        film: selectedPools ? [Number(selectedPools.filmKnownMin.toFixed(3)), Number(selectedPools.filmKnownMax.toFixed(3))] : [0, 0],
        actor: selectedPools ? [Number(selectedPools.actorKnownMin.toFixed(3)), Number(selectedPools.actorKnownMax.toFixed(3))] : [0, 0],
      },
    },
    candidates: candidates.length,
  }, null, 2))

  for (let i = 0; i < Math.min(keepTop, candidates.length); i += 1) {
    const c = candidates[i]
    console.log('')
    console.log(`#${i + 1} hardness=${c.hardness.toFixed(2)} distance=${c.totalDistance} known=${c.avgKnownness}`)
    console.log(`  Films : ${c.films.join(' | ')}`)
    console.log(`  Actors: ${c.actors.join(' | ')}`)
  }
}

main()
