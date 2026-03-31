'use strict'

const { connectLambda, getStore } = require('@netlify/blobs')

exports.handler = async function handler(event) {
  try {
    if (event && event.blobs && typeof connectLambda === 'function') {
      connectLambda(event)
    }

    const params = (event && event.queryStringParameters) || {}
    const probeDate = typeof params.date === 'string' ? params.date : null

    const store = getStore(process.env.PUZZLE_STORE_NAME || 'hells-hexagon-puzzles')
    const index = await store.get('history/index', { type: 'json' })
    const indexDates = Array.isArray(index && index.dates) ? Array.from(new Set(index.dates)).sort() : []
    const listed = await store.list({ prefix: 'history/' })
    const listedDates = (listed.blobs || [])
      .map((blob) => (blob && typeof blob.key === 'string' ? blob.key : null))
      .filter((key) => key && /^history\/\d{4}-\d{2}-\d{2}$/.test(key))
      .map((key) => key.slice('history/'.length))
      .sort()

    let probeEntry = null
    if (probeDate) {
      probeEntry = await store.get(`history/${probeDate}`, { type: 'json' })
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        ok: true,
        hasIndex: Boolean(index),
        indexDateCount: indexDates.length,
        indexLatest: indexDates.slice(-3),
        listedDateCount: listedDates.length,
        listedLatest: listedDates.slice(-3),
        probeDate,
        probeFound: Boolean(probeEntry && probeEntry.puzzle),
      }),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: false, name: error && error.name, message: error && error.message }),
    }
  }
}
