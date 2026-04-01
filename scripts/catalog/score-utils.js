'use strict'

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp01(value) {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function logNorm(value, maxValue) {
  const v = Math.max(0, toNumber(value, 0))
  const max = Math.max(1, toNumber(maxValue, 1))
  return clamp01(Math.log1p(v) / Math.log1p(max))
}

function minMaxNorm(value, min, max) {
  const v = toNumber(value, min)
  if (max <= min) return 0
  return clamp01((v - min) / (max - min))
}

function percentile(values, pct) {
  if (!Array.isArray(values) || values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * pct)))
  return sorted[idx]
}

module.exports = {
  toNumber,
  clamp01,
  logNorm,
  minMaxNorm,
  percentile,
}
