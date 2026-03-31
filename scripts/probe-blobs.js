'use strict'

const { getStore } = require('@netlify/blobs')

async function main() {
  const store = getStore(process.env.PUZZLE_STORE_NAME || 'hells-hexagon-puzzles')
  const index = await store.get('history/index', { type: 'json' })
  const dates = Array.isArray(index && index.dates) ? index.dates : []
  const today = new Date().toISOString().slice(0, 10)
  const latest = dates.slice().sort().slice(-3)
  console.log(JSON.stringify({ hasIndex: Boolean(index), dateCount: dates.length, latest, includesToday: dates.includes(today) }, null, 2))
}

main().catch((e) => {
  console.error(e.name, e.message)
  process.exit(1)
})
