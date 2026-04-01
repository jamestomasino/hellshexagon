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
    delete require.cache[require.resolve('../netlify/functions/daily-puzzle')]
    if (previous) require.cache[resolved] = previous
    else delete require.cache[resolved]
  }
}

test('daily-puzzle rejects invalid date parameter', async () => {
  await withMockedModule('../shared/puzzle-history', {
    toDateStringUTC: (value) => value,
    getPuzzleForDateWithoutGeneration: async () => ({ date: '2026-03-31', puzzle: {} }),
  }, async () => {
    const { handler } = require('../netlify/functions/daily-puzzle')
    const res = await handler({ queryStringParameters: { date: 'bad-date' } })
    assert.equal(res.statusCode, 400)
  })
})

test('daily-puzzle serves canonical latest active puzzle when requested date is out of bounds', async () => {
  await withMockedModule('../shared/puzzle-history', {
    toDateStringUTC: (value) => {
      if (value === '2026-04-03') return '2026-04-03'
      if (value instanceof Date) return '2026-04-01'
      if (!value) return '2026-04-01'
      return String(value)
    },
    getPuzzleForDateWithoutGeneration: async () => ({
      date: '2026-04-01',
      requestedDate: '2026-04-03',
      redirected: true,
      puzzle: { id: 'p1', films: [], actors: [] },
      source: 'neon-history-fallback-latest-active',
    }),
  }, async () => {
    const { handler } = require('../netlify/functions/daily-puzzle')
    const res = await handler({ queryStringParameters: { date: '2026-04-03' } })
    assert.equal(res.statusCode, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.date, '2026-04-01')
    assert.equal(body.redirected, true)
    assert.equal(body.requestedDate, '2026-04-03')
  })
})

test('daily-puzzle returns 404 when no active puzzle exists', async () => {
  await withMockedModule('../shared/puzzle-history', {
    toDateStringUTC: (value) => (value ? String(value) : '2026-04-01'),
    getPuzzleForDateWithoutGeneration: async () => null,
  }, async () => {
    const { handler } = require('../netlify/functions/daily-puzzle')
    const res = await handler({ queryStringParameters: { date: '2026-04-01' } })
    assert.equal(res.statusCode, 404)
    const body = JSON.parse(res.body)
    assert.equal(body.error, 'No active puzzle available yet')
  })
})
