'use strict'

const { randomUUID } = require('node:crypto')
const { readCatalog } = require('./catalog-source')
const {
  buildGraph,
  keyForActor,
  keyForFilm,
  shortestDistance,
  validateNoDirectSegmentEdges,
} = require('./hex-graph')

const WEEKDAY_PROFILES = [
  { name: 'Monday', knownMinPct: 0.72, knownMaxPct: 1.0, knownTargetPct: 0.92, popMinPct: 0.85, actorMinFilmDensity: 8, constrainedAnchorCount: 6, bandWidenPct: 0.0 },
  { name: 'Tuesday', knownMinPct: 0.66, knownMaxPct: 0.98, knownTargetPct: 0.86, popMinPct: 0.75, actorMinFilmDensity: 8, constrainedAnchorCount: 1, bandWidenPct: 0.02 },
  { name: 'Wednesday', knownMinPct: 0.5, knownMaxPct: 0.9, knownTargetPct: 0.74, popMinPct: 0.65, actorMinFilmDensity: 7, constrainedAnchorCount: 2, bandWidenPct: 0.04 },
  { name: 'Thursday', knownMinPct: 0.42, knownMaxPct: 0.86, knownTargetPct: 0.66, popMinPct: 0.55, actorMinFilmDensity: 6, constrainedAnchorCount: 3, bandWidenPct: 0.06 },
  { name: 'Friday', knownMinPct: 0.3, knownMaxPct: 0.76, knownTargetPct: 0.52, popMinPct: 0.45, actorMinFilmDensity: 5, constrainedAnchorCount: 4, bandWidenPct: 0.08 },
  { name: 'Saturday', knownMinPct: 0.16, knownMaxPct: 0.62, knownTargetPct: 0.34, popMinPct: 0.30, actorMinFilmDensity: 4, constrainedAnchorCount: 5, bandWidenPct: 0.1 },
  { name: 'Sunday', knownMinPct: 0.05, knownMaxPct: 0.5, knownTargetPct: 0.18, popMinPct: 0.15, actorMinFilmDensity: 3, constrainedAnchorCount: 6, bandWidenPct: 0.12 },
]
const WEEKDAY_TARGET_FLAMES = [1, 1, 2, 2, 3, 4, 5]
const WEEKDAY_TARGET_DIFFICULTY_SCORES = [1.05, 1.45, 1.95, 2.25, 3.0, 4.0, 5.0]
const KNOWNNESS_BASELINE = {
  // Fixed reference points so 0..1 knownness remains stable as catalog/bands change.
  filmDegreeAtOne: 10,
  actorDegreeAtOne: 22,
  popularityLogDenominator: 6,
}
const KNOWNNESS_FLAME_THRESHOLDS = {
  flame1MinKnownness: 0.5,
  flame2MinKnownness: 0.43,
  flame3MinKnownness: 0.35,
  flame4MinKnownness: 0.24,
}
const FLAME_TARGET_KNOWNNESS = {
  1: 0.5,
  2: 0.44,
  3: 0.37,
  4: 0.29,
  5: 0.18,
}

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function knownnessToFlames(averageKnownness) {
  const knownness = Number.isFinite(averageKnownness) ? clamp(averageKnownness, 0, 1) : 0
  if (knownness >= KNOWNNESS_FLAME_THRESHOLDS.flame1MinKnownness) return 1
  if (knownness >= KNOWNNESS_FLAME_THRESHOLDS.flame2MinKnownness) return 2
  if (knownness >= KNOWNNESS_FLAME_THRESHOLDS.flame3MinKnownness) return 3
  if (knownness >= KNOWNNESS_FLAME_THRESHOLDS.flame4MinKnownness) return 4
  return 5
}

function knownnessToDifficultyScore(averageKnownness) {
  const knownness = Number.isFinite(averageKnownness) ? clamp(averageKnownness, 0, 1) : 0
  // Continuous scale for selection/ranking. 0.5 knownness -> 1.0 difficulty, 0.1 -> 5.0.
  return clamp(6 - knownness * 10, 1, 5)
}

function getTargetFlamesForDate(dateString) {
  return WEEKDAY_TARGET_FLAMES[weekdayIndex(dateString)]
}

function getTargetDifficultyScoreForDate(dateString) {
  return WEEKDAY_TARGET_DIFFICULTY_SCORES[weekdayIndex(dateString)]
}

function getTargetKnownnessForFlames(flames) {
  const bounded = Math.min(5, Math.max(1, Number(flames) || 1))
  return FLAME_TARGET_KNOWNNESS[bounded]
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

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function buildKnownnessMaps(catalog) {
  const { filmDegree, actorDegree } = computeDegrees(catalog)

  const filmKnownness = new Map()
  const actorKnownness = new Map()
  const filmPopularityNorm = new Map()
  const actorPopularityNorm = new Map()

  for (const film of catalog.films) {
    const degNorm = clamp01((filmDegree.get(film.id) || 0) / KNOWNNESS_BASELINE.filmDegreeAtOne)
    const popNorm = typeof film.popularity === 'number' && film.popularity > 0
      ? clamp01(Math.log1p(film.popularity) / KNOWNNESS_BASELINE.popularityLogDenominator)
      : null
    filmPopularityNorm.set(film.id, popNorm == null ? 0 : popNorm)
    filmKnownness.set(film.id, popNorm == null ? degNorm : popNorm * 0.7 + degNorm * 0.3)
  }

  for (const actor of catalog.actors) {
    const degNorm = clamp01((actorDegree.get(actor.id) || 0) / KNOWNNESS_BASELINE.actorDegreeAtOne)
    const popNorm = typeof actor.popularity === 'number' && actor.popularity > 0
      ? clamp01(Math.log1p(actor.popularity) / KNOWNNESS_BASELINE.popularityLogDenominator)
      : null
    actorPopularityNorm.set(actor.id, popNorm == null ? 0 : popNorm)
    actorKnownness.set(actor.id, popNorm == null ? degNorm : popNorm * 0.7 + degNorm * 0.3)
  }

  return { filmKnownness, actorKnownness, filmPopularityNorm, actorPopularityNorm }
}

function relaxedProfile(base, pass) {
  return {
    ...base,
    knownMinPct: Math.max(0, base.knownMinPct - pass * 0.12),
    knownMaxPct: Math.min(1, base.knownMaxPct + pass * 0.1),
    knownTargetPct: Math.max(0, Math.min(1, base.knownTargetPct + (pass > 0 ? 0.02 : 0))),
    popMinPct: Math.max(0, (Number(base.popMinPct) || 0) - pass * 0.1),
    actorMinFilmDensity: Math.max(2, (base.actorMinFilmDensity || 2) - pass),
    relaxationPass: pass,
  }
}

function applyBandWidening(profile) {
  const widen = Number.isFinite(Number(profile.bandWidenPct)) ? Number(profile.bandWidenPct) : 0
  if (widen <= 0) return profile
  return {
    ...profile,
    knownMinPct: Math.max(0, profile.knownMinPct - widen),
    knownMaxPct: Math.min(1, profile.knownMaxPct + widen),
    popMinPct: Math.max(0, (Number(profile.popMinPct) || 0) - widen),
  }
}

function splitConstrainedAnchors(constrainedAnchorCount) {
  const total = Math.max(0, Math.min(6, Math.floor(Number(constrainedAnchorCount) || 0)))
  const constrainedActors = Math.floor(total / 2)
  const constrainedFilms = total - constrainedActors
  return {
    constrainedFilms: Math.max(0, Math.min(3, constrainedFilms)),
    constrainedActors: Math.max(0, Math.min(3, constrainedActors)),
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

function sampleKExcludingIds(items, k, rng, excludedIds) {
  const out = []
  const picked = new Set()
  const maxAttempts = Math.max(items.length * 4, k * 12)
  let attempts = 0
  while (out.length < k && picked.size < items.length && attempts < maxAttempts) {
    attempts += 1
    const idx = Math.floor(rng() * items.length)
    if (picked.has(idx)) continue
    picked.add(idx)
    const item = items[idx]
    if (!item || excludedIds.has(item.id)) continue
    out.push(item)
  }
  if (out.length < k) return null
  return out
}

function sampleMixedPool(constrainedPool, openPool, constrainedCount, totalCount, rng) {
  const constrainedPick = constrainedCount > 0 ? sampleK(constrainedPool, constrainedCount, rng) : []
  if ((constrainedPick || []).length < constrainedCount) return null
  const excludedIds = new Set((constrainedPick || []).map((item) => item.id))
  const openCount = totalCount - constrainedCount
  const openPick = openCount > 0 ? sampleKExcludingIds(openPool, openCount, rng, excludedIds) : []
  if ((openPick || []).length < openCount) return null
  return [...(constrainedPick || []), ...(openPick || [])]
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

function recalculateAverageKnownnessFromAnchors(puzzle) {
  if (!puzzle || typeof puzzle !== 'object') return null
  const films = Array.isArray(puzzle.films) ? puzzle.films : []
  const actors = Array.isArray(puzzle.actors) ? puzzle.actors : []
  if (films.length !== 3 || actors.length !== 3) return null

  const filmIds = films
    .map((item) => Number(item && item.id))
    .filter((id) => Number.isInteger(id) && id > 0)
  const actorIds = actors
    .map((item) => Number(item && item.id))
    .filter((id) => Number.isInteger(id) && id > 0)
  if (filmIds.length !== 3 || actorIds.length !== 3) return null

  const { filmKnownness, actorKnownness } = ensurePreparedCatalog()
  const filmAvg = filmIds.reduce((sum, id) => sum + (filmKnownness.get(id) || 0), 0) / filmIds.length
  const actorAvg = actorIds.reduce((sum, id) => sum + (actorKnownness.get(id) || 0), 0) / actorIds.length
  return (filmAvg + actorAvg) / 2
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

function hashTextUInt32(text) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function compareCandidates(a, b) {
  if (a.profile.relaxationPass !== b.profile.relaxationPass) {
    return a.profile.relaxationPass - b.profile.relaxationPass
  }
  if (a.overlap !== b.overlap) return a.overlap - b.overlap
  if (a.targetDelta !== b.targetDelta) return a.targetDelta - b.targetDelta
  if (a.totalDistance !== b.totalDistance) return b.totalDistance - a.totalDistance
  if (a.avgKnownness !== b.avgKnownness) return b.avgKnownness - a.avgKnownness
  if (a.signature < b.signature) return -1
  if (a.signature > b.signature) return 1
  return 0
}

function pickCandidateFromPool(candidates, rng, scopeLabel) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null
  const sorted = [...candidates].sort(compareCandidates)
  const topN = Math.min(24, sorted.length)
  const selectedIndex = Math.floor(rng() * topN)
  return {
    candidate: sorted[selectedIndex],
    diagnostics: {
      scopeLabel,
      poolSize: sorted.length,
      topN,
      selectedIndex,
      selectedRank: selectedIndex + 1,
      selectedSignature: sorted[selectedIndex].signature,
    },
  }
}

function ensurePreparedCatalog() {
  if (cachedPrepared) return cachedPrepared
  const catalog = readCatalog()
  const graph = buildGraph(catalog)
  const { filmKnownness, actorKnownness, filmPopularityNorm, actorPopularityNorm } = buildKnownnessMaps(catalog)
  const filmValues = catalog.films.map((f) => filmKnownness.get(f.id) || 0)
  const actorValues = catalog.actors.map((a) => actorKnownness.get(a.id) || 0)
  const filmPopularityValues = catalog.films.map((f) => filmPopularityNorm.get(f.id) || 0)
  const actorPopularityValues = catalog.actors.map((a) => actorPopularityNorm.get(a.id) || 0)

  cachedPrepared = {
    catalog,
    graph,
    filmKnownness,
    actorKnownness,
    filmPopularityNorm,
    actorPopularityNorm,
    filmValues,
    actorValues,
    filmPopularityValues,
    actorPopularityValues,
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
    knownTarget: candidate.targetKnownness,
    catalogSize: {
      films: candidate.catalogSize.films,
      actors: candidate.catalogSize.actors,
      credits: candidate.catalogSize.credits,
    },
    selectionDiagnostics: candidate.selectionDiagnostics || null,
  }
}

function generatePuzzleFromCatalog(inputDate, usage, options) {
  const dateString = toDateStringUTC(inputDate)
  const {
    catalog,
    graph,
    filmKnownness,
    actorKnownness,
    filmPopularityNorm,
    actorPopularityNorm,
    filmValues,
    actorValues,
    filmPopularityValues,
    actorPopularityValues,
  } = ensurePreparedCatalog()
  const settings = options && typeof options === 'object' ? options : {}
  const seedText =
    typeof settings.seed === 'string' && settings.seed
      ? settings.seed
      : `hh-gen:${dateString}`

  const profileBase = getWeekdayProfile(dateString)
  const rng = seededRng(seedText)
  const usedFilmIds = new Set((usage && usage.filmIds) || [])
  const usedActorIds = new Set((usage && usage.actorIds) || [])
  const requestedAttempts =
    Number.isFinite(Number(settings.attemptsPerPass))
      ? Number(settings.attemptsPerPass)
      : Number(process.env.SEED_POOL_SIZE || 200)
  const attemptsPerPass = Math.max(12, Math.floor(requestedAttempts))
  const requestedMaxRelaxationPass = Number.isFinite(Number(settings.maxRelaxationPass))
    ? Number(settings.maxRelaxationPass)
    : 5
  const maxRelaxationPass = Math.max(0, Math.min(5, Math.floor(requestedMaxRelaxationPass)))

  const allCandidates = []
  const overlapFreeCandidates = []
  const seen = new Set()
  const passStats = []

  for (let pass = 0; pass <= maxRelaxationPass; pass += 1) {
    const profile = applyBandWidening(relaxedProfile(profileBase, pass))
    const split = splitConstrainedAnchors(profile.constrainedAnchorCount == null ? 6 : profile.constrainedAnchorCount)
    const filmKnownMin = getPercentileThreshold(filmValues, profile.knownMinPct)
    const filmKnownMax = getPercentileThreshold(filmValues, profile.knownMaxPct)
    const actorKnownMin = getPercentileThreshold(actorValues, profile.knownMinPct)
    const actorKnownMax = getPercentileThreshold(actorValues, profile.knownMaxPct)
    const filmKnownTarget = getPercentileThreshold(filmValues, profile.knownTargetPct)
    const actorKnownTarget = getPercentileThreshold(actorValues, profile.knownTargetPct)
    const filmPopMin = getPercentileThreshold(filmPopularityValues, Number(profile.popMinPct) || 0)
    const actorPopMin = getPercentileThreshold(actorPopularityValues, Number(profile.popMinPct) || 0)
    const targetKnownness = (filmKnownTarget + actorKnownTarget) / 2

    const filmPool = catalog.films.filter((film) => {
      const score = filmKnownness.get(film.id) || 0
      const pop = filmPopularityNorm.get(film.id) || 0
      return score >= filmKnownMin && score <= filmKnownMax && pop >= filmPopMin
    })
    const actorPool = catalog.actors.filter((actor) => {
      const score = actorKnownness.get(actor.id) || 0
      const pop = actorPopularityNorm.get(actor.id) || 0
      const density = Number(actor.film_density || 0)
      return score >= actorKnownMin && score <= actorKnownMax && pop >= actorPopMin && density >= profile.actorMinFilmDensity
    })
    const openFilmPool = catalog.films
    const openActorPool = catalog.actors.filter((actor) => Number(actor.film_density || 0) >= 2)

    const passStat = {
      pass,
      profileName: profile.name,
      filmPool: filmPool.length,
      actorPool: actorPool.length,
      openFilmPool: openFilmPool.length,
      openActorPool: openActorPool.length,
      actorMinFilmDensity: profile.actorMinFilmDensity,
      constrainedAnchorCount: split.constrainedFilms + split.constrainedActors,
      constrainedFilms: split.constrainedFilms,
      constrainedActors: split.constrainedActors,
      knownnessBand: {
        film: [Number(filmKnownMin.toFixed(3)), Number(filmKnownMax.toFixed(3))],
        actor: [Number(actorKnownMin.toFixed(3)), Number(actorKnownMax.toFixed(3))],
      },
      popularityMin: {
        pct: Number((Number(profile.popMinPct) || 0).toFixed(3)),
        film: Number(filmPopMin.toFixed(3)),
        actor: Number(actorPopMin.toFixed(3)),
      },
      targetKnownness: Number(targetKnownness.toFixed(3)),
      sampled: 0,
      validCandidates: 0,
      overlapFree: 0,
    }
    passStats.push(passStat)

    if (filmPool.length < split.constrainedFilms || actorPool.length < split.constrainedActors) continue
    if (openFilmPool.length < 3 || openActorPool.length < 3) continue

    for (let i = 0; i < attemptsPerPass; i += 1) {
      passStat.sampled += 1
      const films = sampleMixedPool(filmPool, openFilmPool, split.constrainedFilms, 3, rng)
      const actors = sampleMixedPool(actorPool, openActorPool, split.constrainedActors, 3, rng)
      if (!films || !actors || films.length < 3 || actors.length < 3) continue

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
        signature,
        films,
        actors,
        filmIds,
        actorIds,
        overlap,
        avgKnownness: avgKnown,
        targetKnownness,
        targetDelta: Math.abs(avgKnown - targetKnownness),
        totalDistance,
        profile,
        knownnessBand: {
          film: [Number(filmKnownMin.toFixed(3)), Number(filmKnownMax.toFixed(3))],
          actor: [Number(actorKnownMin.toFixed(3)), Number(actorKnownMax.toFixed(3))],
        },
        constrainedAnchorCount: split.constrainedFilms + split.constrainedActors,
        constrainedSplit: {
          films: split.constrainedFilms,
          actors: split.constrainedActors,
        },
        catalogSize: {
          films: catalog.films.length,
          actors: catalog.actors.length,
          credits: catalog.credits.length,
        },
      }

      allCandidates.push(candidate)
      passStat.validCandidates += 1
      if (overlap === 0) {
        overlapFreeCandidates.push(candidate)
        passStat.overlapFree += 1
      }
    }
  }

  if (allCandidates.length === 0) {
    throw new Error('Unable to generate a valid puzzle candidate from catalog')
  }

  const strictPick = pickCandidateFromPool(overlapFreeCandidates, rng, 'overlap-free')
  const fallbackPick = pickCandidateFromPool(allCandidates, rng, 'fallback-any')
  const selected = strictPick || fallbackPick

  if (!selected || !selected.candidate) {
    throw new Error('Unable to pick a candidate puzzle')
  }

  selected.candidate.selectionDiagnostics = {
    usedPool: strictPick ? 'overlap-free' : 'fallback-overlap',
    overlapFreeCandidates: overlapFreeCandidates.length,
    allCandidates: allCandidates.length,
    picker: selected.diagnostics,
    seedSource: seedText,
    attemptsPerPass,
    passStats,
  }

  return candidateToPuzzle(selected.candidate, dateString)
}

function getPuzzleForDate(inputDate) {
  return generatePuzzleFromCatalog(inputDate, { filmIds: [], actorIds: [] })
}

function getPuzzleForDateAvoidingUsage(inputDate, usage, options) {
  return generatePuzzleFromCatalog(inputDate, usage || { filmIds: [], actorIds: [] }, options)
}

function createRandomGenerationSeed(dateString) {
  const salt = typeof process.env.PUZZLE_RANDOM_SALT === 'string' ? process.env.PUZZLE_RANDOM_SALT : ''
  return `hh-gen:${dateString}:salt=${salt}:nonce=${randomUUID()}`
}

module.exports = {
  WEEKDAY_PROFILES,
  WEEKDAY_TARGET_FLAMES,
  WEEKDAY_TARGET_DIFFICULTY_SCORES,
  KNOWNNESS_FLAME_THRESHOLDS,
  getWeekdayProfile,
  getTargetFlamesForDate,
  getTargetDifficultyScoreForDate,
  getTargetKnownnessForFlames,
  knownnessToFlames,
  knownnessToDifficultyScore,
  getPuzzleForDate,
  getPuzzleForDateAvoidingUsage,
  recalculateAverageKnownnessFromAnchors,
  createRandomGenerationSeed,
  toDateStringUTC,
}
