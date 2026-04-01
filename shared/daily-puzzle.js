'use strict'

const { readCatalog } = require('./catalog-source')
const {
  buildGraph,
  keyForActor,
  keyForFilm,
  shortestDistance,
  validateNoDirectSegmentEdges,
} = require('./hex-graph')

const WEEKDAY_PROFILES = [
  { name: 'Monday', knownMinPct: 0.65, knownMaxPct: 1.0 },
  { name: 'Tuesday', knownMinPct: 0.55, knownMaxPct: 0.95 },
  { name: 'Wednesday', knownMinPct: 0.45, knownMaxPct: 0.9 },
  { name: 'Thursday', knownMinPct: 0.35, knownMaxPct: 0.85 },
  { name: 'Friday', knownMinPct: 0.25, knownMaxPct: 0.8 },
  { name: 'Saturday', knownMinPct: 0.2, knownMaxPct: 0.7 },
  { name: 'Sunday', knownMinPct: 0.15, knownMaxPct: 0.6 },
]

let cachedPrepared = null

function normalizeDateInput(input) {
  if (input === undefined || input === null || input === '') return new Date()
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date input: ${input}`)
  }
  return parsed
}

function toDateStringUTC(input) {
  return normalizeDateInput(input).toISOString().slice(0, 10)
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

function weekdayIndex(dateString) {
  const d = new Date(`${dateString}T00:00:00Z`)
  const day = d.getUTCDay()
  return day === 0 ? 6 : day - 1
}

function getWeekdayProfile(dateString) {
  return WEEKDAY_PROFILES[weekdayIndex(dateString)]
}

function getPercentileThreshold(values, pct) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * pct)))
  return sorted[idx]
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
    const popNorm = typeof film.popularity === 'number' && film.popularity > 0
      ? Math.min(1, Math.log1p(film.popularity) / 6)
      : null
    filmKnownness.set(film.id, popNorm == null ? degNorm : popNorm * 0.7 + degNorm * 0.3)
  }

  for (const actor of catalog.actors) {
    const degNorm = (actorDegree.get(actor.id) || 0) / maxActorDeg
    const popNorm = typeof actor.popularity === 'number' && actor.popularity > 0
      ? Math.min(1, Math.log1p(actor.popularity) / 6)
      : null
    actorKnownness.set(actor.id, popNorm == null ? degNorm : popNorm * 0.7 + degNorm * 0.3)
  }

  return { filmKnownness, actorKnownness }
}

function relaxedProfile(base, pass) {
  return {
    ...base,
    knownMinPct: Math.max(0, base.knownMinPct - pass * 0.12),
    knownMaxPct: Math.min(1, base.knownMaxPct + pass * 0.1),
    relaxationPass: pass,
  }
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
    const dist = shortestDistance(graph, startKey, endKey)
    if (!Number.isFinite(dist)) return null
    totalDistance += dist
  }
  return totalDistance
}

function averageKnownness(items, knownnessMap) {
  if (!items.length) return 0
  let sum = 0
  for (const item of items) sum += knownnessMap.get(item.id) || 0
  return sum / items.length
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

function compareCandidates(a, b) {
  if (!a) return b
  if (!b) return a
  if (b.overlap !== a.overlap) return b.overlap < a.overlap ? b : a
  if (b.profile.relaxationPass !== a.profile.relaxationPass) {
    return b.profile.relaxationPass < a.profile.relaxationPass ? b : a
  }
  if (b.avgKnownness !== a.avgKnownness) return b.avgKnownness > a.avgKnownness ? b : a
  if (b.totalDistance !== a.totalDistance) return b.totalDistance > a.totalDistance ? b : a
  return a
}

function ensurePreparedCatalog() {
  if (cachedPrepared) return cachedPrepared
  const catalog = readCatalog()
  const graph = buildGraph(catalog)
  const { filmKnownness, actorKnownness } = buildKnownnessMaps(catalog)
  const filmValues = catalog.films.map((f) => filmKnownness.get(f.id) || 0)
  const actorValues = catalog.actors.map((a) => actorKnownness.get(a.id) || 0)

  cachedPrepared = {
    catalog,
    graph,
    filmKnownness,
    actorKnownness,
    filmValues,
    actorValues,
  }
  return cachedPrepared
}

function candidateToPuzzle(candidate, dateString) {
  const id = `gen-${dateString}-${candidate.filmIds.slice().sort((a, b) => a - b).join('-')}-${candidate.actorIds.slice().sort((a, b) => a - b).join('-')}`
  const puzzle = {
    id,
    generationRule: 'catalog-v2-unconstrained',
    difficultyProfile: candidate.profile.name,
    knownnessBand: candidate.knownnessBand,
    relaxationPass: candidate.profile.relaxationPass,
    overlap: candidate.overlap,
    distanceScore: candidate.totalDistance,
    averageKnownness: Number(candidate.avgKnownness.toFixed(3)),
    films: candidate.films.map((f) => ({ id: f.id, title: f.title, year: f.year })),
    actors: candidate.actors.map((a) => ({ id: a.id, name: a.name })),
  }

  return {
    date: dateString,
    puzzle,
    strategy: 'catalog-knownness-band',
    reuseExhausted: candidate.overlap > 0,
    overlap: candidate.overlap,
    selectedProfile: candidate.profile,
    knownnessBand: candidate.knownnessBand,
    distanceScore: candidate.totalDistance,
    averageKnownness: candidate.avgKnownness,
    catalogSize: {
      films: candidate.catalogSize.films,
      actors: candidate.catalogSize.actors,
      credits: candidate.catalogSize.credits,
    },
  }
}

function generatePuzzleFromCatalog(inputDate, usage) {
  const dateString = toDateStringUTC(inputDate)
  const { catalog, graph, filmKnownness, actorKnownness, filmValues, actorValues } = ensurePreparedCatalog()

  const profileBase = getWeekdayProfile(dateString)
  const rng = seededRng(`hh-gen:${dateString}`)
  const usedFilmIds = new Set((usage && usage.filmIds) || [])
  const usedActorIds = new Set((usage && usage.actorIds) || [])
  const attemptsPerPass = Math.max(60, Number(process.env.SEED_POOL_SIZE || 200))

  let bestCandidate = null
  const seen = new Set()

  for (let pass = 0; pass <= 5; pass += 1) {
    const profile = relaxedProfile(profileBase, pass)
    const filmKnownMin = getPercentileThreshold(filmValues, profile.knownMinPct)
    const filmKnownMax = getPercentileThreshold(filmValues, profile.knownMaxPct)
    const actorKnownMin = getPercentileThreshold(actorValues, profile.knownMinPct)
    const actorKnownMax = getPercentileThreshold(actorValues, profile.knownMaxPct)

    const filmPool = catalog.films.filter((film) => {
      const score = filmKnownness.get(film.id) || 0
      return score >= filmKnownMin && score <= filmKnownMax
    })
    const actorPool = catalog.actors.filter((actor) => {
      const score = actorKnownness.get(actor.id) || 0
      return score >= actorKnownMin && score <= actorKnownMax
    })

    if (filmPool.length < 3 || actorPool.length < 3) continue

    for (let i = 0; i < attemptsPerPass; i += 1) {
      const films = sampleK(filmPool, 3, rng)
      const actors = sampleK(actorPool, 3, rng)
      if (films.length < 3 || actors.length < 3) continue

      const signature = `${films.map((f) => f.id).sort((a, b) => a - b).join(',')}|${actors.map((a) => a.id).sort((a, b) => a - b).join(',')}`
      if (seen.has(signature)) continue
      seen.add(signature)

      const filmIds = films.map((item) => item.id)
      const actorIds = actors.map((item) => item.id)

      const directCheck = validateNoDirectSegmentEdges(graph, filmIds, actorIds)
      if (!directCheck.ok) continue

      const totalDistance = checkSegmentReachability(graph, filmIds, actorIds)
      if (totalDistance == null) continue

      const anchorPuzzle = { films, actors }
      const overlap = getPuzzleOverlap(anchorPuzzle, usedFilmIds, usedActorIds)
      const avgKnown = (averageKnownness(films, filmKnownness) + averageKnownness(actors, actorKnownness)) / 2

      const candidate = {
        films,
        actors,
        filmIds,
        actorIds,
        overlap,
        avgKnownness: avgKnown,
        totalDistance,
        profile,
        knownnessBand: {
          film: [Number(filmKnownMin.toFixed(3)), Number(filmKnownMax.toFixed(3))],
          actor: [Number(actorKnownMin.toFixed(3)), Number(actorKnownMax.toFixed(3))],
        },
        catalogSize: {
          films: catalog.films.length,
          actors: catalog.actors.length,
          credits: catalog.credits.length,
        },
      }

      bestCandidate = compareCandidates(bestCandidate, candidate)
      if (bestCandidate && bestCandidate.overlap === 0 && bestCandidate.profile.relaxationPass === 0) {
        return candidateToPuzzle(bestCandidate, dateString)
      }
    }
  }

  if (!bestCandidate) {
    throw new Error('Unable to generate a valid puzzle candidate from catalog')
  }

  return candidateToPuzzle(bestCandidate, dateString)
}

function getPuzzleForDate(inputDate) {
  return generatePuzzleFromCatalog(inputDate, { filmIds: [], actorIds: [] })
}

function getPuzzleForDateAvoidingUsage(inputDate, usage) {
  return generatePuzzleFromCatalog(inputDate, usage || { filmIds: [], actorIds: [] })
}

module.exports = {
  WEEKDAY_PROFILES,
  getWeekdayProfile,
  getPuzzleForDate,
  getPuzzleForDateAvoidingUsage,
  toDateStringUTC,
}
