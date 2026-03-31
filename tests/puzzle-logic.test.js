'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  isAlternatingCards,
  hasResolvedConnectorPair,
  isPuzzleReadyForCheck,
  collectDuplicateMiddleNodeIssues,
} = require('../shared/puzzle-logic')

test('isPuzzleReadyForCheck requires alternating cards and resolved middle connectors in every segment', () => {
  const readySegment = [
    { kind: 'actor', label: 'A', entityId: 1, endpoint: true },
    { kind: 'film', label: 'F1', entityId: 101, placeholder: false },
    { kind: 'actor', label: 'B', entityId: 2, placeholder: false },
    { kind: 'film', label: 'F2', entityId: 102, endpoint: true },
  ]

  assert.equal(isAlternatingCards(readySegment), true)
  assert.equal(hasResolvedConnectorPair(readySegment), true)
  assert.equal(isPuzzleReadyForCheck([readySegment, readySegment]), true)

  const missingResolved = [
    { kind: 'actor', label: 'A', entityId: 1, endpoint: true },
    { kind: 'film', label: 'F1', entityId: null, placeholder: true },
    { kind: 'actor', label: 'B', entityId: 2, placeholder: false },
    { kind: 'film', label: 'F2', entityId: 102, endpoint: true },
  ]
  assert.equal(hasResolvedConnectorPair(missingResolved), false)
  assert.equal(isPuzzleReadyForCheck([readySegment, missingResolved]), false)

  const nonAlternating = [
    { kind: 'actor', label: 'A', entityId: 1, endpoint: true },
    { kind: 'actor', label: 'B', entityId: 2, placeholder: false },
    { kind: 'film', label: 'F2', entityId: 102, endpoint: true },
  ]
  assert.equal(isAlternatingCards(nonAlternating), false)
  assert.equal(isPuzzleReadyForCheck([readySegment, nonAlternating]), false)
})

test('collectDuplicateMiddleNodeIssues detects anchor and cross-chain duplicate nodes', () => {
  const chains = [
    {
      cards: [
        { kind: 'actor', label: 'Anchor Actor', resolvedId: 10, endpoint: true },
        { kind: 'film', label: 'Anchor Film Reuse', resolvedId: 100 },
        { kind: 'actor', label: 'Middle Actor One', resolvedId: 20 },
        { kind: 'film', label: 'Anchor Film', resolvedId: 101, endpoint: true },
      ],
    },
    {
      cards: [
        { kind: 'actor', label: 'Anchor Actor Two', resolvedId: 11, endpoint: true },
        { kind: 'film', label: 'Another Film', resolvedId: 200 },
        { kind: 'actor', label: 'Middle Actor Again', resolvedId: 20 },
        { kind: 'film', label: 'Second Film', resolvedId: 201, endpoint: true },
      ],
    },
  ]

  const result = collectDuplicateMiddleNodeIssues(chains, {
    anchorActorIds: new Set([10, 11]),
    anchorFilmIds: new Set([100, 101]),
  })

  assert.equal(result.hasIssues, true)
  assert.deepEqual(result.chainNodeIssues[0], ['Anchor Film Reuse duplicates an anchor film.'])
  assert.deepEqual(result.chainNodeIssues[1], ['Middle Actor Again duplicates actor Middle Actor One.'])
})
