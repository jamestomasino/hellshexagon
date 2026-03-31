'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { __test } = require('../netlify/functions/search-entities')

test('mapTmdbResults prioritizes exact film title+year matches', () => {
  const payload = {
    results: [
      { id: 3, title: 'The Red Line', release_date: '2001-01-01', popularity: 60 },
      { id: 1, title: 'Red', release_date: '2010-10-15', popularity: 30 },
      { id: 2, title: 'Red', release_date: '2008-05-12', popularity: 70 },
    ],
  }

  const results = __test.mapTmdbResults('film', payload, 5, 'Red (2010)')
  assert.equal(results[0].label, 'Red (2010)')
  assert.equal(results[0].id, 1)
})

test('splitTitleAndYear supports trailing bare year queries', () => {
  const parsed = __test.splitTitleAndYear('red 2010')
  assert.equal(parsed.title, 'red')
  assert.equal(parsed.year, '2010')
})

test('shouldUseCachedResults requires full-sized film cache for requested limit', () => {
  assert.equal(__test.shouldUseCachedResults('film', { results: [{ id: 1 }], resultIds: [1] }, 8), false)
  assert.equal(__test.shouldUseCachedResults('film', { results: [{ id: 1 }], resultIds: [1, 2, 3, 4] }, 3), true)
  assert.equal(__test.shouldUseCachedResults('actor', { results: [{ id: 1 }], resultIds: [1] }, 8), true)
})
