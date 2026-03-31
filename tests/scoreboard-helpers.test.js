'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildScoreboardPayload,
  applyFirstSuccessInMemory,
  evaluateScoreCheckOutcome,
} = require('../shared/scoreboard-helpers')

test('buildScoreboardPayload maps summary/histogram rows', () => {
  const payload = buildScoreboardPayload(
    '2026-03-31',
    { solves: '3', shortest_chain: '17' },
    [{ nodes: '17', count: '2' }, { nodes: '22', count: '1' }],
  )
  assert.equal(payload.date, '2026-03-31')
  assert.equal(payload.solves, 3)
  assert.equal(payload.shortestChain, 17)
  assert.deepEqual(payload.histogram, [
    { nodes: 17, count: 2 },
    { nodes: 22, count: 1 },
  ])
})

test('applyFirstSuccessInMemory accepts first success only', () => {
  const state = new Set()
  const first = applyFirstSuccessInMemory(state, '2026-03-31', 'anon-1')
  const second = applyFirstSuccessInMemory(state, '2026-03-31', 'anon-1')
  const otherDay = applyFirstSuccessInMemory(state, '2026-04-01', 'anon-1')
  assert.equal(first.accepted, true)
  assert.equal(second.accepted, false)
  assert.equal(otherDay.accepted, true)
})

test('evaluateScoreCheckOutcome handles valid/invalid/too-long', () => {
  assert.deepEqual(evaluateScoreCheckOutcome(true, 20, 36), {
    allValid: true,
    totalNodes: 20,
    withinNodeLimit: true,
    won: true,
  })
  assert.deepEqual(evaluateScoreCheckOutcome(false, 20, 36), {
    allValid: false,
    totalNodes: 20,
    withinNodeLimit: true,
    won: false,
  })
  assert.deepEqual(evaluateScoreCheckOutcome(true, 40, 36), {
    allValid: true,
    totalNodes: 40,
    withinNodeLimit: false,
    won: false,
  })
})
