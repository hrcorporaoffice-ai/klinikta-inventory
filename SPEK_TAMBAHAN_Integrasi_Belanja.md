# SPEK TAMBAHAN — Integrasi Modul Belanja
### Addendum untuk SPEK_TEKNIS_Inventory_KLINIKTA.md
### Dibaca bersama spek lama — ini berisi PERUBAHAN saja, bukan penggantian

---

## Konteks

Claude Code sudah mengerjakan spek lama. Dokumen ini berisi perubahan dan tambahan yang harus diterapkan.

Ada satu app belanja yang sudah dibangun sebelumnya (`belanja-klinikta.html`) dan perlu **digabungkan** ke dalam web app inventory sebagai modul terintegrasi (bukan app terpisah).

---

## Perubahan 1 — Struktur Tab/Mode (GANTI yang di spek lama)

Spek lama: web app punya 3 mode (Pemakaian Hari Ini, Stok Opname, Barang Masuk).

**Ganti menjadi 4 mode:**

```
Tab 1: Pemakaian Hari Ini   ← tidak berubah
Tab 2: Stok Opname           ← tidak berubah  
Tab 3: Belanja & Terima      ← BARU: menggantikan "Barang Masuk" + menggabungkan app belanja
Tab 4: Rekap → LAPKEU        ← BARU: ringkasan angka siap salin ke Akoontan
```

Tab "Barang Masuk" di spek lama **dihapus** dan digantikan Tab "Belanja & Terima" yang lebih lengkap.

---

## Perubahan 2 — Tab "Belanja & Terima" (DETAIL PENUH)

### Asal
Porting dan adaptasi dari `belanja-klinikta.html` yang sudah ada. Semua fitur app belanja lama **dipertahankan**, dengan tambahan integrasi ke item master dan stok.

### Fitur yang dipertahankan dari app belanja lama
- Input belanja per item (nama, qty, harga satuan)
- **Alokasi ongkir & diskon proporsional otomatis** ke tiap item berdasarkan nilai
- Tebakan klasifikasi otomatis dari kata kunci nama barang
- Tracking status: Dipesan → Dibayar → Diterima
- Rekap per pos (BHP/Alkes/Aset) dengan filter periode

### Fitur BARU yang ditambahkan

**A. Tiga Jalur Berbeda Saat "Diterima"**

Saat status berubah jadi "Diterima", tiap item memicu aksi berbeda berdasarkan klasifikasinya:

```
BHP / Obat  → petakan ke item master → stok item bertambah
              → masuk jalur LAPKEU: Persediaan (aset lancar)

Alkes       → tidak menambah stok
              → masuk jalur LAPKEU: Beban Alkes (langsung beban)

Aset        → tidak menambah stok
              → masuk antrian "Perlu dicatat ke Daftar Aset"
              → data yang disimpan: nama, tanggal, harga total (sudah termasuk alokasi ongkir), kategori
              → jalur LAPKEU: terpisah, dicatat manual di Daftar Aset Akoontan untuk disusutkan
```

**B. Pemetaan ke Item Master (untuk jalur BHP/Obat)**

Saat staf menerima barang BHP/Obat, sistem meminta pemetaan ke item master:
- Tampilkan dropdown/search item dari master (123 item: BHP Gigi, BHP Umum, Obat)
- Staf pilih item yang cocok
- Setelah dipilih: stok item master bertambah sejumlah qty yang diterima
- Harga per unit yang tersimpan = harga beli riil setelah alokasi ongkir/diskon (bukan harga acuan di master)
- Kalau satu nota berisi beberapa item berbeda, pemetaan dilakukan per item

**C. Klasifikasi: Tebakan + Staf yang Final**

- Sistem tetap **menebak** BHP/Alkes/Aset dari kata kunci (fitur lama dipertahankan) — sebagai usulan awal
- Staf **melihat tebakan dan bisa mengubah** — keputusan final di tangan staf
- Tampilkan **panduan ringkas** di titik input (tooltip/expand):

```
BHP/Obat  → habis dipakai (komposit, kapas, obat, jarum)
Alkes     → dipakai ulang, awet tapi nilai kecil (bur set, pinset)  
Aset      → dipakai bertahun-tahun, nilai besar (scaler, light cure, dental unit)

Patokan: kalau masa pakainya lebih dari 1 tahun → kemungkinan Aset
```

- Definisi Aset yang dipakai: **masa manfaat > 1 tahun** (sesuai ketentuan pajak), bukan semata nilai
- Staf yang menentukan final — sistem tidak memaksa berdasarkan harga

**D. Antrian Aset**

Barang yang diklasifikasikan Aset dan berstatus "Diterima" masuk ke **antrian Aset** — daftar yang mengingatkan Dok/admin untuk mencatatnya ke Daftar Aset Akoontan. Data yang tersimpan di antrian:
- Nama barang
- Tanggal diterima
- Harga total setelah alokasi ongkir/diskon
- Sumber (no. pesanan Shopee)
- Status: Belum dicatat ke Akoontan / Sudah dicatat

Antrian ini ditampilkan di Tab Rekap → LAPKEU sebagai pengingat, bukan dicatat otomatis.

---

## Perubahan 3 — Tab "Rekap → LAPKEU" (BARU)

Tab baru yang menjadi **muara semua angka** yang perlu masuk ke Akoontan.

### Isi rekap (per periode/bulan)

```
Bagian 1 — Dari Belanja & Terima:
  Total Persediaan BHP (pembelian BHP + Obat yang diterima)  → catat di Akoontan: Pengeluaran, kategori Persediaan
  Total Beban Alkes                                           → catat di Akoontan: Pengeluaran, kategori Beban Alkes
  Daftar Aset yang perlu dicatat (antrian)                   → catat manual di Daftar Aset Akoontan

Bagian 2 — Dari Pemakaian Hari Ini:
  Total pemakaian per kelompok (HPP BHP Gigi, HPP BHP Umum, HPP Obat) → Akoontan: Pemasukan, harga 0, kategori "Beban Penggunaan Produk Internal"

Bagian 3 — Dari Opname (kalau ada):
  Selisih stok (sistem vs fisik) → untuk koreksi kalau ada kebocoran
```

### Format output
Angka siap salin, dikelompokkan per pos Akoontan. Ada tombol "Salin" per baris. Tidak ada otomasi langsung ke Akoontan dulu (Level 1 manual, sesuai spek lama).

---

## Perubahan 4 — Backend Sheets (TAMBAHAN)

Spek lama sudah menyebut struktur sheets. Tambahkan sheet baru:

```
Sheet tambahan di INVENTORY_KLINIKTA_DB:
  - transaksi_belanja  : log semua belanja (dari tab Belanja & Terima), satu baris per nota
  - item_belanja       : detail item per nota (many-to-one ke transaksi_belanja)
  - antrian_aset       : barang klasifikasi Aset yang belum dicatat ke Akoontan
```

Sheet `transaksi_masuk` di spek lama **diganti** oleh `transaksi_belanja` + `item_belanja` yang lebih detail.

---

## Perubahan 5 — Migrasi Data App Belanja Lama

App belanja lama (`belanja-klinikta.html`) menyimpan data di `window.storage` (persistent storage artifact). Saat web app baru live:
- Kalau ada data di app lama yang perlu dibawa: export manual (screenshot/catat) lalu input ulang — tidak ada migrasi otomatis karena beda storage
- Kalau app lama masih kosong/percobaan: abaikan, mulai fresh di web app baru
- Dok konfirmasi mana yang berlaku sebelum Claude Code mulai migrasi

---

## Yang TIDAK Berubah dari Spek Lama

- Tujuh aturan main Akoontan (Bagian 2 spek lama) → tetap berlaku penuh
- Model HPP "keluar gudang = terpakai" + atribut Praktis/Detail → tetap
- Switcher 3 kelompok (BHP Gigi/Umum/Obat) → tetap
- Stack teknis (React, Vercel, GAS, Sheets, Drive) → tetap
- Pemisahan tegas dari web app absensi → tetap wajib
- Roadmap bertahap (Tahap 1 dulu, mapankan, baru lanjut) → tetap

---

## Urutan Implementasi yang Disarankan

Karena Claude Code sudah mulai dari spek lama, implementasikan perubahan ini dengan urutan:

1. **Tambah Tab "Belanja & Terima"** (port dari app belanja lama, tambah pemetaan ke master + tiga jalur)
2. **Tambah Tab "Rekap → LAPKEU"** (agregasi dari semua tab)
3. **Tambah sheet backend** yang diperlukan (transaksi_belanja, item_belanja, antrian_aset)
4. **Hapus/rename** Tab "Barang Masuk" yang mungkin sudah dibangun → ganti dengan Tab "Belanja & Terima"

Jangan mengerjakan integrasi langsung ke Akoontan dulu (Level 2) sampai Level 1 (copy-paste manual dari Tab Rekap) sudah mapan dan dipakai nyata.
