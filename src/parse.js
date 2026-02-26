import { resolveBossAlias, isFixedSchedule, WORLD_BOSSES } from './data.js'

function stripEmoji(str) {
  return str
    .replace(/:[a-z0-9_+-]+:/gi, '')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FEFF}]/gu, '')
    .replace(/[🦖🦕🐉🐲🗡️⚔️🏆💀☠️👾🔥💥]/g, '')
    .trim()
}

function cleanBossName(name) {
  return stripEmoji(name)
    .replace(/^[\s\-–—|_.•*#>]+/, '')
    .replace(/[\s\-–—|_.•*#>]+$/, '')
    .trim()
}

function makeEvent(bossName, dt, dur = '00:30:00', extra = {}) {
  return {
    boss: bossName,
    date: dt.toISOString().slice(0, 10),
    time: dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    dur,
    start: dt.toISOString(),
    ...extra,
  }
}

// FORMAT 0: "BOSSNAME\n🕒 5:08 PM • in 5h 35m" (bot format)
function parseClockFormat(raw, now) {
  const out = []
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const clockRe = /(?:🕒|\u{1F552})?\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s*[•·]?/iu
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const next = lines[i + 1] || ''
    const after = lines[i + 2] || ''
    let bossLine = null, isTomorrow = false, clockLine = null
    if (clockRe.test(next)) {
      bossLine = line; clockLine = next; i += 2
    } else if (/^tomorrow$/i.test(next) && clockRe.test(after)) {
      bossLine = line; isTomorrow = true; clockLine = after; i += 3
    } else if (/^today$/i.test(next) && clockRe.test(after)) {
      bossLine = line; clockLine = after; i += 3
    } else { i++; continue }

    const rawName = bossLine.replace(/\(.*?\)/g, '').trim()
    const bossName = resolveBossAlias(cleanBossName(rawName))
    if (!bossName) continue

    const tm = clockLine.match(clockRe)
    if (!tm) continue
    const timeStr = tm[1].trim()
    const today = new Date()
    const base = isTomorrow
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
      : new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const dt = new Date(`${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')} ${timeStr}`)
    if (isNaN(dt.getTime()) || dt.getTime() <= now - 60000) continue
    out.push(makeEvent(bossName, dt))
  }
  return out
}

// FORMAT 1: date headers like "2/26/2024" then "Boss - 5:00 PM"
function parseDateHeaderFormat(cleaned, now) {
  const out = []
  const dateHeaderRe = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g
  const positions = []
  let dMatch
  while ((dMatch = dateHeaderRe.exec(cleaned)) !== null)
    positions.push({ dateStr: dMatch[1], index: dMatch.index })
  if (!positions.length) return out

  for (let i = 0; i < positions.length; i++) {
    const { dateStr, index } = positions[i]
    const segStart = index + dateStr.length
    const segEnd = i + 1 < positions.length ? positions[i + 1].index : cleaned.length
    const chunk = cleaned.slice(segStart, segEnd).trim()
    const [mo, da, yr] = dateStr.split('/').map(Number)
    if (!mo || !da || !yr) continue
    const entryRe = /(.+?)\s*[-=]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/gi
    let em
    while ((em = entryRe.exec(chunk)) !== null) {
      const rawName = em[1].trim(), rawTime = em[2].trim()
      if (!rawName || !rawTime) continue
      const bossName = resolveBossAlias(cleanBossName(rawName))
      if (!bossName) continue
      const dt = new Date(`${yr}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')} ${rawTime}`)
      if (isNaN(dt.getTime()) || dt.getTime() <= now - 60000) continue
      out.push(makeEvent(bossName, dt))
    }
  }
  return out
}

// FORMAT 2: "Boss — 2024-01-01 | 5:00 PM (01:00:00)"
function parseLineFormat(cleaned, now) {
  const out = []
  const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const m = line.match(/^(.+?)\s+[—\-]+\s+`?(\d{4}-\d{2}-\d{2})\s*\|\s*([0-9: ]+(?:AM|PM))`?\s*(?:\(?(\d{2,3}:\d{2}:\d{2})\)?)?/i)
    if (!m) continue
    const boss = resolveBossAlias(cleanBossName(m[1]))
    if (!boss) continue
    const ts = new Date(`${m[2]} ${m[3]}`)
    if (!isNaN(ts) && ts.getTime() > now)
      out.push(makeEvent(boss, ts, m[4] || '00:30:00'))
  }
  return out
}

// FORMAT 3: token/block based (original fallback)
function parseTokenFormat(cleaned, now) {
  const out = []
  const tokens = cleaned.split(/\s{2,}|\n{2,}/).map(t => t.trim()).filter(Boolean)
  const primary = /^(.+?)\s+[—\-]+\s+(\d{4}-\d{2}-\d{2})\s*\|\s*([0-9: ]+(?:AM|PM))\s*\((\d{2,3}:\d{2}:\d{2})\)/i
  const timeOnlyRe = /([0-9]{1,2}:[0-9]{2}\s*(?:AM|PM))/i
  const lcWorld = WORLD_BOSSES.map(x => x.toLowerCase())

  for (const t of tokens) {
    const m = t.match(primary)
    if (m) {
      const boss = resolveBossAlias(cleanBossName(m[1]))
      if (!boss) continue
      const ts = new Date(`${m[2]} ${m[3]}`)
      if (!isNaN(ts)) out.push(makeEvent(boss, ts, m[4]))
      continue
    }

    const tlines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (!tlines.length) continue
    const timeLineIndex = tlines.findIndex(l => timeOnlyRe.test(l) || /\|/.test(l))
    let bossPart = null, timePart = null
    if (timeLineIndex >= 0) {
      bossPart = tlines.slice(0, timeLineIndex).join(', ')
      timePart = tlines[timeLineIndex]
    } else if (tlines.length === 1) {
      const single = tlines[0]
      const tm = single.match(/(.+?)\s+([0-9]{1,2}:[0-9]{2}\s*(?:AM|PM))(?:\s*\((\d{2,3}:\d{2}:\d{2})\))?/i)
      if (tm) { bossPart = tm[1]; timePart = tm[2] + (tm[3] ? ' (' + tm[3] + ')' : '') }
    } else {
      bossPart = tlines.slice(0, -1).join(', ')
      timePart = tlines[tlines.length - 1]
    }
    if (!bossPart || !timePart) continue

    let dateStr = null, timeStr = null, dur = null
    const m2 = timePart.match(/(\d{4}-\d{2}-\d{2})\s*\|\s*([0-9: ]+(?:AM|PM))(?:\s*\((\d{2,3}:\d{2}:\d{2})\))?/i)
    if (m2) { dateStr = m2[1]; timeStr = m2[2]; dur = m2[3] || null }
    else {
      const m3 = timePart.match(/([0-9: ]+(?:AM|PM))(?:\s*\((\d{2,3}:\d{2}:\d{2})\))?/i)
      if (m3) { timeStr = m3[1]; dur = m3[2] || null }
    }
    if (!timeStr) continue

    const names = bossPart.split(/[,/\n·]+/).map(s => resolveBossAlias(cleanBossName(s))).filter(Boolean)
    const isWorldGroup = names.some(n => lcWorld.includes(n.toLowerCase()))
    let startDt = null
    if (dateStr) {
      startDt = new Date(`${dateStr} ${timeStr}`)
    } else {
      const today = new Date()
      const tm = new Date(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')} ${timeStr}`)
      if (isNaN(tm)) continue
      if (tm.getTime() <= now) tm.setDate(tm.getDate() + 1)
      startDt = tm
    }
    if (!startDt || isNaN(startDt)) continue

    if (isWorldGroup) {
      out.push(makeEvent('World Boss', startDt, dur || '01:00:00', { bosses: names, worldBoss: true }))
    } else {
      out.push(makeEvent(names.join(', '), startDt, dur || '00:30:00'))
    }
  }
  return out
}

export function parseSchedule(raw) {
  const cleaned = raw
    .replace(/:[a-z0-9_+-]+:/gi, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, ' ')
    .replace(/[\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[\u{FE00}-\u{FEFF}]/gu, ' ')
    .replace(/[🦖🦕🐉🐲🗡️⚔️🏆💀☠️👾🔥💥]/g, ' ')
  const now = Date.now()

  const r0 = parseClockFormat(raw, now)
  if (r0.length) return r0

  const r1 = parseDateHeaderFormat(cleaned, now)
  if (r1.length) return r1

  const r2 = parseLineFormat(cleaned, now)
  if (r2.length) return r2

  return parseTokenFormat(cleaned, now)
}
