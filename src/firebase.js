const firebaseEnv = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {}
const firebaseDefaults = {
  VITE_FIREBASE_API_KEY: 'AIzaSyAyotrWoly1Xd8qg8-eq97EJoP2Mx8V1To',
  VITE_FIREBASE_AUTH_DOMAIN: 'boss-timer2.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'boss-timer2',
  VITE_FIREBASE_STORAGE_BUCKET: 'boss-timer2.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1089834357623',
  VITE_FIREBASE_APP_ID: '1:1089834357623:web:3f66c8bfb8aa208eb98772',
  VITE_FIREBASE_MEASUREMENT_ID: 'G-70XPG1283P',
  VITE_FIREBASE_DATABASE_URL: 'https://boss-timer2-default-rtdb.asia-southeast1.firebasedatabase.app',
}

function firebaseEnvValue(key) {
  return firebaseEnv[key] || firebaseDefaults[key]
}

const firebaseConfig = {
  apiKey:            firebaseEnvValue('VITE_FIREBASE_API_KEY'),
  authDomain:        firebaseEnvValue('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId:         firebaseEnvValue('VITE_FIREBASE_PROJECT_ID'),
  storageBucket:     firebaseEnvValue('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: firebaseEnvValue('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId:             firebaseEnvValue('VITE_FIREBASE_APP_ID'),
  measurementId:     firebaseEnvValue('VITE_FIREBASE_MEASUREMENT_ID'),
  databaseURL:       firebaseEnvValue('VITE_FIREBASE_DATABASE_URL'),
}

let firebaseSdkPromise = null

async function loadFirebaseSdk() {
  if (!firebaseSdkPromise) {
    firebaseSdkPromise = Promise.all([
      import('firebase/app'),
      import('firebase/firestore'),
      import('firebase/database'),
    ]).then(([appMod, firestoreMod, databaseMod]) => {
      const app = appMod.initializeApp(firebaseConfig)
      return {
        db: firestoreMod.getFirestore(app),
        rtdb: databaseMod.getDatabase(app),
        doc: firestoreMod.doc,
        getDoc: firestoreMod.getDoc,
        setDoc: firestoreMod.setDoc,
        increment: firestoreMod.increment,
        onSnapshot: firestoreMod.onSnapshot,
        ref: databaseMod.ref,
        set: databaseMod.set,
        onValue: databaseMod.onValue,
        onDisconnect: databaseMod.onDisconnect,
        serverTimestamp: databaseMod.serverTimestamp,
      }
    })
  }
  return firebaseSdkPromise
}

async function trackCounter(counterDoc, sessionKey, onCount, label) {
  try {
    const { db, doc, getDoc, setDoc, increment } = await loadFirebaseSdk()
    const r = doc(db, 'stats', counterDoc)
    if (!sessionStorage.getItem(sessionKey)) {
      sessionStorage.setItem(sessionKey, '1')
      await setDoc(r, { count: increment(1) }, { merge: true })
    }
    const s = await getDoc(r)
    if (s.exists()) onCount(s.data().count)
  } catch (err) {
    console.error(`[${label}] tracking failed`, err)
    onCount(0)
  }
}

async function trackPresence(basePath, onCount, label, fallbackBasePath = null) {
  try {
    const { rtdb, ref, set, onValue, onDisconnect, serverTimestamp } = await loadFirebaseSdk()
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
  } catch (err) {
    if (fallbackBasePath) {
      console.warn(`[${label}] presence setup failed; falling back to ${fallbackBasePath}`, err)
      await trackPresence(fallbackBasePath, onCount, label)
      return
    }
    console.error(`[${label}] presence setup failed`, err)
    onCount(0)
  }
}

export async function trackVisitor(onCount) {
  await trackCounter('bosstimer_visitors', 'bosstimer_counted', onCount, 'timer visitor')
}

export async function trackOnline(onCount) {
  await trackPresence('presence/bosstimer', onCount, 'timer online')
}

export async function trackClassVisitor(onCount) {
  await trackCounter('class_visitors', 'class_counted', onCount, 'class visitor')
}

export async function trackClassOnline(onCount) {
  await trackPresence('presence/class', onCount, 'class online')
}

export async function trackVisitorCount(counterDoc, sessionKey, onCount, label = 'visitor') {
  await trackCounter(counterDoc, sessionKey, onCount, label)
}

export async function trackOnlineCount(basePath, onCount, label = 'online', fallbackBasePath = null) {
  await trackPresence(basePath, onCount, label, fallbackBasePath)
}

export async function fetchSchedule() {
  const { db, doc, getDoc } = await loadFirebaseSdk()
  const snap = await getDoc(doc(db, 'bosstimer', 'schedule'))
  if (!snap.exists()) return null
  return snap.data().bosses || []
}

export async function saveSchedule(bossesJson) {
  const { db, doc, setDoc } = await loadFirebaseSdk()
  await setDoc(doc(db, 'bosstimer', 'schedule'), {
    bosses: bossesJson,
    updatedAt: Date.now()
  })
}

export async function subscribeSchedule(onBosses, onError) {
  const { db, doc, onSnapshot } = await loadFirebaseSdk()
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

export async function fetchMarketSnapshot() {
  const { db, doc, getDoc } = await loadFirebaseSdk()
  const snap = await getDoc(doc(db, 'marketTemporal', 'latest'))
  return snap.exists() ? snap.data() : null
}

export async function saveMarketSnapshot(snapshot) {
  const { db, doc, setDoc } = await loadFirebaseSdk()
  await setDoc(doc(db, 'marketTemporal', 'latest'), {
    ...snapshot,
    updatedAt: Date.now()
  })
}

export async function subscribeMarketSnapshot(onSnapshotData, onError) {
  const { db, doc, onSnapshot } = await loadFirebaseSdk()
  return onSnapshot(doc(db, 'marketTemporal', 'latest'), snap => {
    onSnapshotData(snap.exists() ? snap.data() : null)
  }, err => {
    if (onError) onError(err)
  })
}
