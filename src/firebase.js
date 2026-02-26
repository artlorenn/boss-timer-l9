import { initializeApp } from 'firebase/app'
import { getFirestore, doc, getDoc, setDoc, increment } from 'firebase/firestore'
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
  const sid = Math.random().toString(36).slice(2, 10)
  const ur  = ref(rtdb, `presence/bosstimer/${sid}`)
  set(ur, { t: serverTimestamp() })
  onDisconnect(ur).remove()
  onValue(ref(rtdb, 'presence/bosstimer'), s => {
    onCount(s.exists() ? Object.keys(s.val()).length : 0)
  })
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
