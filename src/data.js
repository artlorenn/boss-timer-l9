export const BOSS_LOCATION = {
  'Venatus':'Corrupted Basin','Clemantis':'Corrupted Basin','Livera':'Protector Ruins',
  'Undomiel':'Secret Laboratory','Araneo':'Tomb of Tyriosa 1F','General Aquleus':'Tomb of Tyriosa 2F',
  'Milavy':'Tomb of Tyriosa 3F','Baron Braudmore':'Battle Field of Templar','Ringor':'Battle Field of Templar',
  'Amentis':'Land of Glory','Viorent':'Crescent Lake','Saphirus':'Crescent Lake',
  'Thymele':'Twilight Hill','Lady Dalia':'Twilight Hill','Ego':'Ulan Canyon',
  'Neutro':'Desert of the Screaming','Wannitas':'Plateau of Revolution','Metus':'Plateau of Revolution',
  'Duplican':'Plateau of Revolution','Shuliar':'Ruins of War','Larba':'Ruins of War',
  'Asta':'Silvergrass Field','Ordo':'Silvergrass Field','Secreta':'Silvergrass Field',
  'Supore':'Silvergrass Field','Chaiflock':'Silvergrass Field','Benji':'Barbas',
  'Gareth':"Deadman's Land District 1F",'Titore':"Deadman's Land District 2F",
  'Catena':"Deadman's Land District 1F",'Roderick':'Garbana Underground Waterway 1F',
  'Auraq':'Garbana Underground Waterway 2F','Tumier':'Garbana Underground Waterway 3F',
  'Icaruthia':'Kransia - Central Arena','Motti':'Kransia - Ruined Bastion',
  'Nevaeh':'Kransia - Skyspire Summit','Libitina':'Volcano Dracas','Rakajeth':'Volcano Dracas',
}

const h = 3600000
export const RESPAWN_TIME = {
  'Venatus':10*h,'Viorent':10*h,'Lady Dalia':18*h,'Ego':21*h,'Livera':24*h,'Araneo':24*h,
  'Undomiel':24*h,'General Aquleus':29*h,'Amentis':29*h,'Baron Braudmore':32*h,'Gareth':32*h,
  'Shuliar':35*h,'Larba':35*h,'Catena':35*h,'Titore':37*h,'Wannitas':48*h,'Metus':48*h,
  'Duplican':48*h,'Secreta':62*h,'Ordo':62*h,'Asta':62*h,'Supore':62*h,
}

export const FIXED_SCHEDULE_MAP = {
  'Clemantis':[{dow:1,time:'11:30'},{dow:4,time:'19:00'}],
  'Saphirus': [{dow:0,time:'17:00'},{dow:2,time:'11:30'}],
  'Neutro':   [{dow:2,time:'19:00'},{dow:4,time:'11:30'}],
  'Thymele':  [{dow:1,time:'19:00'},{dow:3,time:'11:30'}],
  'Milavy':   [{dow:6,time:'15:00'}],
  'Ringor':   [{dow:6,time:'17:00'}],
  'Roderick': [{dow:5,time:'19:00'}],
  'Auraq':    [{dow:5,time:'22:00'},{dow:3,time:'21:00'}],
  'Benji':    [{dow:0,time:'21:00'}],
  'Chaiflock':[{dow:6,time:'22:00'}],
  'Tumier':   [{dow:0,time:'19:00'}],
  'Icaruthia':[{dow:2,time:'21:00'},{dow:5,time:'21:00'}],
  'Motti':    [{dow:3,time:'19:00'},{dow:6,time:'19:00'}],
  'Nevaeh':   [{dow:0,time:'22:00'}],
  'Libitina': [{dow:1,time:'21:00'},{dow:6,time:'21:00'}],
  'Rakajeth': [{dow:2,time:'22:00'},{dow:0,time:'19:00'}],
}

export const FIXED_SCHEDULE_BOSSES = new Set(Object.keys(FIXED_SCHEDULE_MAP))

export const WORLD_BOSSES = ['Ratan','Parto','Nedra']
export const WORLD_BOSS_HOURS = [11, 20]

export const BOSS_ALIASES = {
  'Gen. Aquleus':'General Aquleus','Gen Aquleus':'General Aquleus',
  'Gen.Aquleus':'General Aquleus','Gen.  Aquleus':'General Aquleus',
  'Aquleus':'General Aquleus','Baron':'Baron Braudmore',
  'Lady D':'Lady Dalia','Dalia':'Lady Dalia',
}

export const SOUND_PRESETS = {
  classic: { beep:{repeats:3,type:'square',freq:1200,interval:0.5,duration:0.45}, tick:{type:'sine',freq:880,duration:0.15,gain:0.4}, spawn:{freqs:[1200,1400,1600],type:'square',interval:0.12,duration:0.25} },
  chimes:  { beep:{repeats:3,type:'sine',freq:900,interval:0.6,duration:0.7},   tick:{type:'sine',freq:660,duration:0.18,gain:0.25}, spawn:{freqs:[880,1320,1760],type:'sine',interval:0.16,duration:0.5}  },
  retro:   { beep:{repeats:3,type:'sawtooth',freq:1000,interval:0.35,duration:0.32}, tick:{type:'square',freq:740,duration:0.12,gain:0.45}, spawn:{freqs:[1000,1200,1400],type:'sawtooth',interval:0.1,duration:0.28} },
  pulse:   { beep:{repeats:3,type:'sine',freq:1500,interval:0.4,duration:0.45},  tick:{type:'sine',freq:1200,duration:0.08,gain:0.35}, spawn:{freqs:[1500,1500,1500],type:'sine',interval:0.08,duration:0.12} },
}

export function getBossLocation(name) {
  if (!name) return ''
  return BOSS_LOCATION[name] ||
    Object.entries(BOSS_LOCATION).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] || ''
}

export function getRespawnMs(name) {
  return RESPAWN_TIME[name] ||
    Object.entries(RESPAWN_TIME).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] || null
}

export function isFixedSchedule(name) {
  if (!name) return false
  return FIXED_SCHEDULE_BOSSES.has(name) ||
    [...FIXED_SCHEDULE_BOSSES].some(k => k.toLowerCase() === name.toLowerCase())
}

export function resolveBossAlias(name) {
  if (!name) return name
  const t = name.trim()
  if (BOSS_ALIASES[t]) return BOSS_ALIASES[t]
  const l = t.toLowerCase()
  for (const [a, c] of Object.entries(BOSS_ALIASES)) {
    if (a.toLowerCase() === l) return c
  }
  return t
}

export function generateFixedScheduleEvents(daysAhead = 14) {
  const events = [], now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  for (let d = 0; d < daysAhead; d++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d)
    const dow = day.getDay()
    for (const [boss, slots] of Object.entries(FIXED_SCHEDULE_MAP)) {
      for (const slot of slots) {
        if (slot.dow !== dow) continue
        const [hh, mm] = slot.time.split(':').map(Number)
        const dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0)
        if (dt.getTime() < Date.now()) continue
        events.push({ boss, start: dt.toISOString(), date: dt.toISOString().slice(0,10), time: dt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), dur: '00:30:00', worldBoss: false })
      }
    }
  }
  return events
}

export function generateWorldBossEvents() {
  const events = [], now = Date.now()
  for (let dayOffset = 0; dayOffset < 2; dayOffset++) {
    const base = new Date(now + dayOffset * 864e5)
    for (const hour of WORLD_BOSS_HOURS) {
      const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, 0, 0)
      if (dt.getTime() <= now) continue
      events.push({ boss: 'World Boss', bosses: [...WORLD_BOSSES], date: dt.toISOString().slice(0,10), time: dt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), dur: '01:00:00', start: dt.toISOString(), worldBoss: true })
    }
  }
  return events
}
