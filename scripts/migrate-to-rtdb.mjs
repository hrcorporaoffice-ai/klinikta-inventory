// Migrasi data KLINIKTA Inventory: tarik dari GAS lama → tulis ke Firebase RTDB.
// Sekali jalan saat cutover. Jalankan: `node scripts/migrate-to-rtdb.mjs`
//
// Prasyarat:
//   1. RTDB Rules sudah di-set ke { ".read":"auth!=null", ".write":"auth!=null" }.
//   2. Anonymous Auth aktif.
//   3. .env berisi VITE_GAS_URL (deployment GAS lama yang masih hidup).
//
// PIN staf TIDAK bisa dibaca dari GAS (API read tidak mengembalikan PIN), jadi daftar
// USERS di bawah di-seed manual. EDIT sesuai staf asli + PIN sebelum menjalankan.
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getDatabase, ref, set } from 'firebase/database'
import fs from 'node:fs'

const firebaseConfig = {
  apiKey: 'AIzaSyBKU8pc5r5VsJijrpfb-tKgK_TJaVeRnNA',
  authDomain: 'klinikta-inventory.firebaseapp.com',
  databaseURL: 'https://klinikta-inventory-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'klinikta-inventory',
  storageBucket: 'klinikta-inventory.firebasestorage.app',
  messagingSenderId: '272860661108',
  appId: '1:272860661108:web:dcc5bda31337c56cba5821',
}
const ROOT = 'klinikta_inv'

// === EDIT: staf asli + PIN (default = akun bawaan). ===
const USERS = [
  { nama: 'Admin', pin: '0000', peran: 'admin' },
  { nama: 'Bendahara', pin: '2025', peran: 'bendahara' },
  { nama: 'Penerima', pin: '2026', peran: 'penerima' },
  { nama: 'Logistik', pin: '2027', peran: 'logistik' },
]

// Ambil GAS URL dari env atau .env
let GAS = process.env.VITE_GAS_URL
if (!GAS && fs.existsSync('.env')) {
  const m = fs.readFileSync('.env', 'utf8').match(/VITE_GAS_URL=(.+)/)
  if (m) GAS = m[1].trim()
}
if (!GAS) { console.error('VITE_GAS_URL tidak ditemukan (set di .env).'); process.exit(1) }

const keyify = (s) => String(s == null ? '' : s).replace(/[.#$/[\]]/g, '_')
const num = (v) => { if (v === '' || v == null) return 0; const n = Number(v); return isNaN(n) ? 0 : n }

async function get(action, params = {}) {
  const u = new URL(GAS)
  u.searchParams.set('action', action)
  Object.entries(params).forEach(([k, v]) => v != null && u.searchParams.set(k, v))
  const r = await fetch(u, { redirect: 'follow' })
  const o = await r.json()
  if (!o.ok) throw new Error(o.error || ('Gagal: ' + action))
  return o.data
}

const app = initializeApp(firebaseConfig)
const db = getDatabase(app)
const auth = getAuth(app)

async function main() {
  await signInAnonymously(auth)
  console.log('Auth anon OK. Menarik data dari GAS…')

  const master = await get('getMasterAll')
  const settings = await get('getSettings')
  const belanja = await get('getBelanja')
  console.log(`Ditarik: master=${master.length}, keywords=${(settings.keywords || []).length}, belanja=${belanja.length}`)

  // master/{kode}
  const masterMap = {}
  master.forEach((m) => {
    masterMap[m.kode] = {
      kode: m.kode, nama: m.nama, kelompok: m.kelompok, kategoriProduk: m.kelompok,
      subKategori: m.subKategori || '', satuan: m.satuan || '', kemasan: m.kemasan || '',
      hargaAcuan: num(m.hargaAcuan), kategoriDefault: '', metode: m.metode || 'Praktis',
      titikReorder: (m.titikReorder === '' || m.titikReorder == null) ? '' : num(m.titikReorder),
      aktif: m.aktif !== false,
    }
  })
  await set(ref(db, `${ROOT}/master`), masterMap)
  console.log(`→ master: ${Object.keys(masterMap).length} item`)

  // klasifikasi_kw
  const kwMap = {}
  ;(settings.keywords || []).forEach((k, i) => { kwMap['kw' + i] = { klasifikasi: k.klasifikasi, keyword: k.keyword } })
  await set(ref(db, `${ROOT}/klasifikasi_kw`), kwMap)
  console.log(`→ klasifikasi_kw: ${Object.keys(kwMap).length}`)

  // belanja/{idBelanja}
  const bMap = {}
  belanja.forEach((b) => {
    const items = {}
    ;(b.items || []).forEach((it) => {
      const sub = num(it.qty) * num(it.hargaSatuan)
      items[String(it.baris)] = {
        baris: num(it.baris), nama: it.nama, qty: num(it.qty), hargaSatuan: num(it.hargaSatuan),
        subtotalItem: sub, alokasiBiaya: num(it.hargaRiilTotal) - sub,
        hargaRiilTotal: num(it.hargaRiilTotal), hargaRiilUnit: num(it.hargaRiilUnit),
        klasifikasi: it.klasifikasi || '', kodeMaster: it.kodeMaster || '', kelompok: it.kelompok || '',
      }
    })
    bMap[b.idBelanja] = {
      idBelanja: b.idBelanja, ts: Date.parse(b.tanggalPesan) || Date.now(),
      tanggalPesan: b.tanggalPesan || '', tanggalTerima: b.tanggalTerima || '',
      sumber: b.sumber || '', supplier: b.supplier || '', noVA: b.noVA || '',
      subtotal: num(b.subtotal), pengiriman: num(b.pengiriman), diskonPengiriman: num(b.diskonPengiriman),
      voucherShopee: num(b.voucherShopee), voucherToko: num(b.voucherToko), biayaLayanan: num(b.biayaLayanan),
      totalNota: num(b.totalNota), status: b.status || 'Dipesan', fotoUrl: b.fotoUrl || '', fakturUrl: b.fakturUrl || '',
      dipesanOleh: b.dipesanOleh || '', dibayarOleh: b.dibayarOleh || '', diterimaOleh: b.diterimaOleh || '', distokOleh: b.distokOleh || '',
      catatan: b.catatan || '', items,
    }
  })
  if (Object.keys(bMap).length) await set(ref(db, `${ROOT}/belanja`), bMap)
  console.log(`→ belanja: ${Object.keys(bMap).length} nota`)

  // users/{nama}
  const uMap = {}
  USERS.forEach((u) => {
    uMap[keyify(u.nama)] = { nama: u.nama, pin: String(u.pin), kelompok: u.kelompok || '', peran: u.peran || 'logistik', aktif: u.aktif !== false }
  })
  await set(ref(db, `${ROOT}/users`), uMap)
  console.log(`→ users: ${Object.keys(uMap).length}`)

  console.log('\nMigrasi selesai ✓')
  process.exit(0)
}
main().catch((e) => { console.error('GAGAL:', e && e.message ? e.message : e); process.exit(1) })
