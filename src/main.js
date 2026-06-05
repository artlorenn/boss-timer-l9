import './style.css'
import { trackVisitor, trackOnline, fetchSchedule, saveSchedule, subscribeSchedule } from './firebase.js'
import { getBossLocation, getRespawnMs, isFixedSchedule, generateFixedScheduleEvents, generateWorldBossEvents } from './data.js'
import { parseSchedule } from './parse.js'
import { playBeep, playTick, playSpawnSound, getMuted, setMuted, getVolume, setVolume, getPreset, setPreset } from './audio.js'

// ── DOM refs ──
const $ = id => document.getElementById(id)
const sectionsEl = $('sections')
const summaryEl = $('summary')
const toastEl = $('toast')
const pillEl = $('status-pill')
const syncDot = $('sync-dot')
const syncLabel = $('sync-label')
const timelineSec = $('timeline-section')
const adminBadge = $('admin-badge')
const adminModal = $('admin-modal')

// ── State ──
let eventsState = []
let layout = localStorage.getItem('layout') || 'compact'
let alarmLeadMin = parseInt(localStorage.getItem('alarmLeadMin') || '5', 10)
let tickerId = null
let autoRefreshId = null
let unsubscribeSchedule = null
let showTimeline = localStorage.getItem('timeline') === 'true'
let filterText = ''
let isAdmin = sessionStorage.getItem('isAdmin') === 'true'
const pinnedBosses = new Set(JSON.parse(localStorage.getItem('pinnedBosses') || '[]'))
const triggered = new Set()
const countdownRegistry = new Map()
let visibleEventCount = 0
let lastCloudSignature = ''

const AUTO_REFRESH_MS = 5 * 60_000

// ── Helpers ──
const evId = ev => ev.start + '-' + ev.boss
const getStartMs = ev => ev.startMs ?? new Date(ev.start).getTime()
const compareByStartMs = (a, b) => getStartMs(a) - getStartMs(b)
function setEventStart(ev, start) {
  const dt = typeof start === 'number' ? new Date(start) : new Date(start)
  if (Number.isNaN(dt.getTime())) return false
  const iso = dt.toISOString()
  ev.start = iso
  ev.startMs = dt.getTime()
  ev.date = iso.slice(0, 10)
  ev.time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return true
}
const getInitial = name => (name || '?').charAt(0).toUpperCase()
const fmtCountdown = value => {
  const startMs = typeof value === 'number' ? value : new Date(value).getTime()
  const d = Math.max(0, startMs - Date.now())
  const h = Math.floor(d / 3.6e6)
  const m = Math.floor((d % 3.6e6) / 6e4)
  const s = Math.floor((d % 6e4) / 1e3)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
const fmtTime = value => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const fmtDate = value => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' })
const localDateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const getDisplayName = ev => ev.bosses ? ev.bosses.join(', ') : ev.boss
const toTitle = str => str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
function registerEventNodes(ev, card, countdownEl, initialEl) {
  const id = evId(ev)
  const entry = countdownRegistry.get(id) || { cards: [], countdowns: [], initials: [] }
  if (card) entry.cards.push(card)
  if (countdownEl) entry.countdowns.push(countdownEl)
  if (initialEl) entry.initials.push(initialEl)
  countdownRegistry.set(id, entry)
}
const matchesFilter = ev => {
  if (!filterText) return true
  const q = filterText.toLowerCase()
  return getDisplayName(ev).toLowerCase().includes(q) || getBossLocation(ev.boss || '').toLowerCase().includes(q)
}
const sortWithPins = items => [...items].sort((a, b) => {
  const aP = pinnedBosses.has(a.boss) || (a.bosses && a.bosses.some(n => pinnedBosses.has(n)))
  const bP = pinnedBosses.has(b.boss) || (b.bosses && b.bosses.some(n => pinnedBosses.has(n)))
  if (aP && !bP) return -1
  if (!aP && bP) return 1
  return compareByStartMs(a, b)
})

// ── Sync UI ──
function setSyncStatus(state, text) {
  syncDot.className = 'sync-dot' + (state === 'syncing' ? ' syncing' : state === 'error' ? ' error' : '')
  if (syncLabel) syncLabel.textContent = text
}
const showToast = msg => { if (toastEl) toastEl.textContent = msg }
const setPill = (text, variant) => {
  if (!pillEl) return
  pillEl.textContent = text
  pillEl.className = variant === 'positive' ? 'positive' : variant === 'negative' ? 'negative' : ''
}

// ── Cloud format ──
function toCloudBosses(events) {
  return events
    .filter(e => !e.worldBoss && !isFixedSchedule(e.boss))
    .map(e => ({ name: e.boss, start_iso: e.start, end_time: e.dur || '' }))
}

// ── Firebase ──
async function fetchBossesJson() {
  setSyncStatus('syncing', 'Loading…')
  try {
    const bosses = await fetchSchedule()
    if (!bosses) { setSyncStatus('ok', 'No schedule yet'); return }
    loadBossesFromCloud(bosses)
    setSyncStatus('ok', `Synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
  } catch (e) {
    setSyncStatus('error', 'Sync failed')
    console.error(e)
  }
}

async function saveBossesToCloud(bossesJson) {
  setSyncStatus('syncing', 'Saving…')
  try {
    await saveSchedule(bossesJson)
    setSyncStatus('ok', `Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
    return true
  } catch (e) {
    setSyncStatus('error', 'Save failed')
    console.error(e)
    return false
  }
}

function convertTo24Hour(timeStr) {
  if (!timeStr) return null
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = m[2], sec = m[3] || '00', period = m[4].toUpperCase()
  if (period === 'AM') { if (h === 12) h = 0 }
  else { if (h !== 12) h += 12 }
  return `${String(h).padStart(2, '0')}:${min}:${sec}`
}

const MAX_DAYS_AHEAD = 3
function isWithinDateLimit(isoStr) {
  const evDate = new Date(isoStr)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const limitEnd = new Date(todayStart)
  limitEnd.setDate(limitEnd.getDate() + MAX_DAYS_AHEAD)
  return evDate.getTime() >= todayStart.getTime() && evDate.getTime() < limitEnd.getTime()
}

function loadBossesFromCloud(bosses) {
  if (!Array.isArray(bosses)) return
  const signature = JSON.stringify(bosses)
  if (signature === lastCloudSignature) return
  lastCloudSignature = signature
  const now = Date.now()
  const loaded = bosses.map(b => {
    let start
    if (b.start_iso) {
      start = new Date(b.start_iso)
    } else if (b.date && b.start_time) {
      const time24 = convertTo24Hour(b.start_time)
      if (time24) start = new Date(`${b.date}T${time24}`)
      if (!start || isNaN(start.getTime())) start = new Date(`${b.date} ${b.start_time}`)
    } else { return null }
    if (!start || isNaN(start.getTime())) { console.warn('[BossTimer] Could not parse:', b); return null }
    return { boss: b.name, date: start.toISOString().slice(0, 10), time: start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), dur: b.end_time || '', start: start.toISOString(), startMs: start.getTime() }
  }).filter(ev => ev && ev.startMs > now && !isFixedSchedule(ev.boss) && isWithinDateLimit(ev.startMs))

  eventsState = eventsState.filter(e => e.worldBoss || isFixedSchedule(e.boss))
  const existingIds = new Set(eventsState.map(evId))
  for (const ev of loaded) { if (!existingIds.has(evId(ev))) eventsState.push(ev) }
  eventsState.sort(compareByStartMs)
  render(eventsState)
  startTicker()
}

function startAutoRefresh() {
  if (autoRefreshId) clearInterval(autoRefreshId)
  autoRefreshId = setInterval(() => { if (!isAdmin) fetchBossesJson() }, AUTO_REFRESH_MS)
}

async function startRealtimeSync() {
  if (unsubscribeSchedule) unsubscribeSchedule()
  unsubscribeSchedule = null
  try {
    unsubscribeSchedule = await subscribeSchedule(
      bosses => {
        loadBossesFromCloud(bosses)
        if (!bosses || !bosses.length) {
          setSyncStatus('ok', 'No schedule yet')
          return
        }
        setSyncStatus('ok', `Live ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
      },
      e => {
        setSyncStatus('error', 'Live sync failed')
        console.error(e)
        fetchBossesJson()
      }
    )
  } catch (e) {
    setSyncStatus('error', 'Live sync failed')
    console.error(e)
    fetchBossesJson()
  }
}

// ── Kill / set time ──
function killBoss(bossName) {
  const respawnMs = getRespawnMs(bossName)
  if (!respawnMs) return
  const newStart = new Date(Date.now() + respawnMs).toISOString()
  const ev = eventsState.find(e => e.boss === bossName)
  if (ev) {
    const oldId = evId(ev)
    setEventStart(ev, newStart)
    triggered.delete(oldId)
  } else {
    const nextEv = { boss: bossName, date: '', time: '', dur: '', start: '', startMs: 0 }
    setEventStart(nextEv, newStart)
    eventsState.push(nextEv)
  }
  eventsState.sort(compareByStartMs)
  saveBossesToCloud(toCloudBosses(eventsState))
  showToast(`${bossName} killed — respawns in ${Math.round(respawnMs / 3600000)}h`)
  render(eventsState)
}

function manualSetTime(bossName) {
  const ev = eventsState.find(e => e.boss === bossName)
  if (!ev) return
  const existing = document.querySelector(`.manual-row[data-boss="${bossName}"]`)
  if (existing) {
    const inp = existing.querySelector('input')
    const ts = new Date(inp.value)
    if (!inp.value || isNaN(ts)) { existing.remove(); return showToast('Cancelled') }
    if (ts.getTime() <= Date.now()) return showToast('Time must be in the future')
    const oldId = evId(ev)
    setEventStart(ev, ts)
    triggered.delete(oldId)
    eventsState.sort(compareByStartMs)
    saveBossesToCloud(toCloudBosses(eventsState))
    showToast(`${bossName} set to ${fmtTime(ev.startMs)}`)
    render(eventsState)
    return
  }
  const card = document.querySelector(`.manual-trigger[data-boss="${bossName}"]`)?.closest('.boss-card,.deck-card')
  if (!card) return
  const row = document.createElement('div')
  row.className = 'manual-row'; row.dataset.boss = bossName
  row.innerHTML = `<input type="datetime-local" class="manual-time-input" step="60"><button class="set-btn" style="padding:2px 6px;font-size:10px;">OK</button>`
  card.appendChild(row)
  row.querySelector('button').addEventListener('click', () => manualSetTime(bossName))
}

// ── Cards ──
function urgentSoon(ev) {
  const delta = getStartMs(ev) - Date.now()
  return { urgent: delta <= 5 * 60 * 1000 && delta > 0, soon: delta <= 15 * 60 * 1000 && delta > 0 }
}

function buildCompactCard(ev, label) {
  const { urgent, soon } = urgentSoon(ev)
  const names = getDisplayName(ev)
  const loc = getBossLocation(ev.boss || '')
  const cdClass = urgent ? 'urgent' : soon ? 'soon' : ''
  const card = document.createElement('div')
  card.className = `boss-card${urgent ? ' urgent' : soon ? ' soon' : ''}`
  const killBtnHtml = (isAdmin && getRespawnMs(ev.boss)) ? `<button class="kill-btn" data-boss="${ev.boss}">Killed</button>` : ''
  const setBtnHtml = (isAdmin && !ev.worldBoss && !isFixedSchedule(ev.boss)) ? `<button class="set-btn manual-trigger" data-boss="${ev.boss}">Set time</button>` : ''
  const dateTag = label === 'Later' ? `<span class="date-tag">${fmtDate(ev.startMs)}</span>` : ''
  card.innerHTML = `
    <div class="boss-initial${cdClass ? ' ' + cdClass : ''}">${getInitial(names)}</div>
    <div class="boss-info">
      <div class="boss-name">${toTitle(names)}</div>
      <div class="boss-meta">${fmtTime(ev.startMs)}${loc ? ' · ' + loc : ''}</div>
      <div class="boss-countdown${cdClass ? ' ' + cdClass : ''}" data-cd="${evId(ev)}">${fmtCountdown(ev.startMs)}</div>
    </div>
    <div class="boss-actions">${dateTag}${killBtnHtml}${setBtnHtml}</div>`
  const countdownEl = card.querySelector('.boss-countdown')
  const initialEl = card.querySelector('.boss-initial')
  registerEventNodes(ev, card, countdownEl, initialEl)
  card.querySelector('.kill-btn')?.addEventListener('click', () => killBoss(ev.boss))
  card.querySelector('.manual-trigger')?.addEventListener('click', () => manualSetTime(ev.boss))
  return card
}

function buildDeckCard(ev, label) {
  const { urgent, soon } = urgentSoon(ev)
  const names = getDisplayName(ev)
  const loc = getBossLocation(ev.boss || '')
  const cdClass = urgent ? 'urgent' : soon ? 'soon' : ''
  const card = document.createElement('div')
  card.className = `deck-card${urgent ? ' urgent' : soon ? ' soon-card' : ''}`
  const killBtnHtml = (isAdmin && getRespawnMs(ev.boss)) ? `<button class="kill-btn" data-boss="${ev.boss}">Killed</button>` : ''
  const setBtnHtml = (isAdmin && !ev.worldBoss && !isFixedSchedule(ev.boss)) ? `<button class="set-btn manual-trigger" data-boss="${ev.boss}">Set</button>` : ''
  const dateTag = label === 'Later' ? `<div class="date-tag" style="font-size:10px;">${fmtDate(ev.startMs)}</div>` : ''
  card.innerHTML = `
    <div class="deck-initial${cdClass ? ' ' + cdClass : ''}">${getInitial(names)}</div>
    <div class="deck-name">${toTitle(names)}</div>
    ${loc ? `<div class="deck-loc">${loc}</div>` : ''}
    ${dateTag}
    <div class="deck-time">${fmtTime(ev.startMs)}</div>
    <div class="deck-cd${cdClass ? ' ' + cdClass : ''}" data-cd="${evId(ev)}">${fmtCountdown(ev.startMs)}</div>
    <div class="deck-btns">${killBtnHtml}${setBtnHtml}</div>`
  const countdownEl = card.querySelector('.deck-cd')
  const initialEl = card.querySelector('.deck-initial')
  registerEventNodes(ev, card, countdownEl, initialEl)
  card.querySelector('.kill-btn')?.addEventListener('click', () => killBoss(ev.boss))
  card.querySelector('.manual-trigger')?.addEventListener('click', () => manualSetTime(ev.boss))
  return card
}

// ── Render ──
function render(events) {
  sectionsEl.innerHTML = ''; summaryEl.innerHTML = ''
  countdownRegistry.clear()
  visibleEventCount = 0
  if (!events.length) { setPill('No events', 'negative'); renderTimeline(events); return }
  const filtered = events.filter(matchesFilter)
  visibleEventCount = filtered.length
  if (!filtered.length) { setPill('No matches', 'negative'); renderTimeline(events); return }
  const todayKey = localDateKey(new Date())
  const tmrwKey = localDateKey(new Date(Date.now() + 864e5))
  const buckets = { Today: [], Tomorrow: [], Later: [] }
  for (const ev of filtered) {
    const k = localDateKey(new Date(getStartMs(ev)))
    if (k === todayKey) buckets.Today.push(ev)
    else if (k === tmrwKey) buckets.Tomorrow.push(ev)
    else buckets.Later.push(ev)
  }
  for (const [label, unsorted] of Object.entries(buckets)) {
    const items = sortWithPins(unsorted)
    if (!items.length) continue
    const section = document.createElement('div'); section.className = 'section-wrap'
    const header = document.createElement('div'); header.className = 'section-header'
    header.innerHTML = `<span class="section-label">${label}</span><span class="section-count">${items.length}</span>`
    section.appendChild(header)
    if (layout === 'deck') {
      const scroll = document.createElement('div'); scroll.className = 'deck-scroll'
      scroll.addEventListener('wheel', e => {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        if (delta === 0) return
        scroll.scrollLeft += delta * 3
        e.preventDefault(); e.stopPropagation()
      }, { passive: false })
      for (const ev of items) scroll.appendChild(buildDeckCard(ev, label))
      section.appendChild(scroll)
    } else {
      const grid = document.createElement('div'); grid.className = 'boss-grid'
      for (const ev of items) grid.appendChild(buildCompactCard(ev, label))
      section.appendChild(grid)
    }
    sectionsEl.appendChild(section)
  }
  const next = events[0] || null
  summaryEl.innerHTML = `<span>${visibleEventCount} event${visibleEventCount === 1 ? '' : 's'}${filterText ? ' (filtered)' : ''}</span>${next ? `<span>· Next: <strong style="color:var(--text2);font-weight:600;">${toTitle(getDisplayName(next))}</strong> in ${fmtCountdown(getStartMs(next))}</span>` : ''}`
  setPill(visibleEventCount + ' active', 'positive')
  renderTimeline(events)
}

function renderTimeline(events) {
  timelineSec.innerHTML = ''
  if (!showTimeline || !events.length) { timelineSec.style.display = 'none'; return }
  const now = Date.now()
  let startIndex = 0
  while (startIndex < events.length && getStartMs(events[startIndex]) <= now) startIndex++
  if (startIndex >= events.length) { timelineSec.style.display = 'none'; return }
  timelineSec.style.display = ''
  const upcoming = events.slice(startIndex)
  const startMs = now
  const endMs = getStartMs(upcoming[upcoming.length - 1])
  const rangeMs = endMs - startMs
  if (rangeMs <= 0) { timelineSec.style.display = 'none'; return }
  const header = document.createElement('div'); header.className = 'section-header'
  header.innerHTML = `<span class="section-label">Timeline</span>`
  timelineSec.appendChild(header)
  const wrap = document.createElement('div'); wrap.className = 'timeline-wrap'
  const bar = document.createElement('div'); bar.className = 'timeline-bar'
  const nowM = document.createElement('div'); nowM.className = 'timeline-now'; nowM.style.left = '0%'; bar.appendChild(nowM)
  const nowL = document.createElement('div'); nowL.className = 'timeline-now-label'; nowL.style.left = '0%'; nowL.textContent = 'Now'; bar.appendChild(nowL)
  for (const ev of upcoming) {
    const evMs = getStartMs(ev)
    const pct = ((evMs - startMs) / rangeMs) * 100
    const delta = evMs - now
    const urgent = delta <= 5 * 60 * 1000, soon = delta <= 15 * 60 * 1000
    const name = getDisplayName(ev)
    const marker = document.createElement('div')
    marker.className = `timeline-marker${urgent ? ' urgent-marker' : soon ? ' soon-marker' : ''}`
    marker.style.left = pct + '%'; marker.textContent = name.charAt(0)
    marker.title = `${name} — ${fmtTime(evMs)} (${fmtCountdown(evMs)})`; bar.appendChild(marker)
    const lbl = document.createElement('div'); lbl.className = 'timeline-label'; lbl.style.left = pct + '%'
    lbl.textContent = name.length > 10 ? name.slice(0, 9) + '…' : name; bar.appendChild(lbl)
  }
  wrap.appendChild(bar); timelineSec.appendChild(wrap)
}

function updateCountdowns() {
  const now = Date.now()
  for (const ev of eventsState) {
    const entry = countdownRegistry.get(evId(ev))
    if (!entry) continue
    const startMs = getStartMs(ev)
    const cd = fmtCountdown(startMs)
    const delta = startMs - now
    const urgent = delta <= 5 * 60 * 1000 && delta > 0
    const soon = delta <= 15 * 60 * 1000 && delta > 0
    for (const el of entry.countdowns) {
      el.textContent = cd
      el.classList.remove('urgent', 'soon')
      if (urgent) el.classList.add('urgent')
      else if (soon) el.classList.add('soon')
    }
    for (const card of entry.cards) {
      card.classList.remove('urgent', 'soon', 'soon-card')
      if (urgent) card.classList.add('urgent')
      else if (soon) card.classList.add(card.classList.contains('deck-card') ? 'soon-card' : 'soon')
    }
    for (const init of entry.initials) {
      init.classList.remove('urgent', 'soon')
      if (urgent) init.classList.add('urgent')
      else if (soon) init.classList.add('soon')
    }
  }
  const next = eventsState[0] || null
  if (next) {
    if (visibleEventCount === 0 && filterText) summaryEl.innerHTML = '<span>No matches</span>'
    else summaryEl.innerHTML = `<span>${visibleEventCount} event${visibleEventCount === 1 ? '' : 's'}${filterText ? ' (filtered)' : ''}</span><span>· Next: <strong style="color:var(--text2);font-weight:600;">${toTitle(getDisplayName(next))}</strong> in ${fmtCountdown(getStartMs(next))}</span>`
  }
}

// ── Alarms ──
function ensureNotificationPermission() {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  Notification.requestPermission()
  return false
}

function triggerAlarm(ev) {
  const name = getDisplayName(ev)
  const msg = `${name} spawning in ${alarmLeadMin} min (${fmtTime(ev.startMs)})`
  showToast(msg); setPill('Alarm: ' + name, 'negative'); playBeep()
  if (Notification.permission === 'granted') new Notification('Boss Timer', { body: msg })
}

function checkAlarms() {
  const now = Date.now()
  const leadMs = alarmLeadMin * 60 * 1000
  for (const ev of eventsState) {
    const delta = getStartMs(ev) - now
    if (delta <= 0) continue
    if (delta > leadMs) break
    const id = evId(ev)
    if (triggered.has(id)) continue
    triggered.add(id)
    triggerAlarm(ev)
  }
  checkSpawnCountdown()
}

// ── Spawn overlay ──
let spawnCountdownActive = null, spawnedEvent = null, lastSpawnSecond = -1
const spawnOverlay = $('spawn-overlay')
const spawnBossNameEl = $('spawn-boss-name')
let spawnNumberEl = $('spawn-number')
const spawnSubEl = $('spawn-sub')

function checkSpawnCountdown() {
  const now = Date.now()
  const future = eventsState[0] || null
  const futureMs = future ? getStartMs(future) : Infinity
  const futureDelta = futureMs - now
  const spawnedAlive = spawnedEvent && (now - getStartMs(spawnedEvent) < 3000)
  let nearest = null

  if (future && futureDelta > -3000 && futureDelta < 6000) nearest = future
  if (spawnedAlive) {
    const spawnedDelta = now - getStartMs(spawnedEvent)
    if (!nearest || spawnedDelta < Math.abs(futureDelta)) nearest = spawnedEvent
  }

  if (!nearest) {
    if (spawnCountdownActive) {
      spawnOverlay.classList.remove('active')
      spawnCountdownActive = null
      lastSpawnSecond = -1
    }
    if (spawnedEvent && now - getStartMs(spawnedEvent) >= 3000) spawnedEvent = null
    return
  }

  const startMs = getStartMs(nearest)
  const delta = startMs - now
  const sec = Math.ceil(delta / 1000)
  const name = getDisplayName(nearest)
  if (!spawnOverlay.classList.contains('active')) spawnOverlay.classList.add('active')
  spawnCountdownActive = nearest
  spawnBossNameEl.textContent = name
  if (sec <= 0) {
    if (lastSpawnSecond !== 0) {
      spawnedEvent = nearest
      spawnNumberEl.className = 'spawn-number spawned'; spawnNumberEl.textContent = 'SPAWNED!'
      spawnSubEl.textContent = 'Go go go!'; playSpawnSound(); lastSpawnSecond = 0
    }
  } else if (sec !== lastSpawnSecond && sec <= 5) {
    const clone = spawnNumberEl.cloneNode(false)
    clone.className = 'spawn-number'; clone.textContent = sec; spawnNumberEl.replaceWith(clone)
    spawnNumberEl = clone
    spawnSubEl.textContent = sec === 1 ? 'Get ready!' : 'Spawning soon...'; playTick(); lastSpawnSecond = sec
  }
}

function prunePastEvents() {
  const now = Date.now()
  let firstFuture = 0
  while (firstFuture < eventsState.length && getStartMs(eventsState[firstFuture]) <= now) firstFuture++
  if (!firstFuture) return false
  eventsState = eventsState.slice(firstFuture)
  return true
}

function startTicker() {
  if (tickerId) clearInterval(tickerId)
  tickerId = setInterval(() => {
    checkSpawnCountdown()
    const pruned = prunePastEvents()
    if (pruned) render(eventsState)
    else updateCountdowns()
    checkAlarms()
  }, 1000)
}

// ── Layout ──
function setLayout(mode) {
  layout = mode; localStorage.setItem('layout', mode)
  const sel = $('layout-mode'); if (sel) sel.value = mode
  const selM = $('layout-mode-m'); if (selM) selM.value = mode
  if (eventsState.length) render(eventsState)
}

// ── Mute ──
function updateMuteUI() {
  const muted = getMuted()
  const iconOn = $('icon-unmuted'), iconOff = $('icon-muted')
  if (iconOn) iconOn.style.display = muted ? 'none' : ''
  if (iconOff) iconOff.style.display = muted ? '' : 'none'
  const muteBtn = $('toggle-mute')
  if (muteBtn) muteBtn.title = muted ? 'Unmute sounds' : 'Mute sounds'
  // update mobile button text
  const muteBtnM = $('toggle-mute-m')
  if (muteBtnM) muteBtnM.textContent = muted ? '🔇 Unmute' : '🔊 Mute'
}

// ── Admin UI ──
function updateAdminUI() {
  const iconLock = $('icon-lock'), iconUnlock = $('icon-unlock')
  const adminBtnM = $('toggle-admin-m')
  const drawerLabel = $('admin-drawer-label')
  if (iconLock) iconLock.style.display = isAdmin ? 'none' : ''
  if (iconUnlock) iconUnlock.style.display = isAdmin ? '' : 'none'
  if (adminBadge) adminBadge.style.display = isAdmin ? '' : 'none'
  const adminBtn = $('toggle-admin')
  if (adminBtn) adminBtn.title = isAdmin ? 'Logged in as Admin — click to logout' : 'Admin login'
  if (adminBtnM) adminBtnM.textContent = isAdmin ? '🔓 Logout' : '🔒 Login'
  if (drawerLabel) drawerLabel.textContent = isAdmin ? 'Admin ✓' : 'Admin'
  $('admin-area').classList.toggle('visible', isAdmin)
}

// ── Hamburger ──
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
  if (hamburgerDrawer && !hamburgerDrawer.contains(e.target) && e.target !== hamburgerBtn) {
    toggleDrawer(false)
  }
})

// ── Controls ── Desktop ──
const layoutModeSel = $('layout-mode')
const alarmLeadSel = $('alarm-lead')
const alarmVolumeSlider = $('alarm-volume')
const alarmVolumeLabel = $('alarm-volume-label')
const presetSel = $('sound-preset')
const bossFilter = $('boss-filter')
const timelineBtn = $('toggle-timeline')
const muteBtn = $('toggle-mute')
const adminBtn = $('toggle-admin')

if (layoutModeSel) { layoutModeSel.value = layout; layoutModeSel.addEventListener('change', () => setLayout(layoutModeSel.value)) }
if (alarmLeadSel) {
  alarmLeadSel.value = String(alarmLeadMin)
  alarmLeadSel.addEventListener('change', () => {
    alarmLeadMin = parseInt(alarmLeadSel.value, 10)
    localStorage.setItem('alarmLeadMin', String(alarmLeadMin))
    const m = $('alarm-lead-m'); if (m) m.value = alarmLeadSel.value
  })
}
if (alarmVolumeSlider) {
  alarmVolumeSlider.value = Math.round(getVolume() * 100)
  if (alarmVolumeLabel) alarmVolumeLabel.textContent = Math.round(getVolume() * 100) + '%'
  alarmVolumeSlider.addEventListener('input', () => {
    setVolume(parseInt(alarmVolumeSlider.value, 10) / 100)
    if (alarmVolumeLabel) alarmVolumeLabel.textContent = Math.round(getVolume() * 100) + '%'
    const m = $('alarm-volume-m'), ml = $('alarm-volume-label-m')
    if (m) m.value = alarmVolumeSlider.value
    if (ml) ml.textContent = alarmVolumeLabel?.textContent || ''
  })
}
if (presetSel) {
  presetSel.value = getPreset()
  presetSel.addEventListener('change', () => {
    setPreset(presetSel.value)
    showToast('Sound: ' + presetSel.options[presetSel.selectedIndex].text)
    const m = $('sound-preset-m'); if (m) m.value = presetSel.value
  })
}
$('user-test-alarm')?.addEventListener('click', () => { ensureNotificationPermission(); playBeep(); showToast('Test alarm played') })
$('btn-refresh')?.addEventListener('click', () => fetchBossesJson())
timelineBtn?.addEventListener('click', () => { showTimeline = !showTimeline; localStorage.setItem('timeline', showTimeline); if (eventsState.length) render(eventsState) })
muteBtn?.addEventListener('click', () => { setMuted(!getMuted()); updateMuteUI(); showToast(getMuted() ? 'Sounds muted' : 'Sounds unmuted') })
adminBtn?.addEventListener('click', () => {
  if (isAdmin) { isAdmin = false; sessionStorage.removeItem('isAdmin'); updateAdminUI(); if (eventsState.length) render(eventsState); showToast('Logged out'); return }
  adminModal.classList.remove('hidden')
  $('admin-pw').value = ''; $('admin-error').style.display = 'none'
  setTimeout(() => $('admin-pw').focus(), 100)
})

// ── Controls ── Mobile drawer ──
const layoutModeSelM = $('layout-mode-m')
const alarmLeadSelM = $('alarm-lead-m')
const alarmVolumeSliderM = $('alarm-volume-m')
const alarmVolumeLabelM = $('alarm-volume-label-m')
const presetSelM = $('sound-preset-m')

if (layoutModeSelM) {
  layoutModeSelM.value = layout
  layoutModeSelM.addEventListener('change', () => setLayout(layoutModeSelM.value))
}
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

$('user-test-alarm-m')?.addEventListener('click', () => {
  ensureNotificationPermission(); playBeep(); showToast('Test alarm played'); toggleDrawer(false)
})
$('toggle-timeline-m')?.addEventListener('click', () => {
  showTimeline = !showTimeline; localStorage.setItem('timeline', showTimeline)
  if (eventsState.length) render(eventsState); toggleDrawer(false)
})
$('toggle-mute-m')?.addEventListener('click', () => {
  setMuted(!getMuted()); updateMuteUI(); showToast(getMuted() ? 'Sounds muted' : 'Sounds unmuted')
})
$('btn-refresh-m')?.addEventListener('click', () => { fetchBossesJson(); toggleDrawer(false) })
$('toggle-admin-m')?.addEventListener('click', () => {
  toggleDrawer(false)
  if (isAdmin) { isAdmin = false; sessionStorage.removeItem('isAdmin'); updateAdminUI(); if (eventsState.length) render(eventsState); showToast('Logged out'); return }
  adminModal.classList.remove('hidden')
  $('admin-pw').value = ''; $('admin-error').style.display = 'none'
  setTimeout(() => $('admin-pw').focus(), 100)
})

// ── Filter ──
bossFilter?.addEventListener('input', () => { filterText = bossFilter.value.trim(); if (eventsState.length) render(eventsState) })

// ── Admin modal ──
const ADMIN_PASS = import.meta.env.VITE_ADMIN_PASS || 'boss123'
const adminSubmit = $('admin-submit')
const adminCancel = $('admin-cancel')

adminSubmit?.addEventListener('click', () => {
  if ($('admin-pw').value === ADMIN_PASS) {
    isAdmin = true; sessionStorage.setItem('isAdmin', 'true')
    adminModal.classList.add('hidden'); updateAdminUI()
    if (eventsState.length) render(eventsState); showToast('Admin mode activated')
  } else { $('admin-error').style.display = 'block'; $('admin-pw').select() }
})
$('admin-pw')?.addEventListener('keydown', e => { if (e.key === 'Enter') adminSubmit.click(); if (e.key === 'Escape') adminCancel.click() })
adminCancel?.addEventListener('click', () => adminModal.classList.add('hidden'))

// ── Admin area buttons ──
$('test-alarm')?.addEventListener('click', () => { ensureNotificationPermission(); playBeep(); showToast('Test played') })
$('copy-json')?.addEventListener('click', async () => {
  if (!eventsState.length) return showToast('No events loaded')
  await navigator.clipboard.writeText(JSON.stringify(eventsState, null, 2))
  showToast('Copied to clipboard')
})
$('download-ics')?.addEventListener('click', () => {
  if (!eventsState.length) return showToast('No events loaded')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Boss Timer//EN']
  for (const ev of eventsState) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const start = new Date(getStartMs(ev)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    lines.push('BEGIN:VEVENT', `UID:${start}-${ev.boss.replace(/\s+/g, '-')}`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, `DTEND:${start}`, `SUMMARY:${ev.boss}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'boss-timers.ics'; a.click(); URL.revokeObjectURL(a.href)
  showToast('Downloaded')
})
$('test-spawn')?.addEventListener('click', () => {
  const spawnAt = new Date(Date.now() + 5000)
  const testEv = { boss: 'World Boss', bosses: ['Ratan', 'Parto', 'Nedra'], date: '', time: '', dur: '01:00:00', start: '', startMs: 0, worldBoss: true }
  setEventStart(testEv, spawnAt)
  eventsState.push(testEv); eventsState.sort(compareByStartMs); render(eventsState); startTicker(); showToast('Test boss spawning in 5 seconds...')
})
$('parse')?.addEventListener('click', async () => {
  const adminTA = $('admin-textarea')
  const now = Date.now()
  const parsed = parseSchedule(adminTA.value)
    .filter(ev => getStartMs(ev) > now && !isFixedSchedule(ev.boss) && isWithinDateLimit(ev.startMs ?? ev.start))
    .sort(compareByStartMs)
  if (!parsed.length) return showToast('No valid events found — check your paste format')
  const bossesJson = toCloudBosses(parsed)
  const saved = await saveBossesToCloud(bossesJson)
  if (!saved) return
  showToast(`✓ Saved ${parsed.length} bosses for everyone!`)
  const worldFixed = eventsState.filter(e => e.worldBoss || isFixedSchedule(e.boss))
  eventsState = [...worldFixed, ...parsed]; eventsState.sort(compareByStartMs)
  render(eventsState); ensureNotificationPermission(); startTicker()
})

$('toggle-theme')?.addEventListener('click', () => showToast('Always dark mode 🖤'))
$('toggle-layout')?.addEventListener('click', () => {
  const next = layout === 'compact' ? 'deck' : 'compact'
  setLayout(next)
  $('toggle-layout').textContent = next === 'deck' ? 'Compact' : 'Deck'
})

// ── Init ──
updateMuteUI()
updateAdminUI()
setLayout(layout)

  ; (function initStaticEvents() {
  const wb = generateWorldBossEvents()
  const fixed = generateFixedScheduleEvents(14)
  const existing = new Set(eventsState.map(evId))
  for (const ev of [...wb, ...fixed]) {
    if (!existing.has(evId(ev)) && isWithinDateLimit(ev.startMs ?? ev.start)) {
      eventsState.push(ev); existing.add(evId(ev))
    }
  }
  eventsState.sort(compareByStartMs)
})()

render(eventsState)
ensureNotificationPermission()
startTicker()
startRealtimeSync()
startAutoRefresh()

trackVisitor(count => { const el = $('visitor-count'); if (el) el.textContent = count.toLocaleString() })
trackOnline(count => { const el = $('online-count'); if (el) el.textContent = count })

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { })
