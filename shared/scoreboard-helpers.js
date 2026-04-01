'use strict'

function buildScoreboardPayload(dateString, summaryRow, histogramRows) {
  const summary = summaryRow || {}
  const rows = Array.isArray(histogramRows) ? histogramRows : []
  return {
    date: dateString,
    solves: Number(summary.solves || 0),
    shortestChain: summary.shortest_chain == null ? null : Number(summary.shortest_chain),
    histogram: rows.map((row) => ({
      nodes: Number(row.nodes),
      count: Number(row.count),
    })),
  }
}

function applyFirstSuccessInMemory(stateSet, dateString, anonUid) {
  const set = stateSet || new Set()
  const key = `${dateString}:${anonUid}`
  if (set.has(key)) return { accepted: false, state: set }
  set.add(key)
  return { accepted: true, state: set }
}

function evaluateScoreCheckOutcome(allValid, totalNodes) {
  const safeTotalNodes = Number.isInteger(totalNodes) && totalNodes > 0 ? totalNodes : 0
  const safeAllValid = Boolean(allValid)
  return {
    allValid: safeAllValid,
    totalNodes: safeTotalNodes,
    won: safeAllValid,
  }
}

module.exports = {
  buildScoreboardPayload,
  applyFirstSuccessInMemory,
  evaluateScoreCheckOutcome,
}
