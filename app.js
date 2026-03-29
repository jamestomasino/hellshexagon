(function () {
  'use strict'

  const SVG_NS = 'http://www.w3.org/2000/svg'
  const boardEl = document.getElementById('hex-board')

  function getDateParam() {
    const params = new URLSearchParams(window.location.search)
    const date = params.get('date')
    if (!date) return null
    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) return null
    return parsed.toISOString().slice(0, 10)
  }

  async function fetchDailyPuzzle() {
    const dateParam = getDateParam()
    const query = dateParam ? `?date=${encodeURIComponent(dateParam)}` : ''

    try {
      const response = await fetch(`/api/daily${query}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (_error) {
      const fallback = await fetch('/data/puzzles.json')
      const puzzles = await fallback.json()
      const date = dateParam || new Date().toISOString().slice(0, 10)
      const daySeed = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000)
      const index = Math.abs(daySeed) % puzzles.length
      return { date, puzzle: puzzles[index] }
    }
  }

  function buildAnchorNodes(puzzle) {
    return [
      { type: 'film', label: `${puzzle.films[0].title} (${puzzle.films[0].year})` },
      { type: 'actor', label: puzzle.actors[0].name },
      { type: 'film', label: `${puzzle.films[1].title} (${puzzle.films[1].year})` },
      { type: 'actor', label: puzzle.actors[1].name },
      { type: 'film', label: `${puzzle.films[2].title} (${puzzle.films[2].year})` },
      { type: 'actor', label: puzzle.actors[2].name },
    ]
  }

  function wrapLabel(label, maxChars) {
    const words = label.split(' ')
    const lines = []
    let current = ''

    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (next.length > maxChars && current) {
        lines.push(current)
        current = word
      } else {
        current = next
      }
    }

    if (current) lines.push(current)
    return lines.slice(0, 4)
  }

  function lineFitsInsideHex(lineBox, center, hexSize, padding) {
    const sqrt3 = Math.sqrt(3)
    const yOffset = Math.abs(lineBox.y + lineBox.height / 2 - center.y)
    const verticalLimit = (sqrt3 / 2) * hexSize - padding
    if (yOffset > verticalLimit) return false

    // For flat-top regular hex, available half-width at a given y offset is:
    // halfWidth(y) = size - |y| / sqrt(3)
    const allowedHalfWidth = hexSize - yOffset / sqrt3 - padding
    if (allowedHalfWidth <= 0) return false

    return lineBox.width / 2 <= allowedHalfWidth
  }

  function labelFitsInsideHex(textElement, center, hexSize, padding) {
    const lineNodes = textElement.querySelectorAll('tspan')
    for (const lineNode of lineNodes) {
      const lineBox = lineNode.getBBox()
      if (!lineFitsInsideHex(lineBox, center, hexSize, padding)) return false
    }
    return true
  }

  function fitLabelToHex(textElement, options) {
    const { maxFont, minFont, center, hexSize, padding } = options
    for (let fontSize = maxFont; fontSize >= minFont; fontSize -= 1) {
      textElement.setAttribute('font-size', String(fontSize))
      if (labelFitsInsideHex(textElement, center, hexSize, padding)) return
    }
    textElement.setAttribute('font-size', String(minFont))
  }

  function renderBoard(puzzle) {
    boardEl.innerHTML = ''
    const anchors = buildAnchorNodes(puzzle)

    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 700 760')
    svg.setAttribute('class', 'hex-svg')
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', 'Daily puzzle hex grid')

    const size = 104
    const origin = { x: 350, y: 380 }
    const sqrt3 = Math.sqrt(3)
    const ring = [
      { q: 0, r: -1 },
      { q: 1, r: -1 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
      { q: -1, r: 0 },
    ]

    function axialToPixel(hex) {
      return {
        x: origin.x + size * (1.5 * hex.q),
        y: origin.y + size * (sqrt3 * (hex.r + hex.q / 2)),
      }
    }

    function polygonPoints(center) {
      const points = []
      for (let i = 0; i < 6; i += 1) {
        const angle = (2 * Math.PI * i) / 6
        points.push(`${center.x + size * Math.cos(angle)},${center.y + size * Math.sin(angle)}`)
      }
      return points.join(' ')
    }

    anchors.forEach((node, index) => {
      const center = axialToPixel(ring[index])
      const group = document.createElementNS(SVG_NS, 'g')
      group.setAttribute('class', `hex-node-svg ${node.type}`)

      const polygon = document.createElementNS(SVG_NS, 'polygon')
      polygon.setAttribute('points', polygonPoints(center))
      group.appendChild(polygon)

      const label = document.createElementNS(SVG_NS, 'text')
      label.setAttribute('class', 'node-label')
      label.setAttribute('x', String(center.x))
      label.setAttribute('y', String(center.y))

      const lines = wrapLabel(node.label, node.type === 'film' ? 18 : 16)
      const startOffsetEm = -((lines.length - 1) * 0.58)
      lines.forEach((line, lineIndex) => {
        const tspan = document.createElementNS(SVG_NS, 'tspan')
        tspan.setAttribute('x', String(center.x))
        tspan.setAttribute('dy', lineIndex === 0 ? `${startOffsetEm}em` : '1.16em')
        tspan.textContent = line
        label.appendChild(tspan)
      })

      group.appendChild(label)
      svg.appendChild(group)

      fitLabelToHex(label, {
        maxFont: node.type === 'film' ? 25 : 28,
        minFont: node.type === 'film' ? 11 : 12,
        center,
        hexSize: size,
        padding: 16,
      })
    })

    boardEl.appendChild(svg)
  }

  fetchDailyPuzzle()
    .then((daily) => renderBoard(daily.puzzle))
    .catch(() => {
      boardEl.textContent = 'Failed to load puzzle.'
    })
})()
