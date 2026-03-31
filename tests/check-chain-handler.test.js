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
    delete require.cache[require.resolve('../netlify/functions/check-chain')]
    for (const [modulePath] of Object.entries(mocks)) {
      const resolved = require.resolve(modulePath)
      const prior = previous.get(resolved)
      if (prior) require.cache[resolved] = prior
      else delete require.cache[resolved]
    }
  }
}

test('check-chain rejects non-POST methods', async () => {
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
    const { handler } = require('../netlify/functions/check-chain')
    const res = await handler({ httpMethod: 'GET' })
    assert.equal(res.statusCode, 405)
  })
})

test('check-chain returns empty results for invalid edge input', async () => {
  await withMockedModules({
    '../shared/neon-cache': {
      ensureSchema: async () => {},
      getCachedEdge: async () => null,
      cacheEdgeResult: async () => {},
    },
    '../shared/tmdb': {
      tmdbFetch: async () => {
        throw new Error('tmdbFetch should not be called for invalid input')
      },
    },
  }, async () => {
    const { handler } = require('../netlify/functions/check-chain')
    const res = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ edges: [{ actorId: 'x', filmId: 2 }, { actorId: 1, filmId: 0 }] }),
    })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), { results: [] })
  })
})

test('check-chain de-duplicates pairs, uses cache, and fetches unresolved per actor', async () => {
  const cacheLookups = []
  const cachedWrites = []
  const tmdbPaths = []

  await withMockedModules({
    '../shared/neon-cache': {
      ensureSchema: async () => {},
      getCachedEdge: async (actorId, filmId) => {
        cacheLookups.push([actorId, filmId])
        if (actorId === 10 && filmId === 200) return { isValid: true }
        return null
      },
      cacheEdgeResult: async (actorId, filmId, isValid) => {
        cachedWrites.push([actorId, filmId, isValid])
      },
    },
    '../shared/tmdb': {
      tmdbFetch: async (path) => {
        tmdbPaths.push(path)
        if (path === '/person/10/movie_credits') return { cast: [{ id: 201 }] }
        if (path === '/person/11/movie_credits') return { cast: [{ id: 300 }] }
        return { cast: [] }
      },
    },
  }, async () => {
    const { handler } = require('../netlify/functions/check-chain')
    const res = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        edges: [
          { actorId: 10, filmId: 200 },
          { actorId: 10, filmId: 200 },
          { actorId: 10, filmId: 201 },
          { actorId: 11, filmId: 301 },
        ],
      }),
    })

    assert.equal(res.statusCode, 200)
    const body = JSON.parse(res.body)
    assert.deepEqual(body.results, [
      { actorId: 10, filmId: 200, isValid: true },
      { actorId: 10, filmId: 200, isValid: true },
      { actorId: 10, filmId: 201, isValid: true },
      { actorId: 11, filmId: 301, isValid: false },
    ])

    assert.deepEqual(cacheLookups, [
      [10, 200],
      [10, 201],
      [11, 301],
    ])
    assert.deepEqual(tmdbPaths, [
      '/person/10/movie_credits',
      '/person/11/movie_credits',
    ])
    assert.deepEqual(cachedWrites, [
      [10, 201, true],
      [11, 301, false],
    ])
  })
})
