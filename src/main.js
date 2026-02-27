import './style.css'
import { trackVisitor, trackOnline, fetchSchedule, saveSchedule } from './firebase.js'
import { getBossLocation, getRespawnMs, isFixedSchedule, generateFixedScheduleEvents, generateWorldBossEvents, SOUND_PRESETS } from './data.js'
import { parseSchedule } from './parse.js'
import { playBeep, playTick, playSpawnSound, getMuted, setMuted, getVolume, setVolume, getPreset, setPreset } from './audio.js'

// ── DOM refs ──
const $ = id => document.getElementById(id)
const sectionsEl  = $('sections')
const summaryEl   = $('summary')
const toastEl     = $('toast')
const pillEl      = $('status-pill')
const syncDot     = $('sync-dot')
const syncLabel   = $('sync-label')
const timelineSec = $('timeline-section')
const adminBadge  = $('admin-badge')
const adminModal  = $('admin-modal')

// ── State ──
let eventsState   = []
let layout        = localStorage.getItem('layout') || 'compact'
let alarmLeadMin  = parseInt(localStorage.getItem('alarmLeadMin') || '5', 10)
let tickerId      = null
let autoRefreshId = null
let showTimeline  = localStorage.getItem('timeline') === 'true'
let filterText    = ''
let isAdmin       = sessionStorage.getItem('isAdmin') === 'true'
const pinnedBosses = new Set(JSON.parse(localStorage.getItem('pinnedBosses') || '[]'))
const triggered   = new Set()
const completed   = new Set()

const AUTO_REFRESH_MS = 60_000

// ── Helpers ──
const evId     = ev => ev.start + '-' + ev.boss
const getInitial = name => (name || '?').charAt(0).toUpperCase()
const fmtCountdown = iso => {
  const d = Math.max(0, new Date(iso).getTime() - Date.now())
  const h = Math.floor(d / 3.6e6)
  const m = Math.floor((d % 3.6e6) / 6e4)
  const s = Math.floor((d % 6e4) / 1e3)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}
const fmtTime = iso => new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
const fmtDate = iso => new Date(iso).toLocaleDateString([], {month:'short',day:'numeric'})
const localDateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const getDisplayName = ev => ev.bosses ? ev.bosses.join(', ') : ev.boss
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
  return new Date(a.start) - new Date(b.start)
})

// ── Sync UI ──
function setSyncStatus(state, text) {
  syncDot.className = 'sync-dot' + (state === 'syncing' ? ' syncing' : state === 'error' ? ' error' : '')
  syncLabel.textContent = text
}
const showToast = msg => { toastEl.textContent = msg }
const setPill   = (text, variant) => {
  pillEl.textContent = text
  pillEl.className = variant === 'positive' ? 'positive' : variant === 'negative' ? 'negative' : ''
}

// ── Helper: convert internal events to cloud-safe format ──
// Stores start_iso (full ISO string) instead of localized time strings.
// This is safe across all browsers/devices including Safari on iOS.
function toCloudBosses(events) {
  return events
    .filter(e => !e.worldBoss && !isFixedSchedule(e.boss))
    .map(e => ({
      name: e.boss,
      start_iso: e.start,    // e.g. "2025-02-27T17:08:00.000Z" — parses reliably everywhere
      end_time: e.dur || '',
    }))
}

// ── Firebase ──
async function fetchBossesJson() {
  setSyncStatus('syncing', 'Loading…')
  try {
    const bosses = await fetchSchedule()
    if (!bosses) { setSyncStatus('ok', 'No schedule yet'); return }
    loadBossesFromCloud(bosses)
    setSyncStatus('ok', `Synced ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`)
  } catch (e) {
    setSyncStatus('error', 'Sync failed')
    console.error(e)
  }
}

async function saveBossesToCloud(bossesJson) {
  setSyncStatus('syncing', 'Saving…')
  try {
    await saveSchedule(bossesJson)
    setSyncStatus('ok', `Saved ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`)
    return true
  } catch (e) {
    setSyncStatus('error', 'Save failed')
    console.error(e)
    return false
  }
}

function loadBossesFromCloud(bosses) {
  if (!Array.isArray(bosses) || !bosses.length) return
  const now = Date.now()

  const loaded = bosses.map(b => {
    let start

    if (b.start_iso) {
      // New format: full ISO string, parses correctly on all browsers
      start = new Date(b.start_iso)
    } else if (b.date && b.start_time) {
      // Old format fallback: "2025-02-27" + "5:08 PM"
      // Safari requires ISO-like format; plain "YYYY-MM-DD H:MM AM" can fail.
      // Try converting 12-hour time to 24-hour for a reliable parse.
      const time24 = convertTo24Hour(b.start_time)
      if (time24) {
        start = new Date(`${b.date}T${time24}`)
      }
      // If that still fails, last-ditch attempt
      if (!start || isNaN(start.getTime())) {
        start = new Date(`${b.date} ${b.start_time}`)
      }
    } else {
      return null
    }

    if (!start || isNaN(start.getTime())) {
      console.warn('[BossTimer] Could not parse date for entry:', b)
      return null
    }

    return {
      boss:  b.name,
      date:  start.toISOString().slice(0, 10),
      time:  start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dur:   b.end_time || '',
      start: start.toISOString(),
    }
  }).filter(ev => ev && new Date(ev.start).getTime() > now && !isFixedSchedule(ev.boss))

  const existingIds = new Set(eventsState.filter(e => e.worldBoss || isFixedSchedule(e.boss)).map(evId))
  eventsState = eventsState.filter(e => e.worldBoss || isFixedSchedule(e.boss))
  for (const ev of loaded) {
    if (!existingIds.has(evId(ev))) eventsState.push(ev)
  }
  eventsState.sort((a, b) => new Date(a.start) - new Date(b.start))
  render(eventsState)
  startTicker()
}

// Converts "5:08 PM" or "05:08 PM" → "17:08:00" for Safari-safe parsing
function convertTo24Hour(timeStr) {
  if (!timeStr) return null
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = m[2]
  const sec = m[3] || '00'
  const period = m[4].toUpperCase()
  if (period === 'AM') {
    if (h === 12) h = 0
  } else {
    if (h !== 12) h += 12
  }
  return `${String(h).padStart(2, '0')}:${min}:${sec}`
}

function startAutoRefresh() {
  if (autoRefreshId) clearInterval(autoRefreshId)
  autoRefreshId = setInterval(() => { if (!isAdmin) fetchBossesJson() }, AUTO_REFRESH_MS)
}

// ── Kill / set time ──
function killBoss(bossName) {
  const respawnMs = getRespawnMs(bossName)
  if (!respawnMs) return
  const newStart = new Date(Date.now() + respawnMs).toISOString()
  const ev = eventsState.find(e => e.boss === bossName)
  if (ev) { ev.start = newStart; triggered.delete(`${ev.start}-${ev.boss}`) }
  else eventsState.push({ boss: bossName, date: newStart.slice(0,10), time: '', dur: '', start: newStart })
  eventsState.sort((a, b) => new Date(a.start) - new Date(b.start))
  // FIX: use toCloudBosses() instead of manual map with ev.time
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
    ev.start = ts.toISOString()
    triggered.delete(`${ev.start}-${ev.boss}`)
    eventsState.sort((a, b) => new Date(a.start) - new Date(b.start))
    // FIX: use toCloudBosses() instead of manual map with ev.time
    saveBossesToCloud(toCloudBosses(eventsState))
    showToast(`${bossName} set to ${fmtTime(ev.start)}`)
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
  const delta = new Date(ev.start).getTime() - Date.now()
  return { urgent: delta <= 5*60*1000 && delta > 0, soon: delta <= 15*60*1000 && delta > 0 }
}

function buildCompactCard(ev, label) {
  const { urgent, soon } = urgentSoon(ev)
  const names = getDisplayName(ev)
  const loc   = getBossLocation(ev.boss || '')
  const cdClass = urgent ? 'urgent' : soon ? 'soon' : ''
  const card = document.createElement('div')
  card.className = `boss-card${urgent ? ' urgent' : soon ? ' soon' : ''}`
  const killBtnHtml = (isAdmin && getRespawnMs(ev.boss)) ? `<button class="kill-btn" data-boss="${ev.boss}">Killed</button>` : ''
  const setBtnHtml  = (isAdmin && !ev.worldBoss && !isFixedSchedule(ev.boss)) ? `<button class="set-btn manual-trigger" data-boss="${ev.boss}">Set time</button>` : ''
  const dateTag = label === 'Later' ? `<span class="date-tag">${fmtDate(ev.start)}</span>` : ''
  card.innerHTML = `
    <div class="boss-initial${cdClass ? ' '+cdClass : ''}">${getInitial(names)}</div>
    <div class="boss-info">
      <div class="boss-name">${names}</div>
      <div class="boss-meta">${fmtTime(ev.start)}${loc ? ' · '+loc : ''}</div>
      <div class="boss-countdown${cdClass ? ' '+cdClass : ''}" data-cd="${evId(ev)}">${fmtCountdown(ev.start)}</div>
    </div>
    <div class="boss-actions">${dateTag}${killBtnHtml}${setBtnHtml}</div>`
  card.querySelector('.kill-btn')?.addEventListener('click', () => killBoss(ev.boss))
  card.querySelector('.manual-trigger')?.addEventListener('click', () => manualSetTime(ev.boss))
  return card
}

function buildDeckCard(ev, label) {
  const { urgent, soon } = urgentSoon(ev)
  const names = getDisplayName(ev)
  const loc   = getBossLocation(ev.boss || '')
  const cdClass = urgent ? 'urgent' : soon ? 'soon' : ''
  const card = document.createElement('div')
  card.className = `deck-card${urgent ? ' urgent' : soon ? ' soon-card' : ''}`
  const killBtnHtml = (isAdmin && getRespawnMs(ev.boss)) ? `<button class="kill-btn" data-boss="${ev.boss}">Killed</button>` : ''
  const setBtnHtml  = (isAdmin && !ev.worldBoss && !isFixedSchedule(ev.boss)) ? `<button class="set-btn manual-trigger" data-boss="${ev.boss}">Set</button>` : ''
  const dateTag = label === 'Later' ? `<div class="date-tag" style="font-size:10px;">${fmtDate(ev.start)}</div>` : ''
  card.innerHTML = `
    <div class="deck-initial${cdClass ? ' '+cdClass : ''}">${getInitial(names)}</div>
    <div class="deck-name">${names}</div>
    ${loc ? `<div class="deck-loc">${loc}</div>` : ''}
    ${dateTag}
    <div class="deck-time">${fmtTime(ev.start)}</div>
    <div class="deck-cd${cdClass ? ' '+cdClass : ''}" data-cd="${evId(ev)}">${fmtCountdown(ev.start)}</div>
    <div class="deck-btns">${killBtnHtml}${setBtnHtml}</div>`
  card.querySelector('.kill-btn')?.addEventListener('click', () => killBoss(ev.boss))
  card.querySelector('.manual-trigger')?.addEventListener('click', () => manualSetTime(ev.boss))
  return card
}

// ── Render ──
function render(events) {
  sectionsEl.innerHTML = ''; summaryEl.innerHTML = ''
  if (!events.length) { setPill('No events', 'negative'); return }
  const filtered = events.filter(matchesFilter)
  if (!filtered.length) { setPill('No matches', 'negative'); renderTimeline(events); return }
  const todayKey = localDateKey(new Date())
  const tmrwKey  = localDateKey(new Date(Date.now() + 864e5))
  const buckets  = { Today: [], Tomorrow: [], Later: [] }
  for (const ev of filtered) {
    const k = localDateKey(new Date(ev.start))
    if (k === todayKey) buckets.Today.push(ev)
    else if (k === tmrwKey) buckets.Tomorrow.push(ev)
    else buckets.Later.push(ev)
  }
  for (const [label, unsorted] of Object.entries(buckets)) {
    const items = sortWithPins(unsorted)
    if (!items.length) continue
    const section = document.createElement('div'); section.className = 'section-wrap'
    const header  = document.createElement('div'); header.className = 'section-header'
    header.innerHTML = `<span class="section-label">${label}</span><span class="section-count">${items.length}</span>`
    section.appendChild(header)
    if (layout === 'deck') {
      const scroll = document.createElement('div'); scroll.className = 'deck-scroll'
      for (const ev of items) scroll.appendChild(buildDeckCard(ev, label))
      section.appendChild(scroll)
    } else {
      const grid = document.createElement('div'); grid.className = 'boss-grid'
      for (const ev of items) grid.appendChild(buildCompactCard(ev, label))
      section.appendChild(grid)
    }
    sectionsEl.appendChild(section)
  }
  const upcoming = events.filter(ev => new Date(ev.start).getTime() > Date.now())
  const next = upcoming[0] || null
  summaryEl.innerHTML = `<span>${filtered.length} event${filtered.length === 1 ? '' : 's'}${filterText ? ' (filtered)' : ''}</span>${next ? `<span>· Next: <strong style="color:var(--text2);font-weight:600;">${getDisplayName(next)}</strong> in ${fmtCountdown(next.start)}</span>` : ''}`
  setPill(filtered.length + ' active', 'positive')
  renderTimeline(events)
}

function renderTimeline(events) {
  timelineSec.innerHTML = ''
  if (!showTimeline || !events.length) { timelineSec.style.display = 'none'; return }
  timelineSec.style.display = ''
  const now = Date.now()
  const upcoming = events.filter(ev => new Date(ev.start).getTime() > now)
  if (!upcoming.length) return
  const startMs = now
  const endMs   = Math.max(...upcoming.map(ev => new Date(ev.start).getTime()))
  const rangeMs = endMs - startMs
  if (rangeMs <= 0) return
  const header = document.createElement('div'); header.className = 'section-header'
  header.innerHTML = `<span class="section-label">Timeline</span>`
  timelineSec.appendChild(header)
  const wrap = document.createElement('div'); wrap.className = 'timeline-wrap'
  const bar  = document.createElement('div'); bar.className  = 'timeline-bar'
  const nowM = document.createElement('div'); nowM.className = 'timeline-now'; nowM.style.left = '0%'; bar.appendChild(nowM)
  const nowL = document.createElement('div'); nowL.className = 'timeline-now-label'; nowL.style.left = '0%'; nowL.textContent = 'Now'; bar.appendChild(nowL)
  for (const ev of upcoming) {
    const pct   = ((new Date(ev.start).getTime() - startMs) / rangeMs) * 100
    const delta = new Date(ev.start).getTime() - now
    const urgent = delta <= 5*60*1000, soon = delta <= 15*60*1000
    const name = getDisplayName(ev)
    const marker = document.createElement('div')
    marker.className = `timeline-marker${urgent ? ' urgent-marker' : soon ? ' soon-marker' : ''}`
    marker.style.left = pct + '%'; marker.textContent = name.charAt(0)
    marker.title = `${name} — ${fmtTime(ev.start)} (${fmtCountdown(ev.start)})`; bar.appendChild(marker)
    const lbl = document.createElement('div'); lbl.className = 'timeline-label'; lbl.style.left = pct + '%'
    lbl.textContent = name.length > 10 ? name.slice(0, 9) + '…' : name; bar.appendChild(lbl)
  }
  wrap.appendChild(bar); timelineSec.appendChild(wrap)
}

function updateCountdowns() {
  for (const ev of eventsState) {
    const els   = document.querySelectorAll(`[data-cd="${evId(ev)}"]`)
    const cd    = fmtCountdown(ev.start)
    const delta = new Date(ev.start).getTime() - Date.now()
    const urgent = delta <= 5*60*1000 && delta > 0
    const soon   = delta <= 15*60*1000 && delta > 0
    for (const el of els) {
      el.textContent = cd
      el.classList.remove('urgent', 'soon')
      if (urgent) el.classList.add('urgent')
      else if (soon) el.classList.add('soon')
      const card = el.closest('.boss-card') || el.closest('.deck-card')
      if (card) {
        card.classList.remove('urgent', 'soon', 'soon-card')
        if (urgent) card.classList.add('urgent')
        else if (soon) card.classList.add(card.classList.contains('deck-card') ? 'soon-card' : 'soon')
        const init = card.querySelector('.boss-initial,.deck-initial')
        if (init) { init.classList.remove('urgent','soon'); if (urgent) init.classList.add('urgent'); else if (soon) init.classList.add('soon') }
      }
    }
  }
  const upcoming = eventsState.filter(ev => new Date(ev.start).getTime() > Date.now())
  const next = upcoming[0] || null
  if (next) summaryEl.innerHTML = `<span>${eventsState.length} event${eventsState.length === 1 ? '' : 's'}</span><span>· Next: <strong style="color:var(--text2);font-weight:600;">${getDisplayName(next)}</strong> in ${fmtCountdown(next.start)}</span>`
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
  const msg  = `${name} spawning in ${alarmLeadMin} min (${fmtTime(ev.start)})`
  showToast(msg); setPill('Alarm: ' + name, 'negative'); playBeep()
  if (Notification.permission === 'granted') new Notification('Boss Timer', { body: msg })
}

function checkAlarms() {
  const now = Date.now()
  for (const ev of eventsState) {
    const id = `${ev.start}-${ev.boss}`
    if (triggered.has(id)) continue
    const delta = new Date(ev.start).getTime() - now
    if (delta <= alarmLeadMin * 60 * 1000 && delta > 0) { triggered.add(id); triggerAlarm(ev) }
  }
  checkSpawnCountdown()
}

// ── Spawn overlay ──
let spawnCountdownActive = null, spawnedEvent = null, lastSpawnSecond = -1
const spawnOverlay    = $('spawn-overlay')
const spawnBossNameEl = $('spawn-boss-name')
const spawnSubEl      = $('spawn-sub')

function checkSpawnCountdown() {
  const now = Date.now()
  let nearest = null, nearestDelta = Infinity
  for (const ev of eventsState) {
    const delta = new Date(ev.start).getTime() - now
    if (delta > -3000 && delta < 6000 && Math.abs(delta) < nearestDelta) { nearest = ev; nearestDelta = Math.abs(delta) }
  }
  if (!nearest && spawnedEvent) {
    if (now - new Date(spawnedEvent.start).getTime() < 3000) nearest = spawnedEvent
    else { spawnOverlay.classList.remove('active'); spawnedEvent = spawnCountdownActive = null; lastSpawnSecond = -1; return }
  }
  if (!nearest) { if (spawnCountdownActive) { spawnOverlay.classList.remove('active'); spawnCountdownActive = null; lastSpawnSecond = -1 } return }
  const delta = new Date(nearest.start).getTime() - now
  const sec   = Math.ceil(delta / 1000)
  const name  = getDisplayName(nearest)
  if (!spawnOverlay.classList.contains('active')) spawnOverlay.classList.add('active')
  spawnCountdownActive = nearest; spawnBossNameEl.textContent = name
  if (sec <= 0) {
    if (lastSpawnSecond !== 0) {
      spawnedEvent = nearest
      const numEl = spawnOverlay.querySelector('.spawn-number')
      numEl.className = 'spawn-number spawned'; numEl.textContent = 'SPAWNED!'
      spawnSubEl.textContent = 'Go go go!'; playSpawnSound(); lastSpawnSecond = 0
    }
  } else if (sec !== lastSpawnSecond && sec <= 5) {
    const numEl  = spawnOverlay.querySelector('.spawn-number')
    const clone  = numEl.cloneNode(false)
    clone.className = 'spawn-number'; clone.textContent = sec; numEl.replaceWith(clone)
    spawnSubEl.textContent = sec === 1 ? 'Get ready!' : 'Spawning soon...'; playTick(); lastSpawnSecond = sec
  }
}

function prunePastEvents() {
  const now = Date.now()
  const remaining = []; let changed = false
  for (const ev of eventsState) {
    if (new Date(ev.start).getTime() <= now) { completed.add(ev.boss); changed = true; continue }
    remaining.push(ev)
  }
  if (changed) eventsState = remaining
  return changed
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

// ── Controls ──
const layoutModeSel     = $('layout-mode')
const alarmLeadSel      = $('alarm-lead')
const alarmVolumeSlider = $('alarm-volume')
const alarmVolumeLabel  = $('alarm-volume-label')
const presetSel         = $('sound-preset')
const bossFilter        = $('boss-filter')
const timelineBtn       = $('toggle-timeline')
const muteBtn           = $('toggle-mute')
const adminBtn          = $('toggle-admin')

if (layoutModeSel) { layoutModeSel.value = layout; layoutModeSel.addEventListener('change', () => setLayout(layoutModeSel.value)) }
if (alarmLeadSel)  { alarmLeadSel.value = String(alarmLeadMin); alarmLeadSel.addEventListener('change', () => { alarmLeadMin = parseInt(alarmLeadSel.value, 10); localStorage.setItem('alarmLeadMin', String(alarmLeadMin)) }) }
if (alarmVolumeSlider) {
  alarmVolumeSlider.value = Math.round(getVolume() * 100)
  alarmVolumeLabel.textContent = Math.round(getVolume() * 100) + '%'
  alarmVolumeSlider.addEventListener('input', () => {
    setVolume(parseInt(alarmVolumeSlider.value, 10) / 100)
    alarmVolumeLabel.textContent = Math.round(getVolume() * 100) + '%'
  })
}
if (presetSel) {
  presetSel.value = getPreset()
  presetSel.addEventListener('change', () => { setPreset(presetSel.value); showToast('Sound: ' + presetSel.options[presetSel.selectedIndex].text) })
}
$('user-test-alarm').addEventListener('click', () => { ensureNotificationPermission(); playBeep(); showToast('Test alarm played') })
$('btn-refresh').addEventListener('click', () => fetchBossesJson())
$('test-alarm').addEventListener('click', () => { ensureNotificationPermission(); playBeep(); showToast('Test played') })
$('copy-json').addEventListener('click', async () => {
  if (!eventsState.length) return showToast('No events loaded')
  await navigator.clipboard.writeText(JSON.stringify(eventsState, null, 2))
  showToast('Copied to clipboard')
})
$('download-ics').addEventListener('click', () => {
  if (!eventsState.length) return showToast('No events loaded')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Boss Timer//EN']
  for (const ev of eventsState) {
    const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')
    const start = new Date(ev.start).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')
    lines.push('BEGIN:VEVENT', `UID:${start}-${ev.boss.replace(/\s+/g,'-')}`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, `DTEND:${start}`, `SUMMARY:${ev.boss}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'boss-timers.ics'; a.click(); URL.revokeObjectURL(a.href)
  showToast('Downloaded')
})
$('test-spawn').addEventListener('click', () => {
  const spawnAt = new Date(Date.now() + 5000)
  const testEv = { boss: 'World Boss', bosses: ['Ratan','Parto','Nedra'], date: spawnAt.toISOString().slice(0,10), time: spawnAt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), dur: '01:00:00', start: spawnAt.toISOString(), worldBoss: true }
  eventsState.push(testEv); eventsState.sort((a,b) => new Date(a.start)-new Date(b.start)); render(eventsState); startTicker(); showToast('Test boss spawning in 5 seconds...')
})

// Parse btn
$('parse').addEventListener('click', async () => {
  const adminTA = $('admin-textarea')
  const now = Date.now()
  const parsed = parseSchedule(adminTA.value)
    .filter(ev => new Date(ev.start).getTime() > now && !isFixedSchedule(ev.boss))
    .sort((a, b) => new Date(a.start) - new Date(b.start))
  if (!parsed.length) return showToast('No valid events found — check your paste format')
  // FIX: use toCloudBosses() — stores start_iso instead of localized ev.time
  const bossesJson = toCloudBosses(parsed)
  const saved = await saveBossesToCloud(bossesJson)
  if (!saved) return
  showToast(`✓ Saved ${parsed.length} bosses for everyone!`)
  const worldFixed = eventsState.filter(e => e.worldBoss || isFixedSchedule(e.boss))
  eventsState = [...worldFixed, ...parsed]; eventsState.sort((a,b) => new Date(a.start)-new Date(b.start))
  render(eventsState); ensureNotificationPermission(); startTicker()
})

// Layout
function setLayout(mode) {
  layout = mode; localStorage.setItem('layout', mode)
  if (layoutModeSel) layoutModeSel.value = mode
  if (eventsState.length) render(eventsState)
}
setLayout(layout)

// Mute
function updateMuteUI() {
  $('icon-unmuted').style.display = getMuted() ? 'none' : ''
  $('icon-muted').style.display   = getMuted() ? '' : 'none'
  muteBtn.title = getMuted() ? 'Unmute sounds' : 'Mute sounds'
}
muteBtn.addEventListener('click', () => { setMuted(!getMuted()); updateMuteUI(); showToast(getMuted() ? 'Sounds muted' : 'Sounds unmuted') })
updateMuteUI()

// Filter
bossFilter.addEventListener('input', () => { filterText = bossFilter.value.trim(); if (eventsState.length) render(eventsState) })

// Timeline
function updateTimelineUI() { if (eventsState.length) render(eventsState) }
timelineBtn.addEventListener('click', () => { showTimeline = !showTimeline; localStorage.setItem('timeline', showTimeline); updateTimelineUI() })
updateTimelineUI()

// Theme (dark only)
$('toggle-theme')?.addEventListener('click', () => showToast('Always dark mode 🖤'))

// Admin
const ADMIN_PASS = 'boss123'
const adminPwInput = $('admin-pw')
const adminSubmit  = $('admin-submit')
const adminCancel  = $('admin-cancel')
const adminError   = $('admin-error')

function updateAdminUI() {
  $('icon-lock').style.display   = isAdmin ? 'none' : ''
  $('icon-unlock').style.display = isAdmin ? '' : 'none'
  adminBadge.style.display = isAdmin ? '' : 'none'
  adminBtn.title = isAdmin ? 'Logged in as Admin — click to logout' : 'Admin login'
  $('admin-area').classList.toggle('visible', isAdmin)
}
adminBtn.addEventListener('click', () => {
  if (isAdmin) { isAdmin = false; sessionStorage.removeItem('isAdmin'); updateAdminUI(); if (eventsState.length) render(eventsState); showToast('Logged out'); return }
  adminModal.classList.remove('hidden')
  adminPwInput.value = ''; adminError.style.display = 'none'
  setTimeout(() => adminPwInput.focus(), 100)
})
adminSubmit.addEventListener('click', () => {
  if (adminPwInput.value === ADMIN_PASS) {
    isAdmin = true; sessionStorage.setItem('isAdmin', 'true')
    adminModal.classList.add('hidden'); updateAdminUI()
    if (eventsState.length) render(eventsState); showToast('Admin mode activated')
  } else { adminError.style.display = 'block'; adminPwInput.select() }
})
adminPwInput.addEventListener('keydown', e => { if (e.key === 'Enter') adminSubmit.click(); if (e.key === 'Escape') adminCancel.click() })
adminCancel.addEventListener('click', () => adminModal.classList.add('hidden'))
updateAdminUI()

// Deck scroll with mouse wheel
document.addEventListener('wheel', e => {
  const el = e.target.closest?.('.deck-scroll')
  if (!el || e.deltaY === 0) return
  el.scrollLeft += e.deltaY; e.preventDefault()
}, { passive: false })

// ── INIT ──
;(function initStaticEvents() {
  const wb = generateWorldBossEvents()
  const fixed = generateFixedScheduleEvents(14)
  const existing = new Set(eventsState.map(evId))
  for (const ev of [...wb, ...fixed]) {
    if (!existing.has(evId(ev))) { eventsState.push(ev); existing.add(evId(ev)) }
  }
  eventsState.sort((a, b) => new Date(a.start) - new Date(b.start))
})()

render(eventsState)
ensureNotificationPermission()
startTicker()
startAutoRefresh()
fetchBossesJson()

// Firebase presence/visitor tracking
trackVisitor(count => {
  const el = $('visitor-count')
  if (el) el.textContent = count.toLocaleString()
})
trackOnline(count => {
  const el = $('online-count')
  if (el) el.textContent = count
})

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})