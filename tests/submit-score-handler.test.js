'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

function withMockedModule(modulePath, mockedExports, fn) {
  const resolved = require.resolve(modulePath)
  const previous = require.cache[resolved]
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: mockedExports,
  }
  try {
    return fn()
  } finally {
    delete require.cache[require.resolve('../netlify/functions/submit-score')]
    if (previous) require.cache[resolved] = previous
    else delete require.cache[resolved]
  }
}

test('submit-score returns accepted true on first success', async () => {
  await withMockedModule('../shared/scoreboard-store', {
    submitFirstSuccessfulSolve: async () => ({ accepted: true }),
    getScoreboardForDate: async () => ({ date: '2026-03-31', solves: 1, shortestChain: 14, histogram: [] }),
  }, async () => {
    const { handler } = require('../netlify/functions/submit-score')
    const res = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ date: '2026-03-31', anonUid: 'anon-1', totalNodes: 14, totalLinks: 13 }),
    })
    assert.equal(res.statusCode, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.accepted, true)
    assert.equal(body.scoreboard.solves, 1)
  })
})

test('submit-score returns accepted false when already counted', async () => {
  await withMockedModule('../shared/scoreboard-store', {
    submitFirstSuccessfulSolve: async () => ({ accepted: false }),
    getScoreboardForDate: async () => ({ date: '2026-03-31', solves: 3, shortestChain: 12, histogram: [] }),
  }, async () => {
    const { handler } = require('../netlify/functions/submit-score')
    const res = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ date: '2026-03-31', anonUid: 'anon-1', totalNodes: 14, totalLinks: 13 }),
    })
    assert.equal(res.statusCode, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.accepted, false)
  })
})

test('submit-score enforces per-uid rate limit window', async () => {
  await withMockedModule('../shared/scoreboard-store', {
    submitFirstSuccessfulSolve: async () => ({ accepted: true }),
    getScoreboardForDate: async () => ({ date: '2026-03-31', solves: 1, shortestChain: 14, histogram: [] }),
  }, async () => {
    const { handler } = require('../netlify/functions/submit-score')
    let last = null
    for (let i = 0; i < 11; i += 1) {
      last = await handler({
        httpMethod: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.7' },
        body: JSON.stringify({ date: '2026-03-31', anonUid: 'anon-1', totalNodes: 14, totalLinks: 13 }),
      })
    }
    assert.ok(last)
    assert.equal(last.statusCode, 429)
  })
})
