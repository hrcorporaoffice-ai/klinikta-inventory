# KLINIKTA Inventory

Web app sub-ledger persediaan KLINIKTA — pencatatan stok BHP/Alkes/Obat per item.
Buku gudang detail yang nantinya menyuplai angka ringkasan ke Akoontan (LAPKEU).

**Tahap saat ini: Tahap 1 — BHP Gigi (fondasi).** Grid isi cepat 61 item gigi,
3 mode (Pemakaian / Opname / Barang Masuk), responsif HP & laptop, simpan ke Google Sheets.
Belum menyentuh Akoontan/RME (lihat [SPEK_TEKNIS](SPEK_TEKNIS_Inventory_KLINIKTA.md) §8).

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
`setup()` membuat: `master_item`, `transaksi_masuk`, `transaksi_pakai`, `opname`,
`rekap_bulanan`, dan `users` (staf + PIN). Aman dijalankan ulang (tidak menimpa data).

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
