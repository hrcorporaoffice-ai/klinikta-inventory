// Klien API ke backend Google Apps Script (deployment INVENTORY, bukan absensi).
// URL diambil dari env VITE_GAS_URL (lihat .env.example).
const GAS_URL = import.meta.env.VITE_GAS_URL || ''

export const isConfigured = () => !!GAS_URL

function ensureUrl() {
  if (!GAS_URL) {
    throw new Error(
      'VITE_GAS_URL belum diisi. Buat file .env dari .env.example dan isi URL Web App GAS, lalu jalankan ulang.'
    )
  }
}

// READ — pakai GET (tanpa preflight CORS).
export async function getState(kelompok, tanggal) {
  ensureUrl()
  const url = new URL(GAS_URL)
  url.searchParams.set('action', 'getState')
  if (kelompok) url.searchParams.set('kelompok', kelompok)
  if (tanggal) url.searchParams.set('tanggal', tanggal)
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' })
  const out = await res.json()
  if (!out.ok) throw new Error(out.error || 'Gagal memuat data.')
  return out.data
}

// WRITE — POST text/plain agar tidak kena CORS preflight di GAS.
async function post(action, payload) {
  ensureUrl()
  const res = await fetch(GAS_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  })
  const out = await res.json()
  if (!out.ok) throw new Error(out.error || 'Gagal menyimpan.')
  return out.data
}

export const savePakai = (payload) => post('savePakai', payload)
export const saveMasuk = (payload) => post('saveMasuk', payload)
export const saveOpname = (payload) => post('saveOpname', payload)
