'use strict'

const { ensurePuzzleForDate, toDateStringUTC } = require('../../shared/puzzle-history')

exports.handler = async function handler() {
  const today = toDateStringUTC(new Date())
  const payload = await ensurePuzzleForDate(today)

  console.log('[rotate-daily] Daily puzzle stored', {
    date: payload.date,
    puzzleId: payload.puzzle && payload.puzzle.id,
    source: payload.source,
    strategy: payload.strategy || 'deterministic-seed',
    overlap: payload.overlap || 0,
    difficultyProfile: payload.difficultyProfile || null,
    relaxationPass: Number.isInteger(payload.relaxationPass) ? payload.relaxationPass : null,
    distanceScore: Number.isFinite(payload.distanceScore) ? payload.distanceScore : null,
    targetDifficultyFlames: Number.isInteger(payload.targetDifficultyFlames) ? payload.targetDifficultyFlames : null,
    estimatedDifficultyFlames: Number.isInteger(payload.estimatedDifficultyFlames) ? payload.estimatedDifficultyFlames : null,
    generationOptionsEvaluated: Number.isInteger(payload.generationOptionsEvaluated)
      ? payload.generationOptionsEvaluated
      : null,
    knownnessBand: payload.knownnessBand || null,
  })

  if (Number.isInteger(payload.relaxationPass) && payload.relaxationPass > 0) {
    console.warn('[rotate-daily] Puzzle generated using relaxed profile constraints', {
      date: payload.date,
      difficultyProfile: payload.difficultyProfile || null,
      relaxationPass: payload.relaxationPass,
      strategy: payload.strategy || null,
    })
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      date: payload.date,
      puzzleId: payload.puzzle && payload.puzzle.id,
      source: payload.source,
      strategy: payload.strategy || 'deterministic-seed',
      overlap: payload.overlap || 0,
      difficultyProfile: payload.difficultyProfile || null,
      relaxationPass: Number.isInteger(payload.relaxationPass) ? payload.relaxationPass : null,
      distanceScore: Number.isFinite(payload.distanceScore) ? payload.distanceScore : null,
      targetDifficultyFlames: Number.isInteger(payload.targetDifficultyFlames) ? payload.targetDifficultyFlames : null,
      estimatedDifficultyFlames: Number.isInteger(payload.estimatedDifficultyFlames) ? payload.estimatedDifficultyFlames : null,
      generationOptionsEvaluated: Number.isInteger(payload.generationOptionsEvaluated)
        ? payload.generationOptionsEvaluated
        : null,
      knownnessBand: payload.knownnessBand || null,
    }),
  }
}
