'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

function withMockedModules(mocks, fn) {
  const previous = new Map()
  try {
    for (const [modulePath, mockedExports] of Object.entries(mocks)) {
      const resolved = require.resolve(modulePath)
      previous.set(resolved, require.cache[resolved])
      require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: mockedExports,
      }
    }
    return fn()
  } finally {
    delete require.cache[require.resolve('../netlify/functions/check-edge')]
    for (const [modulePath] of Object.entries(mocks)) {
      const resolved = require.resolve(modulePath)
      const prior = previous.get(resolved)
      if (prior) require.cache[resolved] = prior
      else delete require.cache[resolved]
    }
  }
}

test('check-edge returns 400 when ids are missing', async () => {
  await withMockedModules({
    '../shared/neon-cache': {
      ensureSchema: async () => {},
      getCachedEdge: async () => null,
      cacheEdgeResult: async () => {},
    },
    '../shared/tmdb': {
      tmdbFetch: async () => ({ cast: [] }),
    },
  }, async () => {
    const { handler } = require('../netlify/functions/check-edge')
    const res = await handler({ queryStringParameters: {} })
    assert.equal(res.statusCode, 400)
    const body = JSON.parse(res.body)
    assert.match(body.error, /Expected actorId and filmId/)
  })
})

test('check-edge returns cached result and skips TMDB fetch', async () => {
  let fetchCalls = 0
  await withMockedModules({
    '../shared/neon-cache': {
      ensureSchema: async () => {},
      getCachedEdge: async () => ({ isValid: true, checkedAt: '2026-03-31T00:00:00.000Z' }),
      cacheEdgeResult: async () => {
        throw new Error('cacheEdgeResult should not be called on cache hit')
      },
    },
    '../shared/tmdb': {
      tmdbFetch: async () => {
        fetchCalls += 1
        return { cast: [] }
      },
    },
  }, async () => {
    const { handler } = require('../netlify/functions/check-edge')
    const res = await handler({
      queryStringParameters: { actorId: '11', filmId: '22' },
    })
    assert.equal(res.statusCode, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.cached, true)
    assert.equal(body.isValid, true)
    assert.equal(fetchCalls, 0)
  })
})

test('check-edge parses ids from POST body and bypasses cache when skipCache=true', async () => {
  let cacheReads = 0
  let cacheWrites = 0
  await withMockedModules({
    '../shared/neon-cache': {
      ensureSchema: async () => {},
      getCachedEdge: async () => {
        cacheReads += 1
        return { isValid: false, checkedAt: '2026-03-31T00:00:00.000Z' }
      },
      cacheEdgeResult: async () => {
        cacheWrites += 1
      },
    },
    '../shared/tmdb': {
      tmdbFetch: async () => ({ cast: [{ id: 77 }] }),
    },
  }, async () => {
    const { handler } = require('../netlify/functions/check-edge')
    const res = await handler({
      queryStringParameters: { skipCache: '1' },
      body: JSON.stringify({ actorId: 44, filmId: 77 }),
    })
    assert.equal(res.statusCode, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.cached, false)
    assert.equal(body.skipCache, true)
    assert.equal(body.isValid, true)
    assert.equal(cacheReads, 0)
    assert.equal(cacheWrites, 1)
  })
})
