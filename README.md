# KLINIKTA Inventory

Web app sub-ledger persediaan KLINIKTA — pencatatan stok BHP/Alkes/Obat per item.
Buku gudang detail yang nantinya menyuplai angka ringkasan ke Akoontan (LAPKEU).

**Tahap saat ini: Tahap 1 + modul Belanja.** Grid isi cepat per item, responsif HP & laptop,
simpan ke Google Sheets. **4 mode:**
1. **Pemakaian Hari Ini** — keluar gudang = HPP
2. **Stok Opname** — cek fisik berkala
3. **Belanja & Terima** — catat belanja (komponen biaya checkout Shopee dialokasikan
   proporsional), alur berbasis peran **Dipesan → Dibayar → Diterima → Masuk Stok**
   (foto barang & faktur diunggah ke Drive; logistik memetakan tiap item ke persediaan
   spesifik BHP Gigi/Umum/Obat/Alkes — bisa tambah item master baru — atau Aset→antrian)
4. **Rekap → LAPKEU** — angka siap salin ke Akoontan (Level 1, manual)
5. **Admin** (peran admin) — kelola item master, staf & PIN & peran, kata kunci klasifikasi, ekspor CSV

**Peran:** admin · bendahara · penerima · logistik · staf (diatur di tab Admin / sheet `users`).

Integrasi otomatis ke Akoontan belum disentuh (lihat [SPEK_TEKNIS](SPEK_TEKNIS_Inventory_KLINIKTA.md) §7
& [SPEK_TAMBAHAN](SPEK_TAMBAHAN_Integrasi_Belanja.md)).

> ⚠️ **Project ini TERPISAH PENUH dari web app absensi.** Repo, project Vercel,
> spreadsheet, deployment GAS, dan folder Drive semuanya milik inventory sendiri.
> Satu-satunya yang dibagi: akun login Google/Vercel/GitHub. Lihat [SETUP.md](SETUP.md).

## Stack
- **Frontend:** React + Vite → Vercel
- **Backend:** Google Apps Script (web app API) — folder [`gas/`](gas/)
- **Database:** Google Sheets (spreadsheet `INVENTORY_KLINIKTA_DB`)
- **Storage:** Google Drive (folder `INVENTORY_KLINIKTA_Bukti`, untuk bukti faktur)

## Jalankan lokal
```bash
npm install
cp .env.example .env      # lalu isi VITE_GAS_URL dengan URL Web App GAS
npm run dev
```

## Setup lengkap (Sheet, GAS, Drive, GitHub, Vercel)
Ikuti **[SETUP.md](SETUP.md)** langkah demi langkah. Sudah termasuk pencegahan
konflik multi-account Google yang pernah terjadi saat setup absensi.

## Struktur
```
src/                 Frontend React
  App.jsx            UI 3 mode + grid responsif
  api.js             Klien ke GAS (GET baca, POST text/plain tulis)
  data/masterItems.js  123 item (di-generate dari Master_Persediaan_KLINIKTA.xlsx)
gas/
  Code.gs            Backend: setup(), doGet/doPost, hitung stok
  master_seed.gs     Seed 123 master item untuk setup()
  appsscript.json    Manifest (timezone Asia/Makassar, web app config)
SPEK_TEKNIS_Inventory_KLINIKTA.md   Spesifikasi & aturan main Akoontan
```

## Sheet database
`setup()` membuat: `master_item`, `transaksi_pakai`, `opname`, `transaksi_belanja`,
`item_belanja`, `antrian_aset`, `rekap_bulanan`, dan `users` (staf + PIN).
Aman dijalankan ulang (idempoten, tidak menimpa data). Modul Belanja menggantikan
`transaksi_masuk` lama dengan `transaksi_belanja` + `item_belanja` yang lebih detail.

## Login staf & log "siapa input"
Staf login dengan **memilih nama + PIN ringan** (diatur di sheet `users`). Nama staf
otomatis tercatat di kolom `user` tiap baris log, plus `timestamp` (jam) — jadi di
spreadsheet langsung terbaca siapa mencatat apa dan kapan. Ganti staf via tombol
"Ganti" di header.

## Roadmap
- **Tahap 1 (ini):** Web app BHP Gigi, simpan ke Sheets.
- **Tahap 2:** Modul opname + hitung HPP.
- **Tahap 3:** Integrasi Akoontan (Level 1 → 1.5) + Obat & BHP Umum + jembatan RME.
- **Tahap 4:** Otomasi penuh (Level 2).
