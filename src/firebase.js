import { initializeApp } from 'firebase/app'
import { getFirestore, doc, getDoc, setDoc, increment, onSnapshot } from 'firebase/firestore'
import { getDatabase, ref, set, onValue, onDisconnect, serverTimestamp } from 'firebase/database'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
}

const app  = initializeApp(firebaseConfig)
const db   = getFirestore(app)
const rtdb = getDatabase(app)

function trackPresence(basePath, onCount, label) {
  const sid = Math.random().toString(36).slice(2, 10)
  const connectedRef = ref(rtdb, '.info/connected')
  const listRef = ref(rtdb, basePath)
  const userRef = ref(rtdb, `${basePath}/${sid}`)

  const ensurePresence = () => {
    onDisconnect(userRef).remove()
      .then(() => set(userRef, { t: serverTimestamp() }))
      .catch(err => {
        console.error(`[${label}] presence setup failed`, err)
        set(userRef, { t: serverTimestamp() }).catch(innerErr => {
          console.error(`[${label}] set failed`, innerErr)
          onCount(0)
        })
      })
  }

  onCount(0)

  // Try once immediately so first viewer can show as online without waiting.
  ensurePresence()

  onValue(connectedRef, snap => {
    if (snap.val() === true) ensurePresence()
  })

  onValue(listRef, snap => {
    onCount(snap.exists() ? Object.keys(snap.val()).length : 0)
  }, err => {
    console.error(`[${label}] read failed`, err)
    onCount(0)
  })
}

export async function trackVisitor(onCount) {
  const r = doc(db, 'stats', 'bosstimer_visitors')
  if (!sessionStorage.getItem('bosstimer_counted')) {
    sessionStorage.setItem('bosstimer_counted', '1')
    await setDoc(r, { count: increment(1) }, { merge: true })
  }
  const s = await getDoc(r)
  if (s.exists()) onCount(s.data().count)
}

export function trackOnline(onCount) {
  trackPresence('presence/bosstimer', onCount, 'timer online')
}

export async function trackClassVisitor(onCount) {
  const r = doc(db, 'stats', 'class_visitors')
  if (!sessionStorage.getItem('class_counted')) {
    sessionStorage.setItem('class_counted', '1')
    await setDoc(r, { count: increment(1) }, { merge: true })
  }
  const s = await getDoc(r)
  onCount(s.exists() ? (s.data().count || 0) : 0)
}

export function trackClassOnline(onCount) {
  trackPresence('presence/class', onCount, 'class online')
}

export async function fetchSchedule() {
  const snap = await getDoc(doc(db, 'bosstimer', 'schedule'))
  if (!snap.exists()) return null
  return snap.data().bosses || []
}

export async function saveSchedule(bossesJson) {
  await setDoc(doc(db, 'bosstimer', 'schedule'), {
    bosses: bossesJson,
    updatedAt: Date.now()
  })
}

export function subscribeSchedule(onBosses, onError) {
  const scheduleRef = doc(db, 'bosstimer', 'schedule')
  return onSnapshot(scheduleRef, snap => {
    if (!snap.exists()) {
      onBosses(null)
      return
    }
    const data = snap.data()
    onBosses(data?.bosses || [])
  }, err => {
    if (onError) onError(err)
  })
}
