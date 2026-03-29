'use strict'

const { getStore } = require('@netlify/blobs')

const STORE_NAME = process.env.PUZZLE_STORE_NAME || 'hells-hexagon-puzzles'
const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID
const token =
  process.env.NETLIFY_BLOBS_TOKEN ||
  process.env.NETLIFY_AUTH_TOKEN ||
  process.env.NETLIFY_TOKEN ||
  process.env.NETLIFY_API_TOKEN ||
  process.env.BLOBS_TOKEN

if (!siteID || !token) {
  console.error('Missing SITE_ID/NETLIFY_SITE_ID or NETLIFY_BLOBS_TOKEN (or token alias).')
  process.exit(1)
}

function entryKey(dateString) {
  return `history/${dateString}`
}

async function main() {
  const store = getStore({ name: STORE_NAME, siteID, token })
  const index = await store.get('history/index', { type: 'json' })
  const dates = (index && Array.isArray(index.dates) ? index.dates : []).slice().sort()

  const filmIds = new Set()
  const actorIds = new Set()

  for (const date of dates) {
    const entry = await store.get(entryKey(date), { type: 'json' })
    const puzzle = entry && entry.puzzle
    if (!puzzle) continue

    for (const film of puzzle.films || []) {
      if (typeof film.id === 'number') filmIds.add(film.id)
    }
    for (const actor of puzzle.actors || []) {
      if (typeof actor.id === 'number') actorIds.add(actor.id)
    }
  }

  const payload = {
    filmIds: Array.from(filmIds).sort((a, b) => a - b),
    actorIds: Array.from(actorIds).sort((a, b) => a - b),
    updatedAt: new Date().toISOString(),
    rebuiltFromDates: dates.length,
  }

  await store.setJSON('history/usage', payload)

  console.log('[rebuild-usage-index] complete', {
    store: STORE_NAME,
    dates: dates.length,
    filmIds: payload.filmIds.length,
    actorIds: payload.actorIds.length,
  })
}

main().catch((error) => {
  console.error('[rebuild-usage-index] failed', error)
  process.exit(1)
})
