// Firebase Realtime Database untuk KLINIKTA Inventory.
// TERPISAH PENUH dari project absensi: project Firebase ini khusus inventory
// (akun hrcorpora.office@gmail.com). Pola menyusul app absensi: RTDB + anon auth.
//
// Catatan: konfigurasi web Firebase memang ikut terkirim ke browser (bukan rahasia).
// Keamanan dijaga oleh Realtime Database Rules (auth != null) + sifat alat internal.
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  getDatabase, ref, get, set, update, remove, push, onValue,
} from 'firebase/database'

const firebaseConfig = {
  apiKey: 'AIzaSyBKU8pc5r5VsJijrpfb-tKgK_TJaVeRnNA',
  authDomain: 'klinikta-inventory.firebaseapp.com',
  databaseURL: 'https://klinikta-inventory-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'klinikta-inventory',
  storageBucket: 'klinikta-inventory.firebasestorage.app',
  messagingSenderId: '272860661108',
  appId: '1:272860661108:web:dcc5bda31337c56cba5821',
}

const app = initializeApp(firebaseConfig)
const db = getDatabase(app)
const auth = getAuth(app)

// Semua akses RTDB menunggu anon auth dulu (rules butuh auth != null).
export const authReady = signInAnonymously(auth)
  .then(() => true)
  .catch((e) => { console.error('Firebase anon auth gagal:', e); throw e })

// Akar data inventory (terpisah dari subtree lain bila satu project dipakai bersama).
export const ROOT = 'klinikta_inv'
const P = (path) => `${ROOT}/${path}`

export async function rdbGet(path) {
  await authReady
  const snap = await get(ref(db, P(path)))
  return snap.exists() ? snap.val() : null
}

export async function rdbSet(path, value) {
  await authReady
  await set(ref(db, P(path)), value)
  return value
}

export async function rdbUpdate(path, value) {
  await authReady
  await update(ref(db, P(path)), value)
  return value
}

export async function rdbRemove(path) {
  await authReady
  await remove(ref(db, P(path)))
}

// Push child baru; kembalikan key yang dibuat Firebase.
export async function rdbPush(path, value) {
  await authReady
  const r = push(ref(db, P(path)))
  await set(r, value)
  return r.key
}

// Listener realtime; kembalikan fungsi unsubscribe.
export function rdbListen(path, cb) {
  let unsub = () => {}
  authReady.then(() => {
    unsub = onValue(ref(db, P(path)), (snap) => cb(snap.exists() ? snap.val() : null))
  })
  return () => unsub()
}

// Util: ubah objek map RTDB ({key:{...}}) jadi array nilai.
export const valuesOf = (obj) => (obj ? Object.values(obj) : [])
