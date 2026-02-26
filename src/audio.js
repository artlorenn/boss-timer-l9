import { SOUND_PRESETS } from './data.js'

let currentPreset = localStorage.getItem('soundPreset') || 'classic'
let alarmVolume   = parseInt(localStorage.getItem('alarmVolume') || '80', 10) / 100
let isMuted       = localStorage.getItem('muted') === 'true'

export function getPreset()      { return currentPreset }
export function getVolume()      { return alarmVolume }
export function getMuted()       { return isMuted }
export function setPreset(p)     { currentPreset = p; localStorage.setItem('soundPreset', p) }
export function setVolume(v)     { alarmVolume = v; localStorage.setItem('alarmVolume', Math.round(v * 100)) }
export function setMuted(m)      { isMuted = m; localStorage.setItem('muted', m) }

function preset() { return SOUND_PRESETS[currentPreset] || SOUND_PRESETS.classic }

export function playBeep() {
  if (isMuted) return
  try {
    const cfg = preset().beep
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    for (let i = 0; i < (cfg.repeats || 3); i++) {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      const t = ctx.currentTime + i * (cfg.interval || 0.5)
      osc.type = cfg.type || 'square'
      osc.frequency.value = cfg.freq || 1200
      gain.gain.setValueAtTime(alarmVolume * (cfg.gain || 1), t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (cfg.duration || 0.45))
      osc.connect(gain).connect(ctx.destination)
      osc.start(t); osc.stop(t + (cfg.duration || 0.45))
    }
  } catch (e) {}
}

export function playTick() {
  if (isMuted) return
  try {
    const cfg = preset().tick || {}
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.type = cfg.type || 'sine'
    osc.frequency.value = cfg.freq || 880
    gain.gain.setValueAtTime((cfg.gain || 0.4) * alarmVolume, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (cfg.duration || 0.15))
    osc.connect(gain).connect(ctx.destination)
    osc.start(); osc.stop(ctx.currentTime + (cfg.duration || 0.2))
  } catch (e) {}
}

export function playSpawnSound() {
  if (isMuted) return
  try {
    const cfg = preset().spawn || {}
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;(cfg.freqs || [1200, 1400, 1600]).forEach((f, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      const t = ctx.currentTime + i * (cfg.interval || 0.12)
      osc.type = cfg.type || 'square'
      osc.frequency.value = f
      gain.gain.setValueAtTime(alarmVolume * (cfg.gain || 1), t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + (cfg.duration || 0.25))
      osc.connect(gain).connect(ctx.destination)
      osc.start(t); osc.stop(t + (cfg.duration || 0.3))
    })
  } catch (e) {}
}
