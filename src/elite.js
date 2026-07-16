import './style.css'
import { trackVisitorCount, trackOnlineCount } from './firebase.js'
import { playBeep, playTick, playSpawnSound, getMuted, setMuted, getVolume, setVolume, getPreset, setPreset } from './audio.js'
import { ELITE_MONSTERS } from './elite-data.js'

const $ = id => document.getElementById(id)
const sectionsEl = $('sections')
const summaryEl = $('summary')
const toastEl = $('toast')
const pillEl = $('status-pill')
const timelineSec = $('timeline-section')

const STORAGE_KEY = 'elite_timers_v1'
const TRIGGERED_KEY = 'elite_alarm_triggered_v1'
const fmtName = str => str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
const getInitial = name => (name || '?').charAt(0).toUpperCase()

let layout = localStorage.getItem('eliteLayout') || 'compact'
let alarmLeadMin = parseInt(localStorage.getItem('alarmLeadMin') || '5', 10)
let showTimeline = localStorage.getItem('eliteTimeline') === 'true'
let filterText = ''
let tickerId = null
let spawnCountdownActive = null
let spawnedElite = null
let lastSpawnSecond = -1
const countdownRegistry = new Map()
const triggered = new Set(JSON.parse(localStorage.getItem(TRIGGERED_KEY) || '[]'))

function readTimers() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

let timers = readTimers()

const saveTimers = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(timers))
const saveTriggered = () => localStorage.setItem(TRIGGERED_KEY, JSON.stringify([...triggered]))
const fmtCountdown = value => {
  const d = Math.max(0, value - Date.now())
  const h = Math.floor(d / 3.6e6)
  const m = Math.floor((d % 3.6e6) / 6e4)
  const s = Math.floor((d % 6e4) / 1e3)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
const fmtTime = value => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const fmtRespawn = ms => `${Math.round(ms / 60000)}m`
const showToast = msg => { if (toastEl) toastEl.textContent = msg }
const setPill = (text, variant) => {
  if (!pillEl) return
  pillEl.textContent = text
  pillEl.className = variant === 'positive' ? 'positive' : variant === 'negative' ? 'negative' : ''
}

function getEliteState(elite) {
  const nextSpawnMs = Number(timers[elite.name] || 0)
  return {
    ...elite,
    nextSpawnMs: nextSpawnMs > Date.now() ? nextSpawnMs : 0,
  }
}

function getVisibleElites() {
  const q = filterText.toLowerCase()
  return ELITE_MONSTERS
    .map(getEliteState)
    .filter(elite => {
      if (!q) return true
      return [elite.name, elite.area, elite.region, String(elite.level)].some(v => v.toLowerCase().includes(q))
    })
}

function registerEliteNodes(elite, card, countdownEl, initialEl) {
  countdownRegistry.set(elite.name, { card, countdownEl, initialEl })
}

function urgency(nextSpawnMs) {
  if (!nextSpawnMs) return { ready: true, urgent: false, soon: false }
  const delta = nextSpawnMs - Date.now()
  return {
    ready: delta <= 0,
    urgent: delta <= 5 * 60 * 1000 && delta > 0,
    soon: delta <= 15 * 60 * 1000 && delta > 0,
  }
}

function killElite(name) {
  const elite = ELITE_MONSTERS.find(item => item.name === name)
  if (!elite) return
  const nextSpawnMs = Date.now() + elite.respawnMs
  timers[name] = nextSpawnMs
  triggered.delete(name)
  saveTimers()
  saveTriggered()
  showToast(`${name} killed - respawns in ${fmtRespawn(elite.respawnMs)}`)
  render()
}

function clearElite(name) {
  delete timers[name]
  triggered.delete(name)
  saveTimers()
  saveTriggered()
  showToast(`${name} reset`)
  render()
}

function buildCompactCard(elite) {
  const state = urgency(elite.nextSpawnMs)
  const cdClass = state.urgent ? 'urgent' : state.soon ? 'soon' : ''
  const card = document.createElement('div')
  card.className = `boss-card${state.urgent ? ' urgent' : state.soon ? ' soon' : ''}`
  card.innerHTML = `
    <div class="boss-initial${cdClass ? ' ' + cdClass : ''}">${getInitial(elite.name)}</div>
    <div class="boss-info">
      <div class="boss-name">${fmtName(elite.name)}</div>
      <div class="boss-meta">Lv. ${elite.level} · ${elite.area} · ${fmtRespawn(elite.respawnMs)}</div>
      <div class="boss-countdown${cdClass ? ' ' + cdClass : ''}">${elite.nextSpawnMs ? fmtCountdown(elite.nextSpawnMs) : 'Ready'}</div>
    </div>
    <div class="boss-actions">
      ${elite.nextSpawnMs ? `<span class="date-tag">${fmtTime(elite.nextSpawnMs)}</span>` : ''}
      <button class="kill-btn" data-elite="${elite.name}">Killed</button>
      ${elite.nextSpawnMs ? `<button class="set-btn" data-clear="${elite.name}">Reset</button>` : ''}
    </div>`
  registerEliteNodes(elite, card, card.querySelector('.boss-countdown'), card.querySelector('.boss-initial'))
  card.querySelector('.kill-btn')?.addEventListener('click', () => killElite(elite.name))
  card.querySelector('.set-btn')?.addEventListener('click', () => clearElite(elite.name))
  return card
}

function buildDeckCard(elite) {
  const state = urgency(elite.nextSpawnMs)
  const cdClass = state.urgent ? 'urgent' : state.soon ? 'soon' : ''
  const card = document.createElement('div')
  card.className = `deck-card${state.urgent ? ' urgent' : state.soon ? ' soon-card' : ''}`
  card.innerHTML = `
    <div class="deck-initial${cdClass ? ' ' + cdClass : ''}">${getInitial(elite.name)}</div>
    <div class="deck-name">${fmtName(elite.name)}</div>
    <div class="deck-loc">Lv. ${elite.level} · ${elite.area}</div>
    <div class="deck-time">${elite.nextSpawnMs ? fmtTime(elite.nextSpawnMs) : fmtRespawn(elite.respawnMs)}</div>
    <div class="deck-cd${cdClass ? ' ' + cdClass : ''}">${elite.nextSpawnMs ? fmtCountdown(elite.nextSpawnMs) : 'Ready'}</div>
    <div class="deck-btns">
      <button class="kill-btn" data-elite="${elite.name}">Killed</button>
      ${elite.nextSpawnMs ? `<button class="set-btn" data-clear="${elite.name}">Reset</button>` : ''}
    </div>`
  registerEliteNodes(elite, card, card.querySelector('.deck-cd'), card.querySelector('.deck-initial'))
  card.querySelector('.kill-btn')?.addEventListener('click', () => killElite(elite.name))
  card.querySelector('.set-btn')?.addEventListener('click', () => clearElite(elite.name))
  return card
}

function appendSection(label, items) {
  if (!items.length) return
  const section = document.createElement('div')
  section.className = 'section-wrap'
  const header = document.createElement('div')
  header.className = 'section-header'
  header.innerHTML = `<span class="section-label">${label}</span><span class="section-count">${items.length}</span>`
  section.appendChild(header)
  if (layout === 'deck') {
    const scroll = document.createElement('div')
    scroll.className = 'deck-scroll'
    scroll.addEventListener('wheel', e => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!delta) return
      scroll.scrollLeft += delta * 3
      e.preventDefault()
      e.stopPropagation()
    }, { passive: false })
    for (const elite of items) scroll.appendChild(buildDeckCard(elite))
    section.appendChild(scroll)
  } else {
    const grid = document.createElement('div')
    grid.className = 'boss-grid'
    for (const elite of items) grid.appendChild(buildCompactCard(elite))
    section.appendChild(grid)
  }
  sectionsEl.appendChild(section)
}

function render() {
  sectionsEl.innerHTML = ''
  summaryEl.innerHTML = ''
  countdownRegistry.clear()

  const visible = getVisibleElites()
  const active = visible.filter(elite => elite.nextSpawnMs).sort((a, b) => a.nextSpawnMs - b.nextSpawnMs)
  const ready = visible.filter(elite => !elite.nextSpawnMs).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
  const next = active[0]

  summaryEl.innerHTML = `<span>${visible.length} elite${visible.length === 1 ? '' : 's'}${filterText ? ' (filtered)' : ''}</span>${next ? `<span>· Next: <strong style="color:var(--text2);font-weight:600;">${fmtName(next.name)}</strong> in ${fmtCountdown(next.nextSpawnMs)}</span>` : '<span>· All ready</span>'}`
  setPill(active.length ? `${active.length} active` : 'All ready', active.length ? 'positive' : '')
  appendSection('Active Timers', active)

  // Group ready by region
  const readyByRegion = {}
  for (const elite of ready) {
    const reg = elite.region || 'Unknown'
    if (!readyByRegion[reg]) readyByRegion[reg] = []
    readyByRegion[reg].push(elite)
  }

  // Consistent region sort order
  const regionOrder = ['Dien', 'Lindris', 'Ulan', 'Serbis']
  for (const reg of regionOrder) {
    const items = readyByRegion[reg] || []
    if (items.length) {
      appendSection(`Ready · ${reg}`, items)
    }
  }

  // Fallback for any other regions not in the order
  for (const [reg, items] of Object.entries(readyByRegion)) {
    if (!regionOrder.includes(reg) && items.length) {
      appendSection(`Ready · ${reg}`, items)
    }
  }

  renderTimeline(active)
}

function renderTimeline(active) {
  timelineSec.innerHTML = ''
  if (!showTimeline || !active.length) { timelineSec.style.display = 'none'; return }
  timelineSec.style.display = ''
  const now = Date.now()
  const endMs = active[active.length - 1].nextSpawnMs
  const rangeMs = endMs - now
  if (rangeMs <= 0) { timelineSec.style.display = 'none'; return }
  const header = document.createElement('div')
  header.className = 'section-header'
  header.innerHTML = '<span class="section-label">Timeline</span>'
  timelineSec.appendChild(header)
  const wrap = document.createElement('div')
  wrap.className = 'timeline-wrap'
  const bar = document.createElement('div')
  bar.className = 'timeline-bar'
  const nowM = document.createElement('div')
  nowM.className = 'timeline-now'
  nowM.style.left = '0%'
  bar.appendChild(nowM)
  const nowL = document.createElement('div')
  nowL.className = 'timeline-now-label'
  nowL.style.left = '0%'
  nowL.textContent = 'Now'
  bar.appendChild(nowL)
  for (const elite of active) {
    const pct = ((elite.nextSpawnMs - now) / rangeMs) * 100
    const marker = document.createElement('div')
    const state = urgency(elite.nextSpawnMs)
    marker.className = `timeline-marker${state.urgent ? ' urgent-marker' : state.soon ? ' soon-marker' : ''}`
    marker.style.left = pct + '%'
    marker.textContent = getInitial(elite.name)
    marker.title = `${elite.name} - ${fmtTime(elite.nextSpawnMs)} (${fmtCountdown(elite.nextSpawnMs)})`
    bar.appendChild(marker)
    const label = document.createElement('div')
    label.className = 'timeline-label'
    label.style.left = pct + '%'
    label.textContent = elite.name.length > 10 ? elite.name.slice(0, 9) + '...' : elite.name
    bar.appendChild(label)
  }
  wrap.appendChild(bar)
  timelineSec.appendChild(wrap)
}

function updateCountdowns() {
  let changed = false
  for (const elite of ELITE_MONSTERS.map(getEliteState)) {
    const entry = countdownRegistry.get(elite.name)
    if (!elite.nextSpawnMs && timers[elite.name]) {
      delete timers[elite.name]
      triggered.delete(elite.name)
      changed = true
    }
    if (!entry) continue
    const state = urgency(elite.nextSpawnMs)
    const text = elite.nextSpawnMs ? fmtCountdown(elite.nextSpawnMs) : 'Ready'
    entry.countdownEl.textContent = text
    entry.countdownEl.classList.toggle('urgent', state.urgent)
    entry.countdownEl.classList.toggle('soon', !state.urgent && state.soon)
    entry.card.classList.toggle('urgent', state.urgent)
    entry.card.classList.toggle('soon', !entry.card.classList.contains('deck-card') && !state.urgent && state.soon)
    entry.card.classList.toggle('soon-card', entry.card.classList.contains('deck-card') && !state.urgent && state.soon)
    entry.initialEl.classList.toggle('urgent', state.urgent)
    entry.initialEl.classList.toggle('soon', !state.urgent && state.soon)
  }
  if (changed) {
    saveTimers()
    saveTriggered()
    render()
    return
  }
  const active = getVisibleElites().filter(elite => elite.nextSpawnMs).sort((a, b) => a.nextSpawnMs - b.nextSpawnMs)
  const next = active[0]
  summaryEl.innerHTML = `<span>${getVisibleElites().length} elite${getVisibleElites().length === 1 ? '' : 's'}${filterText ? ' (filtered)' : ''}</span>${next ? `<span>· Next: <strong style="color:var(--text2);font-weight:600;">${fmtName(next.name)}</strong> in ${fmtCountdown(next.nextSpawnMs)}</span>` : '<span>· All ready</span>'}`
}

function ensureNotificationPermission() {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  Notification.requestPermission()
  return false
}

function triggerAlarm(elite) {
  const msg = `${elite.name} spawning in ${alarmLeadMin} min (${fmtTime(elite.nextSpawnMs)})`
  showToast(msg)
  setPill('Alarm: ' + elite.name, 'negative')
  playBeep()
  if (Notification.permission === 'granted') new Notification('Elite Timer', { body: msg })
}

function checkAlarms() {
  const leadMs = alarmLeadMin * 60 * 1000
  const active = ELITE_MONSTERS.map(getEliteState).filter(elite => elite.nextSpawnMs).sort((a, b) => a.nextSpawnMs - b.nextSpawnMs)
  for (const elite of active) {
    const delta = elite.nextSpawnMs - Date.now()
    if (delta <= 0) continue
    if (delta > leadMs) break
    if (triggered.has(elite.name)) continue
    triggered.add(elite.name)
    saveTriggered()
    triggerAlarm(elite)
  }
  checkSpawnCountdown(active)
}

const spawnOverlay = $('spawn-overlay')
const spawnEliteNameEl = $('spawn-boss-name')
let spawnNumberEl = $('spawn-number')
const spawnSubEl = $('spawn-sub')

function checkSpawnCountdown(active = ELITE_MONSTERS.map(getEliteState).filter(elite => elite.nextSpawnMs).sort((a, b) => a.nextSpawnMs - b.nextSpawnMs)) {
  const now = Date.now()
  const future = active[0] || null
  const futureMs = future ? future.nextSpawnMs : Infinity
  const futureDelta = futureMs - now
  const spawnedAlive = spawnedElite && (now - spawnedElite.nextSpawnMs < 3000)
  let nearest = null

  if (future && futureDelta > -3000 && futureDelta < 6000) nearest = future
  if (spawnedAlive) {
    const spawnedDelta = now - spawnedElite.nextSpawnMs
    if (!nearest || spawnedDelta < Math.abs(futureDelta)) nearest = spawnedElite
  }

  if (!nearest) {
    if (spawnCountdownActive) {
      spawnOverlay.classList.remove('active')
      spawnCountdownActive = null
      lastSpawnSecond = -1
    }
    if (spawnedElite && now - spawnedElite.nextSpawnMs >= 3000) spawnedElite = null
    return
  }

  const delta = nearest.nextSpawnMs - now
  const sec = Math.ceil(delta / 1000)
  if (!spawnOverlay.classList.contains('active')) spawnOverlay.classList.add('active')
  spawnCountdownActive = nearest
  spawnEliteNameEl.textContent = nearest.name
  if (sec <= 0) {
    if (lastSpawnSecond !== 0) {
      spawnedElite = nearest
      spawnNumberEl.className = 'spawn-number spawned'
      spawnNumberEl.textContent = 'SPAWNED!'
      spawnSubEl.textContent = 'Go go go!'
      playSpawnSound()
      lastSpawnSecond = 0
    }
  } else if (sec !== lastSpawnSecond && sec <= 5) {
    const clone = spawnNumberEl.cloneNode(false)
    clone.className = 'spawn-number'
    clone.textContent = sec
    spawnNumberEl.replaceWith(clone)
    spawnNumberEl = clone
    spawnSubEl.textContent = sec === 1 ? 'Get ready!' : 'Spawning soon...'
    playTick()
    lastSpawnSecond = sec
  }
}

function startTicker() {
  if (tickerId) clearInterval(tickerId)
  tickerId = setInterval(() => {
    updateCountdowns()
    checkAlarms()
  }, 1000)
}

function setLayout(mode) {
  layout = mode
  localStorage.setItem('eliteLayout', mode)
  const sel = $('layout-mode')
  const selM = $('layout-mode-m')
  if (sel) sel.value = mode
  if (selM) selM.value = mode
  render()
}

function updateMuteUI() {
  const muted = getMuted()
  const iconOn = $('icon-unmuted')
  const iconOff = $('icon-muted')
  if (iconOn) iconOn.style.display = muted ? 'none' : ''
  if (iconOff) iconOff.style.display = muted ? '' : 'none'
  const muteBtn = $('toggle-mute')
  if (muteBtn) muteBtn.title = muted ? 'Unmute sounds' : 'Mute sounds'
  const muteBtnM = $('toggle-mute-m')
  if (muteBtnM) muteBtnM.textContent = muted ? 'Unmute' : 'Mute'
}

const hamburgerBtn = $('hamburger-btn')
const hamburgerDrawer = $('hamburger-drawer')
const hamburgerIcon = $('hamburger-icon')
const hamburgerClose = $('hamburger-close')

function toggleDrawer(force) {
  const open = force !== undefined ? force : !hamburgerDrawer.classList.contains('open')
  hamburgerDrawer.classList.toggle('open', open)
  if (hamburgerIcon) hamburgerIcon.style.display = open ? 'none' : ''
  if (hamburgerClose) hamburgerClose.style.display = open ? '' : 'none'
}

hamburgerBtn?.addEventListener('click', e => { e.stopPropagation(); toggleDrawer() })
document.addEventListener('click', e => {
  if (hamburgerDrawer && !hamburgerDrawer.contains(e.target) && e.target !== hamburgerBtn) toggleDrawer(false)
})

const layoutModeSel = $('layout-mode')
const alarmLeadSel = $('alarm-lead')
const alarmVolumeSlider = $('alarm-volume')
const alarmVolumeLabel = $('alarm-volume-label')
const presetSel = $('sound-preset')
const eliteFilter = $('elite-filter')
const timelineBtn = $('toggle-timeline')
const muteBtn = $('toggle-mute')

if (layoutModeSel) { layoutModeSel.value = layout; layoutModeSel.addEventListener('change', () => setLayout(layoutModeSel.value)) }
if (alarmLeadSel) {
  alarmLeadSel.value = String(alarmLeadMin)
  alarmLeadSel.addEventListener('change', () => {
    alarmLeadMin = parseInt(alarmLeadSel.value, 10)
    localStorage.setItem('alarmLeadMin', String(alarmLeadMin))
    const m = $('alarm-lead-m')
    if (m) m.value = alarmLeadSel.value
  })
}
if (alarmVolumeSlider) {
  alarmVolumeSlider.value = Math.round(getVolume() * 100)
  if (alarmVolumeLabel) alarmVolumeLabel.textContent = Math.round(getVolume() * 100) + '%'
  alarmVolumeSlider.addEventListener('input', () => {
    setVolume(parseInt(alarmVolumeSlider.value, 10) / 100)
    if (alarmVolumeLabel) alarmVolumeLabel.textContent = Math.round(getVolume() * 100) + '%'
    const m = $('alarm-volume-m')
    const ml = $('alarm-volume-label-m')
    if (m) m.value = alarmVolumeSlider.value
    if (ml) ml.textContent = alarmVolumeLabel?.textContent || ''
  })
}
if (presetSel) {
  presetSel.value = getPreset()
  presetSel.addEventListener('change', () => {
    setPreset(presetSel.value)
    showToast('Sound: ' + presetSel.options[presetSel.selectedIndex].text)
    const m = $('sound-preset-m')
    if (m) m.value = presetSel.value
  })
}

$('user-test-alarm')?.addEventListener('click', () => { ensureNotificationPermission(); playBeep(); showToast('Test alarm played') })
timelineBtn?.addEventListener('click', () => { showTimeline = !showTimeline; localStorage.setItem('eliteTimeline', showTimeline); render() })
muteBtn?.addEventListener('click', () => { setMuted(!getMuted()); updateMuteUI(); showToast(getMuted() ? 'Sounds muted' : 'Sounds unmuted') })
eliteFilter?.addEventListener('input', () => { filterText = eliteFilter.value.trim(); render() })

const layoutModeSelM = $('layout-mode-m')
const alarmLeadSelM = $('alarm-lead-m')
const alarmVolumeSliderM = $('alarm-volume-m')
const alarmVolumeLabelM = $('alarm-volume-label-m')
const presetSelM = $('sound-preset-m')

if (layoutModeSelM) { layoutModeSelM.value = layout; layoutModeSelM.addEventListener('change', () => setLayout(layoutModeSelM.value)) }
if (alarmLeadSelM) {
  alarmLeadSelM.value = String(alarmLeadMin)
  alarmLeadSelM.addEventListener('change', () => {
    alarmLeadMin = parseInt(alarmLeadSelM.value, 10)
    localStorage.setItem('alarmLeadMin', String(alarmLeadMin))
    if (alarmLeadSel) alarmLeadSel.value = alarmLeadSelM.value
  })
}
if (alarmVolumeSliderM) {
  alarmVolumeSliderM.value = Math.round(getVolume() * 100)
  if (alarmVolumeLabelM) alarmVolumeLabelM.textContent = Math.round(getVolume() * 100) + '%'
  alarmVolumeSliderM.addEventListener('input', () => {
    setVolume(parseInt(alarmVolumeSliderM.value, 10) / 100)
    if (alarmVolumeLabelM) alarmVolumeLabelM.textContent = Math.round(getVolume() * 100) + '%'
    if (alarmVolumeSlider) alarmVolumeSlider.value = alarmVolumeSliderM.value
    if (alarmVolumeLabel) alarmVolumeLabel.textContent = alarmVolumeLabelM?.textContent || ''
  })
}
if (presetSelM) {
  presetSelM.value = getPreset()
  presetSelM.addEventListener('change', () => {
    setPreset(presetSelM.value)
    showToast('Sound: ' + presetSelM.options[presetSelM.selectedIndex].text)
    if (presetSel) presetSel.value = presetSelM.value
  })
}

$('user-test-alarm-m')?.addEventListener('click', () => { ensureNotificationPermission(); playBeep(); showToast('Test alarm played'); toggleDrawer(false) })
$('toggle-timeline-m')?.addEventListener('click', () => { showTimeline = !showTimeline; localStorage.setItem('eliteTimeline', showTimeline); render(); toggleDrawer(false) })
$('toggle-mute-m')?.addEventListener('click', () => { setMuted(!getMuted()); updateMuteUI(); showToast(getMuted() ? 'Sounds muted' : 'Sounds unmuted') })

updateMuteUI()
setLayout(layout)
render()
ensureNotificationPermission()
startTicker()

trackVisitorCount('elite_visitors', 'elite_counted', count => {
  const el = $('visitor-count')
  if (el) el.textContent = Number(count || 0).toLocaleString()
}, 'elite visitor')

trackOnlineCount('presence/elite', count => {
  const el = $('online-count')
  if (el) el.textContent = String(count || 0)
}, 'elite online', 'presence/bosstimer')
