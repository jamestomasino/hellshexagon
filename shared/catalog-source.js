'use strict'

const fs = require('fs')
const path = require('path')

function readJsonFile(file) {
  const raw = fs.readFileSync(file, 'utf8')
  return JSON.parse(raw)
}

function getCatalogCandidatePaths() {
  const candidates = []
  if (process.env.CATALOG_FILE) candidates.push(process.env.CATALOG_FILE)
  candidates.push(path.join(__dirname, '..', 'server-data', 'catalog.json'))
  candidates.push(path.join(__dirname, '..', 'data', 'catalog.json'))
  candidates.push(path.join(process.cwd(), 'server-data', 'catalog.json'))
  candidates.push(path.join(process.cwd(), 'data', 'catalog.json'))
  candidates.push('/var/task/server-data/catalog.json')
  candidates.push('/var/task/data/catalog.json')
  return candidates
}

function readCatalog() {
  const candidates = getCatalogCandidatePaths()
  let parsed = null
  for (const file of candidates) {
    try {
      parsed = readJsonFile(file)
      break
    } catch (_error) {
      // try next
    }
  }

  if (!parsed || !Array.isArray(parsed.films) || !Array.isArray(parsed.actors) || !Array.isArray(parsed.credits)) {
    throw new Error('Catalog file not found or invalid. Expected films/actors/credits arrays.')
  }

  return parsed
}

module.exports = {
  readCatalog,
  getCatalogCandidatePaths,
}
