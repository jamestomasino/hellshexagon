(function () {
  'use strict'

  const boardEl = document.getElementById('hex-board')
  const loaderEl = document.getElementById('scene-loader')
  const dateToggleEl = document.getElementById('puzzle-date-toggle')
  const dateTextEl = document.getElementById('puzzle-date-text')
  const dateMenuEl = document.getElementById('puzzle-date-menu')
  const DATE_CACHE_KEY = 'hh_puzzle_dates_cache_v1'

  function hideLoader() {
    if (!loaderEl) return
    loaderEl.classList.add('is-hidden')
  }

  function getTodayUTCDateString() {
    return new Date().toISOString().slice(0, 10)
  }

  function navigateToDate(dateString) {
    const url = new URL(window.location.href)
    if (dateString) url.searchParams.set('date', dateString)
    else url.searchParams.delete('date')
    const query = url.searchParams.toString()
    window.location.href = query ? `${url.pathname}?${query}` : url.pathname
  }

  function formatDateLabel(dateString) {
    const parsed = new Date(`${dateString}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime())) return dateString
    return parsed.toLocaleDateString(undefined, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  function getDateParam() {
    const params = new URLSearchParams(window.location.search)
    const date = params.get('date')
    if (!date) return null
    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) return null
    return parsed.toISOString().slice(0, 10)
  }

  async function getCachedDateList(todayUTC) {
    try {
      const raw = window.localStorage.getItem(DATE_CACHE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed || parsed.cacheDay !== todayUTC || !Array.isArray(parsed.dates)) return null
      return parsed.dates
    } catch (_error) {
      return null
    }
  }

  function setCachedDateList(todayUTC, dates) {
    try {
      window.localStorage.setItem(
        DATE_CACHE_KEY,
        JSON.stringify({
          cacheDay: todayUTC,
          dates,
        }),
      )
    } catch (_error) {
      // no-op; caching is best effort only
    }
  }

  function closeDateMenu() {
    if (!dateMenuEl || !dateToggleEl) return
    dateMenuEl.hidden = true
    dateToggleEl.setAttribute('aria-expanded', 'false')
  }

  function openDateMenu() {
    if (!dateMenuEl || !dateToggleEl) return
    dateMenuEl.hidden = false
    dateToggleEl.setAttribute('aria-expanded', 'true')
  }

  function renderDateOptions(dates, selectedDate) {
    if (!dateMenuEl) return
    const sorted = Array.from(new Set(dates)).sort().reverse()
    dateMenuEl.innerHTML = ''

    if (sorted.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'puzzle-date-option'
      empty.textContent = 'No saved dates yet'
      empty.setAttribute('aria-disabled', 'true')
      dateMenuEl.appendChild(empty)
      return
    }

    sorted.forEach((date) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'puzzle-date-option'
      if (date === selectedDate) button.classList.add('is-selected')
      button.textContent = formatDateLabel(date)
      button.dataset.date = date
      button.addEventListener('click', () => {
        if (date === selectedDate) {
          closeDateMenu()
          return
        }
        navigateToDate(date)
      })
      dateMenuEl.appendChild(button)
    })
  }

  async function setupDatePicker() {
    if (!dateToggleEl || !dateTextEl || !dateMenuEl) return

    const todayUTC = getTodayUTCDateString()
    const selectedDate = getDateParam() || todayUTC
    dateTextEl.textContent = formatDateLabel(selectedDate)

    let dates = (await getCachedDateList(todayUTC)) || []
    if (dates.length === 0) {
      try {
        const response = await fetch('/api/dates')
        if (response.ok) {
          const payload = await response.json()
          if (payload && Array.isArray(payload.dates)) {
            dates = payload.dates
            setCachedDateList(todayUTC, dates)
          }
        }
      } catch (_error) {
        // no-op; fall back to selected date only
      }
    }

    if (!dates.includes(selectedDate)) dates.push(selectedDate)
    renderDateOptions(dates, selectedDate)

    dateToggleEl.addEventListener('click', () => {
      if (dateMenuEl.hidden) openDateMenu()
      else closeDateMenu()
    })

    document.addEventListener('click', (event) => {
      if (event.target === dateToggleEl || dateToggleEl.contains(event.target)) return
      if (event.target === dateMenuEl || dateMenuEl.contains(event.target)) return
      closeDateMenu()
    })

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDateMenu()
    })
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

  function buildAnchorLabels(puzzle) {
    return [
      `${puzzle.films[0].title} (${puzzle.films[0].year})`,
      puzzle.actors[0].name,
      `${puzzle.films[1].title} (${puzzle.films[1].year})`,
      puzzle.actors[1].name,
      `${puzzle.films[2].title} (${puzzle.films[2].year})`,
      puzzle.actors[2].name,
    ]
  }

  function wrapTextLines(ctx, text, maxWidth) {
    const words = text.split(' ')
    const lines = []
    let current = ''
    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (ctx.measureText(next).width > maxWidth && current) {
        lines.push(current)
        current = word
      } else {
        current = next
      }
    }
    if (current) lines.push(current)
    return lines
  }

  function createNoise(seed) {
    let x = seed || 1337
    return function rand() {
      x ^= x << 13
      x ^= x >> 17
      x ^= x << 5
      return ((x < 0 ? ~x + 1 : x) % 10000) / 10000
    }
  }

  function createVelvetTextures(THREE) {
    const size = 1024
    const colorCanvas = document.createElement('canvas')
    colorCanvas.width = size
    colorCanvas.height = size
    const cctx = colorCanvas.getContext('2d')

    const roughCanvas = document.createElement('canvas')
    roughCanvas.width = size
    roughCanvas.height = size
    const rctx = roughCanvas.getContext('2d')

    const bumpCanvas = document.createElement('canvas')
    bumpCanvas.width = size
    bumpCanvas.height = size
    const bctx = bumpCanvas.getContext('2d')

    const grad = cctx.createRadialGradient(size * 0.48, size * 0.46, size * 0.07, size * 0.5, size * 0.5, size * 0.76)
    grad.addColorStop(0, '#6d1f28')
    grad.addColorStop(0.46, '#43151d')
    grad.addColorStop(1, '#1a070d')
    cctx.fillStyle = grad
    cctx.fillRect(0, 0, size, size)

    const lerp = (a, b, t) => a + (b - a) * t
    const smooth = (t) => t * t * (3 - 2 * t)
    const hash = (x, y, s) => {
      const n = Math.sin((x * 127.1 + y * 311.7 + s * 74.7) * 0.0131) * 43758.5453123
      return n - Math.floor(n)
    }
    const valueNoise = (x, y, scale, seed) => {
      const fx = x / scale
      const fy = y / scale
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = smooth(fx - x0)
      const ty = smooth(fy - y0)
      const n00 = hash(x0, y0, seed)
      const n10 = hash(x0 + 1, y0, seed)
      const n01 = hash(x0, y0 + 1, seed)
      const n11 = hash(x0 + 1, y0 + 1, seed)
      return lerp(lerp(n00, n10, tx), lerp(n01, n11, tx), ty)
    }

    const colorData = cctx.getImageData(0, 0, size, size)
    const roughData = rctx.createImageData(size, size)
    const bumpData = bctx.createImageData(size, size)

    for (let i = 0; i < colorData.data.length; i += 4) {
      const p = i / 4
      const x = p % size
      const y = Math.floor(p / size)
      const u = x / size
      const v = y / size
      const dx = u - 0.5
      const dy = v - 0.5
      const dist = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.35)
      const vignette = 1 - dist

      const n1 = valueNoise(x, y, 18, 11)
      const n2 = valueNoise(x, y, 54, 19)
      const n3 = valueNoise(x, y, 124, 37)
      const fbm = n1 * 0.56 + n2 * 0.3 + n3 * 0.14 - 0.5
      const nap = Math.sin((u * 0.84 + v * 0.16) * Math.PI * 168) * 0.05
      const pile = 0.58 + vignette * 0.36 + nap + fbm * 0.22
      const lift = pile * 31 + fbm * 11

      colorData.data[i] = Math.max(0, Math.min(255, colorData.data[i] + lift * 1.08))
      colorData.data[i + 1] = Math.max(0, Math.min(255, colorData.data[i + 1] + lift * 0.26))
      colorData.data[i + 2] = Math.max(0, Math.min(255, colorData.data[i + 2] + lift * 0.48))

      const rough = Math.floor(184 + (0.5 - pile) * 62 + (n2 - 0.5) * 18)
      roughData.data[i] = roughData.data[i + 1] = roughData.data[i + 2] = Math.max(0, Math.min(255, rough))
      roughData.data[i + 3] = 255

      const bump = Math.floor(118 + pile * 36 + (n3 - 0.5) * 16)
      bumpData.data[i] = bumpData.data[i + 1] = bumpData.data[i + 2] = Math.max(0, Math.min(255, bump))
      bumpData.data[i + 3] = 255
    }
    cctx.putImageData(colorData, 0, 0)
    rctx.putImageData(roughData, 0, 0)
    bctx.putImageData(bumpData, 0, 0)

    const colorTex = new THREE.CanvasTexture(colorCanvas)
    colorTex.colorSpace = THREE.SRGBColorSpace
    colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping
    colorTex.repeat.set(2.5, 2.5)

    const roughTex = new THREE.CanvasTexture(roughCanvas)
    roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping
    roughTex.repeat.set(2.8, 2.8)

    const bumpTex = new THREE.CanvasTexture(bumpCanvas)
    bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping
    bumpTex.repeat.set(2.8, 2.8)

    return { colorTex, roughTex, bumpTex }
  }

  function hexPath(ctx, cx, cy, r) {
    ctx.beginPath()
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI * 2 * i) / 6
      const x = cx + r * Math.cos(angle)
      const y = cy + r * Math.sin(angle)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }

  function createPaperTextures(THREE) {
    const size = 1024
    const colorCanvas = document.createElement('canvas')
    colorCanvas.width = size
    colorCanvas.height = size
    const cctx = colorCanvas.getContext('2d')
    cctx.fillStyle = '#ffffff'
    cctx.fillRect(0, 0, size, size)

    const roughCanvas = document.createElement('canvas')
    roughCanvas.width = size
    roughCanvas.height = size
    const rctx = roughCanvas.getContext('2d')

    const rand = createNoise(9341)
    const colorData = cctx.getImageData(0, 0, size, size)
    const roughData = rctx.createImageData(size, size)
    for (let i = 0; i < colorData.data.length; i += 4) {
      const g = (rand() - 0.5) * 14
      colorData.data[i] = Math.max(0, Math.min(255, colorData.data[i] + g))
      colorData.data[i + 1] = Math.max(0, Math.min(255, colorData.data[i + 1] + g * 0.9))
      colorData.data[i + 2] = Math.max(0, Math.min(255, colorData.data[i + 2] + g * 0.8))
      roughData.data[i] = roughData.data[i + 1] = roughData.data[i + 2] = Math.floor(202 + rand() * 35)
      roughData.data[i + 3] = 255
    }
    cctx.putImageData(colorData, 0, 0)
    rctx.putImageData(roughData, 0, 0)

    const colorTex = new THREE.CanvasTexture(colorCanvas)
    colorTex.colorSpace = THREE.SRGBColorSpace
    const roughTex = new THREE.CanvasTexture(roughCanvas)
    return { colorTex, roughTex }
  }

  function createWoodTextures(THREE) {
    const size = 512
    const colorCanvas = document.createElement('canvas')
    colorCanvas.width = size
    colorCanvas.height = size
    const cctx = colorCanvas.getContext('2d')

    const roughCanvas = document.createElement('canvas')
    roughCanvas.width = size
    roughCanvas.height = size
    const rctx = roughCanvas.getContext('2d')

    const bumpCanvas = document.createElement('canvas')
    bumpCanvas.width = size
    bumpCanvas.height = size
    const bctx = bumpCanvas.getContext('2d')

    const hash = (x, y, s) => {
      const n = Math.sin((x * 97.3 + y * 203.9 + s * 61.7) * 0.021) * 43758.5453123
      return n - Math.floor(n)
    }

    const colorData = cctx.createImageData(size, size)
    const roughData = rctx.createImageData(size, size)
    const bumpData = bctx.createImageData(size, size)

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4
        const u = x / size
        const v = y / size
        const warp = Math.sin(v * Math.PI * 10 + u * Math.PI * 1.8) * 0.12
        const grainAxis = u * 24 + warp
        const ring = Math.sin(grainAxis * Math.PI * 2)
        const streak = Math.sin(grainAxis * Math.PI * 8 + v * Math.PI * 3.1) * 0.25
        const n = hash(x, y, 9) - 0.5
        const tone = 0.58 + ring * 0.14 + streak * 0.08 + n * 0.08

        let wr = Math.max(0, Math.min(255, 154 + tone * 74))
        let wg = Math.max(0, Math.min(255, 137 + tone * 66))
        let wb = Math.max(0, Math.min(255, 112 + tone * 56))
        // Lighten wood texture color by 50% toward white.
        wr = wr + (255 - wr) * 0.5
        wg = wg + (255 - wg) * 0.5
        wb = wb + (255 - wb) * 0.5
        colorData.data[i] = Math.max(0, Math.min(255, wr))
        colorData.data[i + 1] = Math.max(0, Math.min(255, wg))
        colorData.data[i + 2] = Math.max(0, Math.min(255, wb))
        colorData.data[i + 3] = 255

        const rough = 156 + (1 - tone) * 62 + n * 24
        roughData.data[i] = roughData.data[i + 1] = roughData.data[i + 2] = Math.max(0, Math.min(255, rough))
        roughData.data[i + 3] = 255

        const bump = 118 + ring * 28 + streak * 22 + n * 18
        bumpData.data[i] = bumpData.data[i + 1] = bumpData.data[i + 2] = Math.max(0, Math.min(255, bump))
        bumpData.data[i + 3] = 255
      }
    }

    cctx.putImageData(colorData, 0, 0)
    rctx.putImageData(roughData, 0, 0)
    bctx.putImageData(bumpData, 0, 0)

    const colorTex = new THREE.CanvasTexture(colorCanvas)
    colorTex.colorSpace = THREE.SRGBColorSpace
    colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping
    colorTex.repeat.set(3.1, 1.2)
    colorTex.anisotropy = 4

    const roughTex = new THREE.CanvasTexture(roughCanvas)
    roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping
    roughTex.repeat.set(3.1, 1.2)

    const bumpTex = new THREE.CanvasTexture(bumpCanvas)
    bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping
    bumpTex.repeat.set(3.1, 1.2)

    return { colorTex, roughTex, bumpTex }
  }

  function createGoldOverlayTexture(THREE) {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 1024
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const cx = canvas.width * 0.5
    const cy = canvas.height * 0.5
    const radius = canvas.width * 0.47

    ctx.strokeStyle = '#ffffff'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.lineWidth = 14
    hexPath(ctx, cx, cy, radius)
    ctx.stroke()

    ctx.lineWidth = 4.5
    hexPath(ctx, cx, cy, radius * 0.945)
    ctx.stroke()

    ctx.lineWidth = 3
    hexPath(ctx, cx, cy, radius * 0.905)
    ctx.stroke()

    ctx.lineWidth = 3.5
    for (let i = 0; i < 6; i += 1) {
      const a = (Math.PI * 2 * i) / 6
      const x1 = cx + radius * 0.93 * Math.cos(a)
      const y1 = cy + radius * 0.93 * Math.sin(a)
      const x2 = cx + radius * 0.84 * Math.cos(a)
      const y2 = cy + radius * 0.84 * Math.sin(a)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }

  function createSpotPoolTexture(THREE) {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 1024
    const ctx = canvas.getContext('2d')
    const cx = canvas.width * 0.5
    const cy = canvas.height * 0.5

    const grad = ctx.createRadialGradient(cx, cy, canvas.width * 0.1, cx, cy, canvas.width * 0.52)
    grad.addColorStop(0, 'rgba(255, 194, 140, 0.4)')
    grad.addColorStop(0.34, 'rgba(228, 138, 94, 0.24)')
    grad.addColorStop(0.72, 'rgba(154, 58, 42, 0.08)')
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    return texture
  }

  function createInkTexture(THREE, label) {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 1024
    const ctx = canvas.getContext('2d')
    const cx = canvas.width * 0.5
    const cy = canvas.height * 0.5
    const radius = canvas.width * 0.44
    const drawAreaWidth = canvas.width * 0.62
    const drawAreaHeight = canvas.height * 0.42

    let chosen = null
    for (let size = 120; size >= 24; size -= 2) {
      ctx.font = `700 ${size}px "Cinzel", "Times New Roman", serif`
      const lines = wrapTextLines(ctx, label, drawAreaWidth)
      const lineHeight = size * 1.14
      const totalHeight = lines.length * lineHeight
      const widest = Math.max(...lines.map((line) => ctx.measureText(line).width))
      if (widest <= drawAreaWidth && totalHeight <= drawAreaHeight) {
        chosen = { size, lines }
        break
      }
    }
    if (!chosen) {
      const size = 24
      ctx.font = `700 ${size}px "Cinzel", "Times New Roman", serif`
      chosen = { size, lines: wrapTextLines(ctx, label, drawAreaWidth) }
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${chosen.size}px "Cinzel", "Times New Roman", serif`
    const lineHeight = chosen.size * 1.14
    const startY = cy - ((chosen.lines.length - 1) * lineHeight) / 2

    const rand = createNoise(7719)
    chosen.lines.forEach((line, i) => {
      const y = startY + i * lineHeight
      for (let k = 0; k < 3; k += 1) {
        const jitterX = (rand() - 0.5) * 1.6
        const jitterY = (rand() - 0.5) * 1.2
        ctx.fillStyle = `rgba(26, 22, 19, ${0.28 + rand() * 0.2})`
        ctx.fillText(line, cx + jitterX, y + jitterY)
      }
      ctx.fillStyle = 'rgba(18, 14, 12, 0.96)'
      ctx.fillText(line, cx, y)
    })

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    texture.needsUpdate = true
    return texture
  }

  async function initThreeScene(daily) {
    const THREE = await import('https://unpkg.com/three@0.161.0/build/three.module.js')
    const labels = buildAnchorLabels(daily.puzzle)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.58
    boardEl.innerHTML = ''
    boardEl.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x1b0d0f, 30, 78)

    // Natural mid-lens framing: pull back a bit from the original shot
    // without the overly compressed look of a very long lens.
    const camera = new THREE.PerspectiveCamera(18, 1, 0.1, 160)
    const cameraBasePos = new THREE.Vector3(0, 18.5, 15.6)
    camera.position.copy(cameraBasePos)
    camera.lookAt(0, 0, 0)
    const focusCenter = new THREE.Vector3(0, 0, 0)
    const maxSideShift = 1.35
    const maxVerticalShift = 1.35
    let interactionDebounce = null
    let orientationEnabled = false
    let pendingNx = 0
    let pendingNy = 0
    const supportsOrientation = Boolean(window.DeviceOrientationEvent)
    const isTouchPrimary =
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
    const useTiltInput = isTouchPrimary && supportsOrientation
    const usePointerInput = !useTiltInput

    function clampUnit(value) {
      return Math.max(-1, Math.min(1, value))
    }

    function applyCameraShift(nx, ny) {
      camera.position.set(
        cameraBasePos.x + nx * maxSideShift,
        cameraBasePos.y + ny * maxVerticalShift,
        cameraBasePos.z,
      )
      // Counter-rotate after lateral move so the focal point stays pinned
      // to the middle of the table/card ring.
      camera.lookAt(focusCenter)
    }

    function queueCameraShift(nx, ny) {
      pendingNx = clampUnit(nx)
      pendingNy = clampUnit(ny)
      if (interactionDebounce !== null) clearTimeout(interactionDebounce)
      interactionDebounce = setTimeout(() => {
        applyCameraShift(pendingNx, pendingNy)
        render()
        interactionDebounce = null
      }, 16)
    }

    function onDeviceOrientation(event) {
      if (typeof event.gamma !== 'number' || typeof event.beta !== 'number') return
      // gamma: left/right, beta: front/back. Clamp to subtle ranges.
      const nx = clampUnit(event.gamma / 24)
      const ny = clampUnit((event.beta - 45) / 24)
      queueCameraShift(nx, ny)
    }

    function enableOrientationListener() {
      if (orientationEnabled) return
      window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true })
      orientationEnabled = true
    }

    async function requestOrientationPermissionIfNeeded() {
      const Orientation = window.DeviceOrientationEvent
      if (!Orientation) return
      if (typeof Orientation.requestPermission === 'function') {
        try {
          const permission = await Orientation.requestPermission()
          if (permission === 'granted') enableOrientationListener()
        } catch (_error) {
          // no-op
        }
      } else {
        enableOrientationListener()
      }
    }

    const hemi = new THREE.HemisphereLight(0x5e3f35, 0x170f0d, 0.24)
    scene.add(hemi)

    const ambient = new THREE.AmbientLight(0x6a5645, 0.12)
    scene.add(ambient)

    const key = new THREE.SpotLight(0xffe0bc, 12.5, 38, Math.PI / 8.4, 0.62, 1.45)
    key.position.set(0, 14.6, 0.6)
    key.target.position.set(0, 0, 0)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = 0.00004
    key.shadow.normalBias = 0.02
    key.shadow.radius = 5
    scene.add(key)
    scene.add(key.target)

    const sideAccent = new THREE.SpotLight(0xffd3a1, 0, 29, Math.PI / 8.1, 0.4, 1.9)
    sideAccent.position.set(-9.5, 6.8, 8.6)
    sideAccent.target.position.set(1.6, 0.12, -1.2)
    sideAccent.castShadow = true
    sideAccent.shadow.mapSize.set(1536, 1536)
    sideAccent.shadow.bias = -0.00012
    sideAccent.shadow.radius = 3
    scene.add(sideAccent)
    scene.add(sideAccent.target)

    const edgeKick = new THREE.SpotLight(0xffc08a, 0, 26, Math.PI / 10.2, 0.32, 2.15)
    edgeKick.position.set(8.8, 2.7, 9.2)
    edgeKick.target.position.set(0, 0.14, 0)
    edgeKick.castShadow = true
    edgeKick.shadow.mapSize.set(1024, 1024)
    edgeKick.shadow.bias = -0.0001
    edgeKick.shadow.radius = 2
    scene.add(edgeKick)
    scene.add(edgeKick.target)

    const rim = new THREE.DirectionalLight(0x7f8eaa, 0.45)
    rim.position.set(5.6, 4.8, -5.8)
    scene.add(rim)

    // Two asymmetric side fills (intentionally not 90-degree offsets).
    // Left offset ~78%, right offset ~58% relative to a 90-degree side placement.
    const leftFill = new THREE.DirectionalLight(0xffedd2, 0.72)
    leftFill.position.set(-6.9, 4.1, 3.4)
    leftFill.castShadow = true
    leftFill.shadow.mapSize.set(1536, 1536)
    leftFill.shadow.camera.left = -12
    leftFill.shadow.camera.right = 12
    leftFill.shadow.camera.top = 12
    leftFill.shadow.camera.bottom = -12
    leftFill.shadow.camera.near = 1
    leftFill.shadow.camera.far = 40
    leftFill.shadow.bias = -0.00009
    scene.add(leftFill)

    const rightFill = new THREE.DirectionalLight(0xfff2dc, 0.42)
    rightFill.position.set(4.7, 3.9, 5.6)
    rightFill.castShadow = true
    rightFill.shadow.mapSize.set(1024, 1024)
    rightFill.shadow.camera.left = -11
    rightFill.shadow.camera.right = 11
    rightFill.shadow.camera.top = 11
    rightFill.shadow.camera.bottom = -11
    rightFill.shadow.camera.near = 1
    rightFill.shadow.camera.far = 36
    rightFill.shadow.bias = -0.00008
    scene.add(rightFill)

    // Low-angle reveal light to lift vertical block faces.
    const sideReveal = new THREE.DirectionalLight(0xffd8b3, 0.56)
    sideReveal.position.set(0.6, 1.9, 8.4)
    scene.add(sideReveal)

    const { colorTex, roughTex, bumpTex } = createVelvetTextures(THREE)
    const tableGeo = new THREE.CircleGeometry(8.9, 96)
    const tableMat = new THREE.MeshPhysicalMaterial({
      color: 0x6a1a24,
      map: colorTex,
      roughnessMap: roughTex,
      bumpMap: bumpTex,
      bumpScale: 0.22,
      roughness: 0.95,
      metalness: 0.0,
      sheen: 1.0,
      sheenColor: new THREE.Color(0x8e2633),
      sheenRoughness: 0.56,
      emissive: 0x12060a,
      emissiveIntensity: 0.05,
      clearcoat: 0.03,
      clearcoatRoughness: 0.96,
    })
    const table = new THREE.Mesh(tableGeo, tableMat)
    table.rotation.x = -Math.PI / 2
    table.receiveShadow = true
    scene.add(table)

    const spotPoolTex = createSpotPoolTexture(THREE)
    const spotPool = new THREE.Mesh(
      new THREE.CircleGeometry(6.3, 64),
      new THREE.MeshBasicMaterial({
        map: spotPoolTex,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    )
    spotPool.rotation.x = -Math.PI / 2
    spotPool.position.set(0, 0.015, 0)
    scene.add(spotPool)

    const ringSize = 1.47
    const sqrt3 = Math.sqrt(3)
    const ringCoords = [
      { q: 0, r: -1 },
      { q: 1, r: -1 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
      { q: -1, r: 0 },
    ]
    const tilt = [0.012, 0.008, 0.01, 0.012, 0.008, 0.01]

    function axialToWorld(hex) {
      return {
        x: ringSize * (1.5 * hex.q),
        z: ringSize * (sqrt3 * (hex.r + hex.q / 2)),
      }
    }

    const orientation = Math.PI / 6 + Math.PI / 3
    const cardCoreGeo = new THREE.CylinderGeometry(1.23, 1.23, 0.165, 6)
    cardCoreGeo.rotateY(orientation)
    const cardLowerBevelGeo = new THREE.CylinderGeometry(1.27, 1.23, 0.055, 6)
    cardLowerBevelGeo.rotateY(orientation)
    const cardUpperBevelGeo = new THREE.CylinderGeometry(1.23, 1.27, 0.055, 6)
    cardUpperBevelGeo.rotateY(orientation)
    const brassGeo = new THREE.CylinderGeometry(1.34, 1.34, 0.21, 6)
    brassGeo.rotateY(orientation)
    const faceGeo = new THREE.CylinderGeometry(1.17, 1.17, 0.028, 6)
    faceGeo.rotateY(orientation)

    const { colorTex: paperTex, roughTex: paperRough } = createPaperTextures(THREE)
    const { colorTex: woodTex, roughTex: woodRough, bumpTex: woodBump } = createWoodTextures(THREE)
    const goldOverlayTex = createGoldOverlayTexture(THREE)

    const cardCoreSideMat = new THREE.MeshStandardMaterial({
      color: 0x8f6041,
      map: woodTex,
      bumpMap: woodBump,
      metalness: 0.0,
      roughness: 0.24,
      bumpScale: 0.18,
      emissive: 0x5b3a1f,
      emissiveIntensity: 0.28,
    })
    const cardCoreCapMat = new THREE.MeshStandardMaterial({
      color: 0xb28a58,
      metalness: 0.35,
      roughness: 0.42,
    })

    const lowerBevelSideMat = new THREE.MeshStandardMaterial({
      color: 0xa77753,
      map: woodTex,
      bumpMap: woodBump,
      metalness: 0.0,
      roughness: 0.22,
      bumpScale: 0.2,
      emissive: 0x6a4628,
      emissiveIntensity: 0.24,
    })
    const lowerBevelCapMat = new THREE.MeshStandardMaterial({
      color: 0xbe9561,
      metalness: 0.38,
      roughness: 0.38,
    })

    const upperBevelSideMat = new THREE.MeshStandardMaterial({
      color: 0xb7865f,
      map: woodTex,
      bumpMap: woodBump,
      metalness: 0.0,
      roughness: 0.2,
      bumpScale: 0.2,
      emissive: 0x725032,
      emissiveIntensity: 0.22,
    })
    const upperBevelCapMat = new THREE.MeshStandardMaterial({
      color: 0xc9a16a,
      metalness: 0.42,
      roughness: 0.34,
    })

    ringCoords.forEach((coord, i) => {
      const pos = axialToWorld(coord)

      const brass = new THREE.Mesh(
        brassGeo,
        new THREE.MeshStandardMaterial({
          color: 0xaf8c6b,
          map: woodTex,
          roughnessMap: woodRough,
          bumpMap: woodBump,
          metalness: 0.0,
          roughness: 0.22,
          bumpScale: 0.22,
          emissive: 0x3b2514,
          emissiveIntensity: 0.08,
        }),
      )
      brass.position.set(pos.x, 0.09, pos.z)
      brass.rotation.set(tilt[i], 0, 0)
      brass.castShadow = true
      brass.receiveShadow = true
      scene.add(brass)

      const card = new THREE.Mesh(
        cardCoreGeo,
        [cardCoreSideMat, cardCoreCapMat, cardCoreCapMat],
      )
      card.position.set(pos.x, 0.1375, pos.z)
      card.rotation.set(tilt[i], 0, 0)
      card.castShadow = true
      card.receiveShadow = false
      scene.add(card)

      const cardLowerBevel = new THREE.Mesh(
        cardLowerBevelGeo,
        [lowerBevelSideMat, lowerBevelCapMat, lowerBevelCapMat],
      )
      cardLowerBevel.position.set(pos.x, 0.0275, pos.z)
      cardLowerBevel.rotation.set(tilt[i], 0, 0)
      cardLowerBevel.castShadow = true
      cardLowerBevel.receiveShadow = false
      scene.add(cardLowerBevel)

      const cardUpperBevel = new THREE.Mesh(
        cardUpperBevelGeo,
        [upperBevelSideMat, upperBevelCapMat, upperBevelCapMat],
      )
      cardUpperBevel.position.set(pos.x, 0.2475, pos.z)
      cardUpperBevel.rotation.set(tilt[i], 0, 0)
      cardUpperBevel.castShadow = true
      cardUpperBevel.receiveShadow = false
      scene.add(cardUpperBevel)

      const paperFace = new THREE.Mesh(
        faceGeo,
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          map: paperTex,
          roughnessMap: paperRough,
          bumpMap: paperRough,
          roughness: 0.46,
          metalness: 0.0,
          bumpScale: 0.08,
          clearcoat: 0.2,
          clearcoatRoughness: 0.36,
        }),
      )
      paperFace.position.set(pos.x, 0.289, pos.z)
      paperFace.rotation.set(tilt[i], 0, 0)
      paperFace.castShadow = true
      scene.add(paperFace)

      const goldOverlay = new THREE.Mesh(
        faceGeo,
        new THREE.MeshPhysicalMaterial({
          color: i % 2 === 0 ? 0xe8a57f : 0xaec6ee,
          metalness: 0.9,
          roughness: 0.08,
          alphaMap: goldOverlayTex,
          transparent: true,
          opacity: 0.98,
          clearcoat: 1.0,
          clearcoatRoughness: 0.06,
          reflectivity: 0.95,
          emissive: i % 2 === 0 ? 0x8a3e1f : 0x345a95,
          emissiveIntensity: 0.14,
          depthWrite: false,
        }),
      )
      goldOverlay.position.set(pos.x, 0.303, pos.z)
      goldOverlay.rotation.set(tilt[i], 0, 0)
      scene.add(goldOverlay)

      const inkTex = createInkTexture(THREE, labels[i])
      const inkOverlay = new THREE.Mesh(
        faceGeo,
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          metalness: 0,
          roughness: 0.98,
          map: inkTex,
          transparent: true,
          opacity: 0.96,
          depthWrite: false,
        }),
      )
      inkOverlay.position.set(pos.x, 0.309, pos.z)
      inkOverlay.rotation.set(tilt[i], 0, 0)
      scene.add(inkOverlay)
    })

    function updateCameraFraming(w, h) {
      const aspect = w / h
      if (aspect < 0.62) {
        camera.fov = 26
        cameraBasePos.set(0, 20.0, 20.2)
      } else if (aspect < 0.86) {
        camera.fov = 23
        cameraBasePos.set(0, 19.2, 18.6)
      } else {
        camera.fov = 18
        cameraBasePos.set(0, 18.5, 15.6)
      }
      camera.aspect = aspect
      camera.updateProjectionMatrix()
      applyCameraShift(pendingNx, pendingNy)
    }

    function resize() {
      const w = boardEl.clientWidth
      const h = boardEl.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      updateCameraFraming(w, h)
      render()
    }

    resize()
    window.addEventListener('resize', resize)

    if (usePointerInput) {
      boardEl.addEventListener('pointermove', (event) => {
        const rect = boardEl.getBoundingClientRect()
        if (!rect.width || !rect.height) return
        const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1
        const ny = 1 - ((event.clientY - rect.top) / rect.height) * 2
        queueCameraShift(nx, ny)
      })

      boardEl.addEventListener('pointerleave', () => {
        if (interactionDebounce !== null) {
          clearTimeout(interactionDebounce)
          interactionDebounce = null
        }
        applyCameraShift(0, 0)
        render()
      })
    }

    if (useTiltInput) {
      boardEl.addEventListener('pointerdown', () => {
        requestOrientationPermissionIfNeeded()
      }, { once: true })

      if (typeof window.DeviceOrientationEvent.requestPermission !== 'function') {
        enableOrientationListener()
      }
    }

    function render() {
      renderer.render(scene, camera)
    }

    render()
  }

  setupDatePicker()

  fetchDailyPuzzle()
    .then(async (daily) => {
      if (document.fonts && document.fonts.ready) {
        try {
          await document.fonts.ready
        } catch (_error) {
          // no-op; fallback fonts are acceptable
        }
      }
      await initThreeScene(daily)
      hideLoader()
    })
    .catch(() => {
      hideLoader()
      boardEl.textContent = 'Failed to load puzzle.'
    })
})()
