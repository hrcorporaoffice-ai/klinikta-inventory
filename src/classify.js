// Tebakan klasifikasi belanja dari kata kunci nama barang.
// HANYA usulan awal — staf yang menentukan final (sesuai SPEK_TAMBAHAN Perubahan 2C).
//
// Patokan: masa manfaat > 1 tahun → kemungkinan Aset (ketentuan pajak), bukan semata harga.

export const KLASIFIKASI = ['BHP', 'Obat', 'Alkes', 'Aset']

// Dipakai bertahun-tahun, nilai besar → Aset.
const ASET = [
  'scaler', 'light cure', 'lightcure', 'curing', 'dental unit', 'dental chair', 'kursi',
  'kompresor', 'compressor', 'autoclave', 'sterilisator', 'sterilizer', 'apex locator',
  'micromotor', 'mikromotor', 'contra angle', 'handpiece', 'highspeed', 'high speed',
  'lowspeed', 'low speed', 'rontgen', 'x-ray', 'xray', 'lampu', 'ultrasonic', 'endomotor',
  'amalgamator', 'vibrator', 'trimmer', 'oven', 'kulkas', 'komputer', 'printer', 'monitor',
  'nebulizer', 'tensimeter', 'oksigen konsentrator', 'suction unit',
]

// Dipakai ulang, awet, nilai kecil → Alkes.
const ALKES = [
  'pinset', 'sonde', 'ekskavator', 'excavator', 'kaca mulut', 'tang', 'forceps', 'forcep',
  'plastis', 'burnisher', 'spatula', 'bowl', 'tray', 'bak instrumen', 'nierbeken', 'bengkok',
  'gunting', 'scissor', 'needle holder', 'cheek retractor', 'retractor', 'cement stopper',
  'bur set', 'diamond bur', 'matrix retainer', 'cotton plier', 'elevator', 'cryer', 'bein',
  'tongue', 'mouth mirror', 'probe', 'kuret', 'curette', 'rubber dam frame',
]

// Obat (nama obat umum) → Obat. Selain itu default BHP.
const OBAT = [
  'amoxicillin', 'paracetamol', 'ibuprofen', 'metronidazole', 'cefadroxil', 'cefotaxime',
  'ceftriaxone', 'clindamycin', 'dexamethasone', 'methylprednisolone', 'asam mefenamat',
  'natrium diclofenac', 'diclofenac', 'ranitidine', 'ondansetron', 'amlodipine', 'neurobion',
  'neurosanbe', 'norages', 'santagesik', 'vitamin', 'recodryl', 'gengigel', 'eugenol',
  'antibiotik', 'analgesik', 'injeksi', 'tablet', 'kapsul', 'ampul', 'vial', 'obat',
]

function hit(name, list) {
  const n = name.toLowerCase()
  return list.some((kw) => n.includes(kw))
}

export function guessKlasifikasi(nama) {
  if (!nama) return 'BHP'
  if (hit(nama, ASET)) return 'Aset'
  if (hit(nama, ALKES)) return 'Alkes'
  if (hit(nama, OBAT)) return 'Obat'
  return 'BHP'
}

export const PANDUAN_KLAS = [
  ['BHP / Obat', 'Habis dipakai (komposit, kapas, obat, jarum). → menambah stok'],
  ['Alkes', 'Dipakai ulang, awet tapi nilai kecil (bur set, pinset). → beban langsung'],
  ['Aset', 'Dipakai bertahun-tahun, nilai besar (scaler, light cure, dental unit). → Daftar Aset'],
]
