// Klien data KLINIKTA Inventory — Firebase Realtime Database.
// Nama fungsi ekspor dipertahankan sama persis dengan versi GAS lama, sehingga
// komponen (App, Belanja, Admin, Rekap) tidak perlu berubah.
//
// Logika stok/rekap di-port apa adanya dari gas/Code.gs (dihitung saat baca).
// Upload file (foto/faktur) tetap lewat GAS → Drive (RTDB tidak menyimpan blob besar).
import {
  rdbGet, rdbSet, rdbUpdate, rdbRemove, rdbPush, valuesOf,
} from './firebase.js'
import { BRAND_DEFAULT } from './brand.js'

// GAS hanya dipakai untuk upload file ke Drive (bukan lagi sebagai database).
const GAS_URL = import.meta.env.VITE_GAS_URL || ''

// Firebase selalu terkonfigurasi (config ada di firebase.js).
export const isConfigured = () => true

// ---------------------------------------------------------------------------
// Konstanta (disalin dari Code.gs)
// ---------------------------------------------------------------------------
const KELOMPOK_PERSEDIAAN = { 'BHP Gigi': true, 'BHP Umum': true, 'Obat': true }
const KELOMPOK_STOK = ['BHP Gigi', 'BHP Umum', 'Obat', 'Alkes', 'ATK']
const KODE_PREFIX = { 'BHP Gigi': 'BHPG-', 'BHP Umum': 'BHPU-', 'Obat': 'OBT-', 'Alkes': 'ALK-', 'ATK': 'ATK-' }
// Kelompok yang butuh Batch & Tanggal Expired saat diterima ke stok.
const KELOMPOK_BATCH = { 'BHP Gigi': true, 'BHP Umum': true, 'Obat': true }
const STATUS_FLOW = ['Dipesan', 'Dibayar', 'Diterima', 'Masuk Stok']

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------
const num = (v) => { if (v === '' || v == null) return 0; const n = Number(v); return isNaN(n) ? 0 : n }
const fmtDate = (d) => (d ? String(d).slice(0, 10) : '')
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// Nama staf dipakai sebagai key RTDB — buang karakter terlarang (. # $ [ ] /).
const keyify = (s) => String(s == null ? '' : s).replace(/[.#$/[\]]/g, '_')

const sumBy = (rows, keyField, valField) => {
  const out = {}
  rows.forEach((r) => { const k = r[keyField]; if (!k) return; out[k] = (out[k] || 0) + num(r[valField]) })
  return out
}
const sumSince = (rows, kode, sinceTanggal) => {
  const since = fmtDate(sinceTanggal)
  let total = 0
  rows.forEach((r) => { if (r.kode === kode && fmtDate(r.tanggal) > since) total += num(r.jumlah) })
  return total
}
const groupCounts = (master) => {
  const c = {}
  master.forEach((m) => { if (m.aktif === false || String(m.aktif) === 'false') return; c[m.kelompok] = (c[m.kelompok] || 0) + 1 })
  return c
}
const stockStatus = (stok, reorder) => {
  if (!reorder || reorder <= 0) return 'aman'
  if (stok <= reorder) return 'low'
  if (stok <= reorder * 2) return 'menipis'
  return 'aman'
}
const defaultKategori = (kelompok) => {
  if (kelompok === 'Obat') return 'Obat-obatan'
  if (kelompok === 'BHP Umum') return 'Penjualan BHP'
  if (kelompok === 'Alkes') return 'Beban Alkes'
  if (kelompok === 'ATK') return 'Beban ATK dan Perlengkapan Kantor'
  return 'Beban Penggunaan Produk Internal'
}

// ---------------------------------------------------------------------------
// MIRROR ke Google Sheets via GAS (fire-and-forget, no-cors).
// RTDB tetap sumber kebenaran; ini cermin/log untuk akuntan (best-effort).
// ---------------------------------------------------------------------------
function mirror(action, payload) {
  if (!GAS_URL) return
  try {
    fetch(GAS_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
    }).catch(() => {})
  } catch (e) { /* abaikan: mirror best-effort */ }
}

// Bentuk nota RTDB → baris Sheets (nama kolom = kunci) untuk mirror_belanja.
function belanjaToSheet(nota) {
  const notaRow = {
    idBelanja: nota.idBelanja, timestamp: nota.ts ? new Date(nota.ts).toISOString() : '',
    tanggalPesan: fmtDate(nota.tanggalPesan), tanggalTerima: fmtDate(nota.tanggalTerima),
    sumber: nota.sumber || '', supplier: nota.supplier || '', noVA: nota.noVA || '',
    subtotal: num(nota.subtotal), pengiriman: num(nota.pengiriman), diskonPengiriman: num(nota.diskonPengiriman),
    voucherShopee: num(nota.voucherShopee), voucherToko: num(nota.voucherToko), biayaLayanan: num(nota.biayaLayanan),
    totalNota: num(nota.totalNota), status: nota.status || '', fotoUrl: nota.fotoUrl || '', fakturUrl: nota.fakturUrl || '',
    dipesanOleh: nota.dipesanOleh || '', dibayarOleh: nota.dibayarOleh || '', diterimaOleh: nota.diterimaOleh || '', distokOleh: nota.distokOleh || '', catatan: nota.catatan || '',
  }
  const items = nota.items ? Object.values(nota.items).sort((a, c) => num(a.baris) - num(c.baris)).map((it) => ({
    idBelanja: nota.idBelanja, baris: num(it.baris), nama: it.nama, qty: num(it.qty), hargaSatuan: num(it.hargaSatuan),
    subtotalItem: num(it.subtotalItem), alokasiBiaya: num(it.alokasiBiaya), hargaRiilTotal: num(it.hargaRiilTotal),
    hargaRiilUnit: num(it.hargaRiilUnit), klasifikasi: it.klasifikasi || '', kodeMaster: it.kodeMaster || '', kelompok: it.kelompok || '',
    batch: it.batch || '', expired: it.expired || '',
  })) : []
  return { nota: notaRow, items }
}

// Bentuk record antrian aset RTDB → baris Sheets untuk mirror_antrian.
const antrianToSheet = (a) => ({
  idAset: a.idAset, timestamp: a.ts ? new Date(a.ts).toISOString() : '', idBelanja: a.idBelanja || '',
  nama: a.nama || '', tanggalTerima: fmtDate(a.tanggalTerima), hargaTotal: num(a.hargaTotal),
  sumber: a.sumber || '', kategori: a.kategori || 'Aset', statusCatat: a.statusCatat || 'Belum dicatat',
})

// Catat aktivitas akun (untuk panel Log Aktivitas admin). Best-effort.
async function logActivity(user, aksi, detail) {
  try { await rdbPush('aktivitas', { ts: Date.now(), tanggal: todayStr(), user: user || '-', aksi, detail: detail || '' }) }
  catch (e) { /* abaikan: log tak boleh menggagalkan aksi utama */ }
}

// Sinkronkan seluruh master ke sheet master_item (dipanggil setelah perubahan master).
async function mirrorMasterFull() {
  try {
    const masterObj = (await rdbGet('master')) || {}
    const rows = Object.values(masterObj).map((m) => ({
      kode: m.kode, nama: m.nama, kelompok: m.kelompok, kategoriProduk: m.kategoriProduk || m.kelompok,
      subKategori: m.subKategori || '', satuan: m.satuan || '', kemasan: m.kemasan || '',
      hargaAcuan: num(m.hargaAcuan), kategoriDefault: m.kategoriDefault || '', metode: m.metode || 'Praktis',
      titikReorder: (m.titikReorder === '' || m.titikReorder == null) ? '' : num(m.titikReorder),
      aktif: !(m.aktif === false || String(m.aktif) === 'false'),
    }))
    mirror('mirror_master', { rows })
  } catch (e) { /* abaikan */ }
}

// Tulis ulang sheet transaksi_pakai / opname dari RTDB (setelah edit/hapus admin).
async function mirrorPakaiFull() {
  try {
    const rows = valuesOf(await rdbGet('pakai')).map((r) => ({
      timestamp: r.ts ? new Date(r.ts).toISOString() : '', tanggal: fmtDate(r.tanggal), kelompok: r.kelompok,
      kode: r.kode, nama: r.nama, jumlah: num(r.jumlah), user: r.user || '', catatan: r.catatan || '',
    }))
    mirror('mirror_full', { sheet: 'transaksi_pakai', rows })
  } catch (e) { /* abaikan */ }
}
async function mirrorOpnameFull() {
  try {
    const rows = valuesOf(await rdbGet('opname')).map((r) => ({
      timestamp: r.ts ? new Date(r.ts).toISOString() : '', tanggal: fmtDate(r.tanggal), kelompok: r.kelompok,
      kode: r.kode, nama: r.nama, stokSistem: num(r.stokSistem), stokFisik: num(r.stokFisik),
      selisih: num(r.selisih), user: r.user || '', catatan: r.catatan || '',
    }))
    mirror('mirror_full', { sheet: 'opname', rows })
  } catch (e) { /* abaikan */ }
}

// ---------------------------------------------------------------------------
// Pembaca dasar
// ---------------------------------------------------------------------------
const masterByKode = async () => (await rdbGet('master')) || {}

// Daftar nota belanja sebagai array, item dijadikan array terurut baris.
async function belanjaArray() {
  const obj = (await rdbGet('belanja')) || {}
  return Object.values(obj).map((n) => ({
    ...n,
    items: n.items ? Object.values(n.items).sort((a, c) => num(a.baris) - num(c.baris)) : [],
  }))
}

// Barang masuk = item bernota "Masuk Stok" yang sudah dipetakan ke master.
function receivedMasuk(belanja) {
  const out = []
  belanja.forEach((b) => {
    if (String(b.status) !== 'Masuk Stok') return
    b.items.forEach((it) => { if (it.kodeMaster) out.push({ kode: it.kodeMaster, jumlah: num(it.qty), tanggal: fmtDate(b.tanggalTerima) }) })
  })
  return out
}

// Harga beli rata-rata tertimbang per kode (dari item yang sudah masuk stok).
function avgCostByKode(belanja) {
  const qty = {}, val = {}
  belanja.forEach((b) => {
    if (String(b.status) !== 'Masuk Stok') return
    b.items.forEach((it) => {
      if (!it.kodeMaster) return
      qty[it.kodeMaster] = (qty[it.kodeMaster] || 0) + num(it.qty)
      val[it.kodeMaster] = (val[it.kodeMaster] || 0) + num(it.hargaRiilTotal)
    })
  })
  const avg = {}
  Object.keys(qty).forEach((k) => { if (qty[k] > 0) avg[k] = val[k] / qty[k] })
  return avg
}

// ---------------------------------------------------------------------------
// Peran (dibaca dari RTDB users — bukan dari klien)
// ---------------------------------------------------------------------------
async function peranOf(nama) {
  const u = await rdbGet('users/' + keyify(nama))
  const raw = (u && u.peran) || 'staf'
  return String(raw).split(',').map((r) => r.trim()).filter(Boolean)
}
async function requireAdmin(nama) {
  const roles = await peranOf(nama)
  if (roles.indexOf('admin') < 0) throw new Error('Hanya admin yang boleh melakukan ini.')
}
async function requireRole(nama, allowed) {
  const roles = await peranOf(nama)
  if (roles.indexOf('admin') >= 0) return
  if (!allowed.some((a) => roles.indexOf(a) >= 0)) {
    throw new Error('Akses ditolak: butuh peran ' + allowed.join('/') + ' atau admin. Peran Anda: ' + roles.join(',') + '.')
  }
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------
export async function getState(kelompok, tanggal) {
  const today = tanggal || todayStr()
  const masterObj = await masterByKode()
  const master = Object.values(masterObj)
  const belanja = await belanjaArray()
  const masuk = receivedMasuk(belanja)
  const pakai = valuesOf(await rdbGet('pakai'))
  const opname = valuesOf(await rdbGet('opname'))

  const masukByKode = sumBy(masuk, 'kode', 'jumlah')
  const pakaiByKode = sumBy(pakai, 'kode', 'jumlah')

  const lastOpname = {}
  opname.forEach((r) => {
    const k = r.kode; if (!k) return
    if (!lastOpname[k] || String(r.tanggal) >= String(lastOpname[k].tanggal)) {
      lastOpname[k] = { tanggal: r.tanggal, stokFisik: num(r.stokFisik) }
    }
  })

  const pakaiToday = {}
  pakai.forEach((r) => { if (fmtDate(r.tanggal) === today) pakaiToday[r.kode] = (pakaiToday[r.kode] || 0) + num(r.jumlah) })

  const items = master.filter((m) => {
    if (kelompok && m.kelompok !== kelompok) return false
    return m.aktif !== false && String(m.aktif) !== 'false'
  }).map((m) => {
    const k = m.kode
    let stok
    if (lastOpname[k]) {
      const since = lastOpname[k].tanggal
      stok = lastOpname[k].stokFisik + sumSince(masuk, k, since) - sumSince(pakai, k, since)
    } else {
      stok = (masukByKode[k] || 0) - (pakaiByKode[k] || 0)
    }
    const reorder = num(m.titikReorder)
    return {
      kode: k, nama: m.nama, kelompok: m.kelompok,
      kategoriProduk: m.kategoriProduk, subKategori: m.subKategori,
      satuan: m.satuan, kemasan: m.kemasan,
      hargaAcuan: num(m.hargaAcuan), kategoriDefault: m.kategoriDefault,
      metode: m.metode || 'Praktis', titikReorder: reorder,
      stok, pakaiHariIni: pakaiToday[k] || 0, status: stockStatus(stok, reorder),
    }
  })

  return { tanggal: today, kelompok, counts: groupCounts(master), items }
}

export async function getUsers() {
  return valuesOf(await rdbGet('users'))
    .filter((u) => u.nama && u.aktif !== false && String(u.aktif) !== 'false')
    .map((u) => ({ nama: String(u.nama), kelompok: u.kelompok || 'BHP Gigi', peran: u.peran || 'staf' }))
}

export async function getMasterAll() {
  return Object.values(await masterByKode())
    .filter((m) => m.kode)
    .map((m) => ({
      kode: m.kode, nama: m.nama, kelompok: m.kelompok, subKategori: m.subKategori,
      satuan: m.satuan, kemasan: m.kemasan, hargaAcuan: num(m.hargaAcuan),
      metode: m.metode || 'Praktis', titikReorder: num(m.titikReorder),
      aktif: !(m.aktif === false || String(m.aktif) === 'false'),
    }))
}

export async function getSettings() {
  return {
    keywords: valuesOf(await rdbGet('klasifikasi_kw'))
      .filter((r) => r.keyword)
      .map((r) => ({ klasifikasi: r.klasifikasi, keyword: String(r.keyword) })),
    kelompokStok: KELOMPOK_STOK,
    statusFlow: STATUS_FLOW,
  }
}

export async function getBelanja() {
  const out = await belanjaArray()
  out.sort((a, b) => num(b.ts) - num(a.ts)) // terbaru dulu
  return out.map((b) => ({
    idBelanja: b.idBelanja, tanggalPesan: fmtDate(b.tanggalPesan), tanggalTerima: fmtDate(b.tanggalTerima),
    sumber: b.sumber, supplier: b.supplier, noVA: b.noVA,
    subtotal: num(b.subtotal), pengiriman: num(b.pengiriman), diskonPengiriman: num(b.diskonPengiriman),
    voucherShopee: num(b.voucherShopee), voucherToko: num(b.voucherToko), biayaLayanan: num(b.biayaLayanan),
    totalNota: num(b.totalNota), status: b.status,
    fotoUrl: b.fotoUrl || '', fakturUrl: b.fakturUrl || '',
    dipesanOleh: b.dipesanOleh, dibayarOleh: b.dibayarOleh, diterimaOleh: b.diterimaOleh, distokOleh: b.distokOleh,
    catatan: b.catatan,
    items: b.items.map((it) => ({
      baris: num(it.baris), nama: it.nama, qty: num(it.qty), hargaSatuan: num(it.hargaSatuan),
      hargaRiilTotal: num(it.hargaRiilTotal), hargaRiilUnit: num(it.hargaRiilUnit),
      klasifikasi: it.klasifikasi || '', kodeMaster: it.kodeMaster || '', kelompok: it.kelompok || '',
      batch: it.batch || '', expired: it.expired || '',
    })),
  }))
}

export async function getRekap(periode) {
  const per = periode || todayStr().slice(0, 7)
  const belanja = await belanjaArray()
  const masterObj = await masterByKode()

  const recv = {}
  belanja.forEach((b) => { if (String(b.status) === 'Masuk Stok' && fmtDate(b.tanggalTerima).slice(0, 7) === per) recv[b.idBelanja] = b })

  let totalPersediaan = 0, totalBebanAlkes = 0, totalBebanATK = 0
  belanja.forEach((b) => {
    if (!recv[b.idBelanja]) return
    b.items.forEach((it) => {
      const v = num(it.hargaRiilTotal)
      if (KELOMPOK_PERSEDIAAN[it.kelompok]) totalPersediaan += v
      else if (String(it.kelompok) === 'Alkes') totalBebanAlkes += v
      else if (String(it.kelompok) === 'ATK') totalBebanATK += v
    })
  })

  const aset = valuesOf(await rdbGet('antrian_aset'))
    .filter((a) => a.idAset && String(a.statusCatat) !== 'Sudah dicatat')
    .map((a) => ({ idAset: a.idAset, nama: a.nama, tanggalTerima: fmtDate(a.tanggalTerima), hargaTotal: num(a.hargaTotal), sumber: a.sumber }))

  const avg = avgCostByKode(belanja)
  const hpp = {}
  valuesOf(await rdbGet('pakai')).forEach((r) => {
    if (fmtDate(r.tanggal).slice(0, 7) !== per) return
    const kel = r.kelompok || (masterObj[r.kode] ? masterObj[r.kode].kelompok : 'Lainnya')
    const cost = (avg[r.kode] != null) ? avg[r.kode] : (masterObj[r.kode] ? num(masterObj[r.kode].hargaAcuan) : 0)
    hpp[kel] = (hpp[kel] || 0) + num(r.jumlah) * cost
  })

  const selisih = valuesOf(await rdbGet('opname'))
    .filter((o) => fmtDate(o.tanggal).slice(0, 7) === per && num(o.selisih) !== 0)
    .map((o) => ({ kode: o.kode, nama: o.nama, kelompok: o.kelompok, selisih: num(o.selisih), tanggal: fmtDate(o.tanggal) }))

  return {
    periode: per,
    persediaan: { totalPersediaan: Math.round(totalPersediaan), totalBebanAlkes: Math.round(totalBebanAlkes), totalBebanATK: Math.round(totalBebanATK) },
    antrianAset: aset,
    hppPemakaian: Object.keys(hpp).map((k) => ({ kelompok: k, total: Math.round(hpp[k]) })),
    selisihOpname: selisih,
  }
}

// ---------------------------------------------------------------------------
// WRITE — pemakaian / opname
// ---------------------------------------------------------------------------
export async function savePakai({ tanggal, user, lines }) {
  const master = await masterByKode()
  const ts = Date.now(); const tgl = tanggal || todayStr()
  const tsIso = new Date(ts).toISOString()
  const rows = []
  for (const ln of lines || []) {
    const m = master[ln.kode]; if (!m) throw new Error('Kode tidak ada di master: ' + ln.kode)
    const qty = num(ln.qty); if (qty <= 0) continue
    await rdbPush('pakai', { ts, tanggal: tgl, kelompok: m.kelompok, kode: ln.kode, nama: m.nama, jumlah: qty, user: user || '', catatan: ln.catatan || '' })
    rows.push({ timestamp: tsIso, tanggal: tgl, kelompok: m.kelompok, kode: ln.kode, nama: m.nama, jumlah: qty, user: user || '', catatan: ln.catatan || '' })
  }
  if (!rows.length) throw new Error('Tidak ada baris valid (semua kosong/nol).')
  mirror('mirror_pakai', { rows })
  logActivity(user, 'Pemakaian', `${rows.length} item dipakai`)
  return { tersimpan: rows.length, tanggal: tgl }
}

export async function saveOpname({ kelompok, tanggal, user, lines }) {
  const tgl = tanggal || todayStr()
  const master = await masterByKode()
  const state = await getState(kelompok || null, tgl)
  const sysByKode = {}; state.items.forEach((i) => { sysByKode[i.kode] = i.stok })
  const ts = Date.now(); const tsIso = new Date(ts).toISOString()
  const rows = []
  for (const ln of lines || []) {
    if (ln.stokFisik === '' || ln.stokFisik == null) continue
    const m = master[ln.kode]; if (!m) throw new Error('Kode tidak ada di master: ' + ln.kode)
    const fisik = num(ln.stokFisik); const sistem = sysByKode[ln.kode] || 0
    await rdbPush('opname', { ts, tanggal: tgl, kelompok: m.kelompok, kode: ln.kode, nama: m.nama, stokSistem: sistem, stokFisik: fisik, selisih: fisik - sistem, user: user || '', catatan: ln.catatan || '' })
    rows.push({ timestamp: tsIso, tanggal: tgl, kelompok: m.kelompok, kode: ln.kode, nama: m.nama, stokSistem: sistem, stokFisik: fisik, selisih: fisik - sistem, user: user || '', catatan: ln.catatan || '' })
  }
  if (!rows.length) throw new Error('Tidak ada baris valid (semua kosong/nol).')
  mirror('mirror_opname', { rows })
  logActivity(user, 'Stok Opname', `${rows.length} item dihitung`)
  return { tersimpan: rows.length, tanggal: tgl }
}

// ---------------------------------------------------------------------------
// WRITE — belanja & terima
// ---------------------------------------------------------------------------
export async function saveBelanja({ nota = {}, items = [], user }) {
  if (!items.length) throw new Error('Tidak ada item belanja.')
  const pengiriman = num(nota.pengiriman), diskonPengiriman = num(nota.diskonPengiriman)
  const voucherShopee = num(nota.voucherShopee), voucherToko = num(nota.voucherToko)
  const biayaLayanan = num(nota.biayaLayanan)

  let sumSub = 0
  items.forEach((it) => { sumSub += num(it.qty) * num(it.hargaSatuan) })
  if (sumSub <= 0) throw new Error('Subtotal item harus lebih dari 0.')

  const netBiaya = pengiriman + biayaLayanan - diskonPengiriman - voucherShopee - voucherToko
  const totalNota = sumSub + netBiaya
  const tglPesan = nota.tanggalPesan || todayStr()
  const ts = Date.now()
  const id = 'BLJ' + ts

  const itemsMap = {}
  let baris = 0
  items.forEach((it) => {
    baris++
    const q = num(it.qty), h = num(it.hargaSatuan)
    const sub = q * h
    const prop = sumSub > 0 ? sub / sumSub : 0
    const aBiaya = netBiaya * prop
    const riilTotal = sub + aBiaya
    const riilUnit = q > 0 ? riilTotal / q : 0
    itemsMap[String(baris)] = {
      baris, nama: it.nama || '', qty: q, hargaSatuan: h, subtotalItem: sub,
      alokasiBiaya: aBiaya, hargaRiilTotal: riilTotal, hargaRiilUnit: riilUnit,
      klasifikasi: '', kodeMaster: '', kelompok: '', batch: '', expired: '',
    }
  })

  const notaObj = {
    idBelanja: id, ts, tanggalPesan: tglPesan, tanggalTerima: '',
    sumber: nota.sumber || '', supplier: nota.supplier || '', noVA: nota.noVA || '',
    subtotal: sumSub, pengiriman, diskonPengiriman, voucherShopee, voucherToko, biayaLayanan,
    totalNota, status: 'Dipesan', fotoUrl: '', fakturUrl: '',
    dipesanOleh: user || '', dibayarOleh: '', diterimaOleh: '', distokOleh: '',
    catatan: nota.catatan || '', items: itemsMap,
  }
  await rdbSet('belanja/' + id, notaObj)
  mirror('mirror_belanja', belanjaToSheet(notaObj))
  logActivity(user, 'Belanja baru', `${nota.sumber || 'tanpa sumber'} · ${baris} item · Rp${totalNota}`)
  return { idBelanja: id, totalNota, items: baris, status: 'Dipesan' }
}

export async function updateBelanjaStatus({ idBelanja, status, user, noVA, tanggalTerima, fotoUrl }) {
  if (!idBelanja) throw new Error('idBelanja wajib.')
  const nota = await rdbGet('belanja/' + idBelanja)
  if (!nota) throw new Error('Nota tidak ditemukan: ' + idBelanja)

  if (status === 'Dibayar') {
    await requireRole(user, ['bendahara'])
    const upd = { status: 'Dibayar', dibayarOleh: user || '' }
    if (noVA) upd.noVA = noVA
    await rdbUpdate('belanja/' + idBelanja, upd)
  } else if (status === 'Diterima') {
    await requireRole(user, ['penerima'])
    const upd = { status: 'Diterima', diterimaOleh: user || '', tanggalTerima: tanggalTerima || todayStr() }
    if (fotoUrl) upd.fotoUrl = fotoUrl
    await rdbUpdate('belanja/' + idBelanja, upd)
  } else {
    throw new Error('Transisi status tidak didukung di sini: ' + status)
  }
  const fresh = await rdbGet('belanja/' + idBelanja)
  if (fresh) mirror('mirror_belanja', belanjaToSheet(fresh))
  logActivity(user, 'Belanja → ' + status, (fresh && fresh.sumber) || idBelanja)
  return { idBelanja, status }
}

export async function finalizeBelanja({ idBelanja, mappings = [], fakturUrl, user }) {
  if (!idBelanja) throw new Error('idBelanja wajib.')
  await requireRole(user, ['logistik'])
  const nota = await rdbGet('belanja/' + idBelanja)
  if (!nota) throw new Error('Nota tidak ditemukan: ' + idBelanja)

  for (const mp of mappings) {
    const target = mp.target
    let kode = '', kelompok = '', klas = ''
    if (target === 'Aset') {
      klas = 'Aset'
    } else {
      if (KELOMPOK_STOK.indexOf(target) < 0) throw new Error('Tujuan tidak valid: ' + target)
      kelompok = target
      klas = (target === 'Obat') ? 'Obat' : (target === 'Alkes') ? 'Alkes' : (target === 'ATK') ? 'ATK' : 'BHP'
      if (mp.kodeMaster) kode = mp.kodeMaster
      else if (mp.newItem && mp.newItem.nama) kode = await createMasterItem(target, mp.newItem)
      else throw new Error('Baris ' + mp.baris + ' belum dipetakan ke item master.')
    }
    // Batch & expired hanya relevan utk BHP/Obat (KELOMPOK_BATCH); selain itu dikosongkan.
    const batch = KELOMPOK_BATCH[target] ? (mp.batch || '') : ''
    const expired = KELOMPOK_BATCH[target] ? (mp.expired || '') : ''
    await rdbUpdate('belanja/' + idBelanja + '/items/' + mp.baris, { kodeMaster: kode, kelompok, klasifikasi: klas, batch, expired })
  }

  const upd = { status: 'Masuk Stok', distokOleh: user || '' }
  if (fakturUrl) upd.fakturUrl = fakturUrl
  if (!fmtDate(nota.tanggalTerima)) upd.tanggalTerima = todayStr()
  await rdbUpdate('belanja/' + idBelanja, upd)

  await queueAssets(idBelanja)

  const fresh = await rdbGet('belanja/' + idBelanja)
  if (fresh) mirror('mirror_belanja', belanjaToSheet(fresh))
  const asetRows = valuesOf(await rdbGet('antrian_aset')).filter((a) => a.idBelanja === idBelanja).map(antrianToSheet)
  if (asetRows.length) mirror('mirror_antrian', { rows: asetRows })

  // Item master baru mungkin dibuat saat finalisasi → sinkron master ke sheet.
  if (mappings.some((mp) => mp.newItem && mp.newItem.nama)) mirrorMasterFull()
  logActivity(user, 'Belanja → Masuk Stok', (fresh && fresh.sumber) || idBelanja)
  return { idBelanja, status: 'Masuk Stok' }
}

// Item ber-klasifikasi Aset masuk antrian aset (hindari duplikat per nama/nota).
async function queueAssets(idBelanja) {
  const nota = await rdbGet('belanja/' + idBelanja)
  if (!nota || !nota.items) return
  const items = Object.values(nota.items).filter((it) => String(it.klasifikasi) === 'Aset')
  if (!items.length) return
  const existing = {}
  valuesOf(await rdbGet('antrian_aset')).forEach((a) => { if (a.idBelanja === idBelanja) existing[String(a.nama)] = true })
  let i = 0
  for (const it of items) {
    if (existing[String(it.nama)]) continue
    const aid = 'AST' + Date.now() + '-' + ('00' + i).slice(-3)
    await rdbPush('antrian_aset', {
      idAset: aid, ts: Date.now(), idBelanja, nama: it.nama,
      tanggalTerima: nota.tanggalTerima || todayStr(), hargaTotal: num(it.hargaRiilTotal),
      sumber: nota.sumber || '', kategori: 'Aset', statusCatat: 'Belum dicatat',
    })
    i++
  }
}

// Buat item master baru (kode otomatis per kelompok). Kembalikan kode.
async function createMasterItem(kelompok, d) {
  const master = await masterByKode()
  const prefix = KODE_PREFIX[kelompok] || 'ITM-'
  let max = 0
  Object.keys(master).forEach((k) => {
    if (k.indexOf(prefix) === 0) {
      const n = parseInt(k.slice(prefix.length).replace(/\D/g, ''), 10)
      if (!isNaN(n) && n > max) max = n
    }
  })
  const kode = prefix + ('000' + (max + 1)).slice(-3)
  await rdbSet('master/' + kode, {
    kode, nama: d.nama, kelompok, kategoriProduk: kelompok, subKategori: d.subKategori || 'Lainnya',
    satuan: d.satuan || '', kemasan: d.kemasan || '', hargaAcuan: num(d.hargaAcuan),
    kategoriDefault: defaultKategori(kelompok), metode: d.metode || 'Praktis',
    titikReorder: (d.titikReorder === '' || d.titikReorder == null) ? 1 : num(d.titikReorder), aktif: true,
  })
  mirrorMasterFull()
  return kode
}

// Upload foto/faktur lewat GAS → Drive, lalu simpan URL ke nota di RTDB.
export async function uploadFile(payload) {
  if (!payload.dataBase64) throw new Error('File kosong.')
  if (!GAS_URL) throw new Error('VITE_GAS_URL belum diisi (dibutuhkan untuk upload bukti ke Drive).')
  const res = await fetch(GAS_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'uploadFile', ...payload }),
  })
  const out = await res.json()
  if (!out.ok) throw new Error(out.error || 'Gagal upload.')
  if (payload.idBelanja) {
    await rdbUpdate('belanja/' + payload.idBelanja, { [payload.kind === 'faktur' ? 'fakturUrl' : 'fotoUrl']: out.data.url })
  }
  return out.data
}

export async function updateAntrianAset({ idAset, statusCatat }) {
  if (!idAset) throw new Error('idAset wajib.')
  const obj = (await rdbGet('antrian_aset')) || {}
  const key = Object.keys(obj).find((k) => String(obj[k].idAset) === String(idAset))
  if (!key) throw new Error('Antrian aset tidak ditemukan: ' + idAset)
  const val = statusCatat || 'Sudah dicatat'
  await rdbUpdate('antrian_aset/' + key, { statusCatat: val })
  const rec = await rdbGet('antrian_aset/' + key)
  if (rec) mirror('mirror_antrian', { rows: [antrianToSheet(rec)] })
  return { idAset, statusCatat: val }
}

// Log aktivitas untuk panel admin (terbaru dulu).
export async function getActivity({ limit = 300 } = {}) {
  const arr = valuesOf(await rdbGet('aktivitas'))
  arr.sort((a, b) => num(b.ts) - num(a.ts))
  return arr.slice(0, limit).map((a) => ({
    ts: num(a.ts), tanggal: a.tanggal || '', user: a.user || '-', aksi: a.aksi || '', detail: a.detail || '',
  }))
}

// ---------------------------------------------------------------------------
// KELOLA PEMAKAIAN & OPNAME (admin — dari menu Rekap LAPKEU)
// ---------------------------------------------------------------------------
// Catatan key: setiap record punya id (push key RTDB) agar bisa diedit/dihapus.
export async function getPakaiRecords(periode) {
  const obj = (await rdbGet('pakai')) || {}
  return Object.entries(obj)
    .map(([id, r]) => ({ id, tanggal: fmtDate(r.tanggal), kode: r.kode, nama: r.nama, kelompok: r.kelompok, jumlah: num(r.jumlah), user: r.user || '' }))
    .filter((r) => !periode || r.tanggal.slice(0, 7) === periode)
    .sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1))
}

export async function getOpnameRecords(periode) {
  const obj = (await rdbGet('opname')) || {}
  return Object.entries(obj)
    .map(([id, r]) => ({ id, tanggal: fmtDate(r.tanggal), kode: r.kode, nama: r.nama, kelompok: r.kelompok, stokSistem: num(r.stokSistem), stokFisik: num(r.stokFisik), selisih: num(r.selisih), user: r.user || '' }))
    .filter((r) => !periode || r.tanggal.slice(0, 7) === periode)
    .sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1))
}

export async function updatePakai({ user, id, jumlah }) {
  await requireAdmin(user)
  const r = await rdbGet('pakai/' + id)
  if (!r) throw new Error('Data pemakaian tidak ditemukan.')
  await rdbUpdate('pakai/' + id, { jumlah: num(jumlah) })
  mirrorPakaiFull()
  logActivity(user, 'Edit Pemakaian', `${r.nama}: ${num(r.jumlah)} → ${num(jumlah)}`)
  return { ok: true }
}
export async function deletePakai({ user, id }) {
  await requireAdmin(user)
  const r = await rdbGet('pakai/' + id)
  if (!r) throw new Error('Data pemakaian tidak ditemukan.')
  await rdbRemove('pakai/' + id)
  mirrorPakaiFull()
  logActivity(user, 'Hapus Pemakaian', `${r.nama} (${num(r.jumlah)}) ${fmtDate(r.tanggal)}`)
  return { ok: true }
}
export async function updateOpname({ user, id, stokFisik }) {
  await requireAdmin(user)
  const r = await rdbGet('opname/' + id)
  if (!r) throw new Error('Data opname tidak ditemukan.')
  const fisik = num(stokFisik)
  await rdbUpdate('opname/' + id, { stokFisik: fisik, selisih: fisik - num(r.stokSistem) })
  mirrorOpnameFull()
  logActivity(user, 'Edit Opname', `${r.nama}: fisik → ${fisik}`)
  return { ok: true }
}
export async function deleteOpname({ user, id }) {
  await requireAdmin(user)
  const r = await rdbGet('opname/' + id)
  if (!r) throw new Error('Data opname tidak ditemukan.')
  await rdbRemove('opname/' + id)
  mirrorOpnameFull()
  logActivity(user, 'Hapus Opname', `${r.nama} ${fmtDate(r.tanggal)}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
export async function login({ nama, pin }) {
  if (!nama || pin == null || pin === '') throw new Error('Nama dan PIN wajib diisi.')
  const u = await rdbGet('users/' + keyify(nama))
  if (!u || u.aktif === false || String(u.aktif) === 'false') throw new Error('Staf tidak ditemukan / tidak aktif.')
  if (String(u.pin) !== String(pin)) throw new Error('PIN salah.')
  return { nama: u.nama || nama, kelompok: u.kelompok || 'BHP Gigi', peran: u.peran || 'staf' }
}

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------
export async function saveMaster({ user, item = {} }) {
  await requireAdmin(user)
  if (!item.nama || !item.kelompok) throw new Error('Nama & kelompok wajib.')
  if (item.kode) {
    const ex = await rdbGet('master/' + item.kode)
    if (!ex) throw new Error('Kode tidak ditemukan: ' + item.kode)
    await rdbUpdate('master/' + item.kode, {
      nama: item.nama, kelompok: item.kelompok, kategoriProduk: item.kelompok,
      subKategori: item.subKategori || '', satuan: item.satuan || '', kemasan: item.kemasan || '',
      hargaAcuan: num(item.hargaAcuan), metode: item.metode || 'Praktis',
      titikReorder: (item.titikReorder === '' || item.titikReorder == null) ? '' : num(item.titikReorder),
      aktif: item.aktif !== false,
    })
    mirrorMasterFull()
    logActivity(user, 'Edit Master', item.kode + ' ' + item.nama)
    return { kode: item.kode, updated: true }
  }
  const kode = await createMasterItem(item.kelompok, item)
  logActivity(user, 'Tambah Master', kode + ' ' + item.nama)
  return { kode, created: true }
}

// Hapus item master. Riwayat transaksi lama yang merujuk kode ini tetap tersimpan.
export async function deleteMaster({ user, kode }) {
  await requireAdmin(user)
  if (!kode) throw new Error('Kode wajib.')
  const ex = await rdbGet('master/' + kode)
  if (!ex) throw new Error('Item tidak ditemukan: ' + kode)
  await rdbRemove('master/' + kode)
  mirrorMasterFull()
  logActivity(user, 'Hapus Master', kode + ' ' + (ex.nama || ''))
  return { deleted: true, kode }
}

export async function saveUser({ user, staf = {} }) {
  await requireAdmin(user)
  if (!staf.nama) throw new Error('Nama staf wajib.')
  const oldKey = keyify(staf.originalNama || staf.nama)
  const existing = await rdbGet('users/' + oldKey)
  const newKey = keyify(staf.nama)
  const rec = {
    nama: staf.nama,
    pin: (staf.pin != null && staf.pin !== '') ? String(staf.pin) : (existing ? existing.pin : ''),
    kelompok: staf.kelompok || '',
    peran: staf.peran || 'logistik',
    aktif: staf.aktif !== false,
  }
  if (existing && newKey !== oldKey) await rdbRemove('users/' + oldKey)
  await rdbSet('users/' + newKey, rec)
  logActivity(user, existing ? 'Edit Staf' : 'Tambah Staf', staf.nama + ' (' + rec.peran + ')')
  return existing ? { nama: staf.nama, updated: true } : { nama: staf.nama, created: true }
}

export async function saveKeyword({ user, klasifikasi, keyword }) {
  await requireAdmin(user)
  const kw = String(keyword || '').trim().toLowerCase()
  if (!klasifikasi || !kw) throw new Error('Klasifikasi & keyword wajib.')
  const dup = valuesOf(await rdbGet('klasifikasi_kw')).some((r) => String(r.klasifikasi) === String(klasifikasi) && String(r.keyword).toLowerCase() === kw)
  if (dup) return { klasifikasi, keyword: kw, duplikat: true }
  await rdbPush('klasifikasi_kw', { klasifikasi, keyword: kw })
  return { klasifikasi, keyword: kw, created: true }
}

export async function deleteKeyword({ user, klasifikasi, keyword }) {
  await requireAdmin(user)
  const kw = String(keyword || '').trim().toLowerCase()
  const obj = (await rdbGet('klasifikasi_kw')) || {}
  const key = Object.keys(obj).find((k) => String(obj[k].klasifikasi) === String(klasifikasi) && String(obj[k].keyword).toLowerCase() === kw)
  if (!key) return { deleted: false }
  await rdbRemove('klasifikasi_kw/' + key)
  return { deleted: true }
}

// ---------------------------------------------------------------------------
// BRAND / TAMPILAN — logo, warna, font (logo data URL disimpan terpisah)
// ---------------------------------------------------------------------------
export async function getBrand() {
  const b = (await rdbGet('brand')) || {}
  let logo = ''
  if (b.logo === '__custom__') logo = (await rdbGet('brandLogo')) || ''
  return { ...BRAND_DEFAULT, ...b, logo }
}

// Sinkron penuh RTDB → Google Sheets (kosongkan lalu tulis ulang). Admin-only.
// Dipakai untuk menjadikan spreadsheet cermin tepat + membersihkan data lama.
export async function resyncSheets({ user }) {
  await requireAdmin(user)
  if (!GAS_URL) throw new Error('VITE_GAS_URL belum diisi (dibutuhkan untuk sinkron Sheets).')

  const masterObj = await masterByKode()
  const master = Object.values(masterObj).map((m) => ({
    kode: m.kode, nama: m.nama, kelompok: m.kelompok, kategoriProduk: m.kategoriProduk || m.kelompok,
    subKategori: m.subKategori || '', satuan: m.satuan || '', kemasan: m.kemasan || '',
    hargaAcuan: num(m.hargaAcuan), kategoriDefault: m.kategoriDefault || '', metode: m.metode || 'Praktis',
    titikReorder: (m.titikReorder === '' || m.titikReorder == null) ? '' : num(m.titikReorder),
    aktif: !(m.aktif === false || String(m.aktif) === 'false'),
  }))
  const pakai = valuesOf(await rdbGet('pakai')).map((r) => ({
    timestamp: r.ts ? new Date(r.ts).toISOString() : '', tanggal: fmtDate(r.tanggal), kelompok: r.kelompok,
    kode: r.kode, nama: r.nama, jumlah: num(r.jumlah), user: r.user || '', catatan: r.catatan || '',
  }))
  const opname = valuesOf(await rdbGet('opname')).map((r) => ({
    timestamp: r.ts ? new Date(r.ts).toISOString() : '', tanggal: fmtDate(r.tanggal), kelompok: r.kelompok,
    kode: r.kode, nama: r.nama, stokSistem: num(r.stokSistem), stokFisik: num(r.stokFisik),
    selisih: num(r.selisih), user: r.user || '', catatan: r.catatan || '',
  }))
  const bel = await belanjaArray()
  const belanja = bel.map((b) => belanjaToSheet(b).nota)
  const itemBelanja = bel.flatMap((b) => belanjaToSheet(b).items)
  const antrian = valuesOf(await rdbGet('antrian_aset')).map(antrianToSheet)
  const keywords = valuesOf(await rdbGet('klasifikasi_kw')).map((k) => ({ klasifikasi: k.klasifikasi, keyword: k.keyword }))

  const res = await fetch(GAS_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'resyncSheets', user, data: { master, pakai, opname, belanja, itemBelanja, antrian, keywords } }),
  })
  const out = await res.json()
  if (!out.ok) throw new Error(out.error || 'Gagal sinkron ke Sheets.')
  return out.data
}

export async function saveBrand({ user, brand }) {
  await requireAdmin(user)
  const { logo, ...rest } = brand || {}
  if (logo && String(logo).startsWith('data:')) {
    // Logo baru diunggah → simpan data URL terpisah, tandai '__custom__'.
    await rdbSet('brandLogo', logo)
    await rdbSet('brand', { ...rest, logo: '__custom__' })
  } else if (logo === '__custom__') {
    // Logo tidak diubah (tetap kustom yang lama).
    await rdbSet('brand', { ...rest, logo: '__custom__' })
  } else {
    // Tidak ada logo / dihapus → kembali ke ikon bawaan.
    await rdbRemove('brandLogo')
    await rdbSet('brand', { ...rest, logo: '' })
  }
  logActivity(user, 'Ubah Tampilan', 'logo/warna/font')
  return { ok: true }
}
