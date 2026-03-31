'use strict'

;(function initPuzzleLogic(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory()
    return
  }
  root.HHPuzzleLogic = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildPuzzleLogic() {
  function isPositiveInt(value) {
    return Number.isInteger(value) && value > 0
  }

  function resolveCardId(card) {
    if (!card || typeof card !== 'object') return null
    if (isPositiveInt(card.resolvedId)) return card.resolvedId
    if (isPositiveInt(card.entityId)) return card.entityId
    return null
  }

  function isAlternatingCards(cards) {
    if (!Array.isArray(cards) || cards.length < 2) return false
    for (let i = 1; i < cards.length; i += 1) {
      const prev = cards[i - 1]
      const next = cards[i]
      if (!prev || !next) return false
      if (prev.kind !== 'actor' && prev.kind !== 'film') return false
      if (next.kind !== 'actor' && next.kind !== 'film') return false
      if (prev.kind === next.kind) return false
    }
    return true
  }

  function hasResolvedConnectorPair(cards) {
    if (!Array.isArray(cards)) return false
    const middle = cards.slice(1, -1)
    if (middle.length < 2) return false
    return middle.every((card) => {
      if (!card || (card.kind !== 'actor' && card.kind !== 'film')) return false
      if (card.placeholder) return false
      return isPositiveInt(resolveCardId(card))
    })
  }

  function isPuzzleReadyForCheck(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return false
    return segments.every((cards) => isAlternatingCards(cards) && hasResolvedConnectorPair(cards))
  }

  function toSet(values) {
    if (values instanceof Set) return values
    return new Set(Array.isArray(values) ? values : [])
  }

  function collectDuplicateMiddleNodeIssues(chains, options) {
    const safeChains = Array.isArray(chains) ? chains : []
    const settings = options && typeof options === 'object' ? options : {}
    const anchorActorIds = toSet(settings.anchorActorIds)
    const anchorFilmIds = toSet(settings.anchorFilmIds)
    const usedMiddleActorIds = new Map()
    const usedMiddleFilmIds = new Map()

    const chainNodeIssues = safeChains.map(() => [])
    let hasIssues = false

    for (let chainIndex = 0; chainIndex < safeChains.length; chainIndex += 1) {
      const chain = safeChains[chainIndex]
      const cards = Array.isArray(chain && chain.cards) ? chain.cards : []
      const issues = chainNodeIssues[chainIndex]

      for (let i = 1; i < cards.length - 1; i += 1) {
        const card = cards[i]
        if (!card || (card.kind !== 'actor' && card.kind !== 'film')) continue
        const resolvedId = resolveCardId(card)
        if (!isPositiveInt(resolvedId)) continue
        const label = String(card.label || '').trim() || (card.kind === 'actor' ? 'Actor' : 'Film')

        if (card.kind === 'actor') {
          if (anchorActorIds.has(resolvedId)) {
            issues.push(`${label} duplicates an anchor actor.`)
            hasIssues = true
            continue
          }
          if (usedMiddleActorIds.has(resolvedId)) {
            issues.push(`${label} duplicates actor ${usedMiddleActorIds.get(resolvedId)}.`)
            hasIssues = true
            continue
          }
          usedMiddleActorIds.set(resolvedId, label)
          continue
        }

        if (anchorFilmIds.has(resolvedId)) {
          issues.push(`${label} duplicates an anchor film.`)
          hasIssues = true
          continue
        }
        if (usedMiddleFilmIds.has(resolvedId)) {
          issues.push(`${label} duplicates film ${usedMiddleFilmIds.get(resolvedId)}.`)
          hasIssues = true
          continue
        }
        usedMiddleFilmIds.set(resolvedId, label)
      }
    }

    return {
      chainNodeIssues,
      hasIssues,
    }
  }

  return {
    isAlternatingCards,
    hasResolvedConnectorPair,
    isPuzzleReadyForCheck,
    collectDuplicateMiddleNodeIssues,
  }
})
