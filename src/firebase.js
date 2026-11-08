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
// Kegagalan TIDAK disimpan permanen: kalau login anonim gagal sekali (sinyal HP lemah,
// ganti jaringan, tab dibangunkan dari tidur), akses berikutnya mencoba lagi — bukan
// terus gagal sampai halaman di-reload.
let authPromise = null
export function ensureAuth() {
  if (!authPromise) {
    authPromise = signInAnonymously(auth)
      .then(() => true)
      .catch((e) => { authPromise = null; console.error('Firebase anon auth gagal:', e); throw e })
  }
  return authPromise
}
ensureAuth().catch(() => {}) // mulai lebih awal; kegagalan awal ditangani oleh percobaan ulang

// Akar data inventory (terpisah dari subtree lain bila satu project dipakai bersama).
export const ROOT = 'klinikta_inv'
const P = (path) => `${ROOT}/${path}`

export async function rdbGet(path) {
  await ensureAuth()
  const snap = await get(ref(db, P(path)))
  return snap.exists() ? snap.val() : null
}

export async function rdbSet(path, value) {
  await ensureAuth()
  await set(ref(db, P(path)), value)
  return value
}

export async function rdbUpdate(path, value) {
  await ensureAuth()
  await update(ref(db, P(path)), value)
  return value
}

export async function rdbRemove(path) {
  await ensureAuth()
  await remove(ref(db, P(path)))
}

// Push child baru; kembalikan key yang dibuat Firebase.
export async function rdbPush(path, value) {
  await ensureAuth()
  const r = push(ref(db, P(path)))
  await set(r, value)
  return r.key
}

// Listener realtime; kembalikan fungsi unsubscribe.
export function rdbListen(path, cb) {
  let unsub = () => {}
  ensureAuth().then(() => {
    unsub = onValue(ref(db, P(path)), (snap) => cb(snap.exists() ? snap.val() : null))
  }).catch(() => {})
  return () => unsub()
}

// Util: ubah objek map RTDB ({key:{...}}) jadi array nilai.
export const valuesOf = (obj) => (obj ? Object.values(obj) : [])
