'use strict'

function getTmdbToken() {
  const token = process.env.TMDB_TOKEN
  if (!token) throw new Error('Missing TMDB_TOKEN environment variable')
  return token
}

async function tmdbFetch(path, params = {}) {
  const token = getTmdbToken()
  const url = new URL(`https://api.themoviedb.org/3${path}`)

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    url.searchParams.set(key, String(value))
  })

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`TMDB request failed (${response.status}): ${details || 'no details'}`)
  }

  return await response.json()
}

module.exports = {
  tmdbFetch,
}
