// Tebakan klasifikasi belanja dari kata kunci nama barang.
// HANYA usulan awal — staf yang menentukan final (sesuai SPEK_TAMBAHAN Perubahan 2C).
//
// Patokan: masa manfaat > 1 tahun → kemungkinan Aset (ketentuan pajak), bukan semata harga.

export const KLASIFIKASI = ['BHP', 'Obat', 'Alkes', 'ATK', 'Aset']

// ATK & perlengkapan kantor → beban langsung.
const ATK = [
  'kertas', 'hvs', 'pulpen', 'pena', 'pensil', 'spidol', 'marker', 'map', 'amplop',
  'stapler', 'staples', 'klip', 'binder', 'buku', 'nota', 'kwitansi', 'stempel', 'tinta',
  'toner', 'cartridge', 'lakban', 'selotip', 'gunting kertas', 'penggaris', 'lem',
  'sticky note', 'post it', 'ordner', 'tipe x', 'tip ex', 'correction', 'baterai', 'batere',
  'kalkulator', 'atk', 'alat tulis', 'kabel', 'colokan', 'terminal listrik', 'galon',
  'tisu', 'sabun', 'pembersih', 'pewangi', 'sapu', 'pel', 'kemoceng', 'tempat sampah',
]

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
  if (hit(nama, ATK)) return 'ATK'
  if (hit(nama, OBAT)) return 'Obat'
  return 'BHP'
}

// Tebak dari kata kunci yang dikelola admin (list {klasifikasi, keyword}).
// Prioritas: Aset > Alkes > ATK > Obat. Fallback ke guess statis.
export function guessFromKeywords(nama, keywords) {
  if (!nama) return 'BHP'
  if (!keywords || !keywords.length) return guessKlasifikasi(nama)
  const n = nama.toLowerCase()
  const has = (klas) => keywords.some((k) => k.klasifikasi === klas && n.includes(String(k.keyword).toLowerCase()))
  if (has('Aset')) return 'Aset'
  if (has('Alkes')) return 'Alkes'
  if (has('ATK')) return 'ATK'
  if (has('Obat')) return 'Obat'
  return guessKlasifikasi(nama)
}

// Tebakan kelompok target saat finalisasi (logistik): Aset/Alkes/ATK -> kelompok itu,
// Obat -> Obat, sisanya default BHP Gigi (mayoritas item gigi).
export function guessTarget(nama, keywords) {
  const klas = guessFromKeywords(nama, keywords)
  if (klas === 'Aset') return 'Aset'
  if (klas === 'Alkes') return 'Alkes'
  if (klas === 'ATK') return 'ATK'
  if (klas === 'Obat') return 'Obat'
  return 'BHP Gigi'
}

export const PANDUAN_KLAS = [
  ['BHP / Obat', 'Habis dipakai (komposit, kapas, obat, jarum). → menambah stok'],
  ['Alkes', 'Dipakai ulang, awet tapi nilai kecil (bur set, pinset). → beban langsung'],
  ['ATK & Perlengkapan', 'Alat tulis & perlengkapan kantor (kertas, pulpen, tinta). → beban langsung'],
  ['Aset', 'Dipakai bertahun-tahun, nilai besar (scaler, light cure, dental unit). → Daftar Aset'],
]
