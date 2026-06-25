# SPESIFIKASI TEKNIS — Web App Inventory KLINIKTA
### Dokumen Handoff untuk Implementasi di Claude Code

> **Cara pakai:** Buka Claude Code, mulai project baru, lalu paste/lampirkan dokumen ini sebagai konteks pembuka. Claude Code akan langsung paham apa yang harus dibangun tanpa perlu menjelaskan ulang. Lampirkan juga file `Master_Persediaan_KLINIKTA.xlsx` sebagai data awal.

---

## 1. Tujuan & Ruang Lingkup

Membangun **web app sub-ledger persediaan** untuk KLINIKTA — sistem pencatatan stok BHP/Alkes/Obat yang detail per item, terpisah dari LAPKEU Akoontan tapi menyuplai angka ringkasan ke Akoontan tiap bulan.

**Filosofi inti:** Web app = buku gudang detail (sub-ledger). Akoontan = buku besar resmi (general ledger). Web app TIDAK menggantikan Akoontan; ia menyuplai dua angka per bulan ke Akoontan: total pembelian (Persediaan) dan total HPP dari opname.

**Nama project:** `inventory` (atau `klinikta-inventory`)

---

## 2. ATURAN MAIN AKOONTAN (Hasil Verifikasi — WAJIB Dipatuhi)

Bagian ini adalah hasil pengujian langsung pada file Akoontan KLINIKTA (template V3.73 Salon & Klinik di Google Sheets). Setiap aturan sudah diuji dengan recalculation. **Output web app ke Akoontan WAJIB mematuhi semua aturan ini, kalau tidak laporan akan salah secara diam-diam.**

### Aturan 1 — Registrasi Item di Daftar Persediaan
Sebelum dipakai, item harus terdaftar di sheet **Daftar Persediaan** dengan struktur dua blok:
- **Blok Kategori** (kolom C & D): C = Kategori HPP (mis. "HPP - BHP"), D = Kategori Produk (mis. "BHP")
- **Blok Item** (kolom G–L): G = ID, H = Nama, I = Kategori Produk (HARUS cocok dengan kolom D), J = Unit, K = Saldo Awal (**dikosongkan/0**, lihat Aturan 5), L = Harga/Unit
- **Jebakan:** kalau kategori produk di kolom I tidak cocok dengan yang didefinisikan di kolom D, seluruh rantai HPP putus (HPP jadi nol tanpa peringatan).

### Aturan 2 — Pembelian Mulai Baris 8
Di sheet **Pembelian**, data transaksi WAJIB mulai **baris 8**, tidak pernah baris 7. Baris 7 adalah baris perangkap tanpa formula Total (kolom N), sehingga nilai pembelian jadi 0 kalau diisi di sana.
- Kolom: F = Tanggal, H = Produk (pilih dari dropdown DaftarProdukDagang), I = Unit (auto dari master), L = Jumlah, M = Harga/Unit, N = Total (formula `=IF(M<>"",IF(AND(L="",M<>""),M,M*L),M)`), O = Rekening (mis. "Kas"), P = Kategori (= "Persediaan")

### Aturan 3 — Pemakaian via Sheet Pemasukan, Harga 0
Pemakaian internal (BHP terpakai saat tindakan) diinput di sheet **Pemasukan**:
- Kolom: H = Tanggal, K = Uraian, L = Produk (dropdown DaftarSemuaProduk), P = Jumlah terpakai, S = Harga/Unit (**= 0**), U = Rekening ("Kas"), V = Kategori (**= "Beban Penggunaan Produk Internal"**)
- **Mekanisme terverifikasi:** HPP per unit dihitung dari harga BELI (rata-rata tertimbang), bukan harga jual. Harga 0 memastikan tidak ada pendapatan palsu. Stok turun berdasarkan kolom P (Jumlah). HPP mengalir ke Rekap HPP → Laba Rugi. Persediaan di Neraca berkurang.
- Kategori "Beban Penggunaan Produk Internal" = named range `EXPWaste` (Daftar Akun Keuangan D113). Inilah kategori khusus bawaan Akoontan untuk barang dipakai internal.

### Aturan 4 — Formula Bantu Tidak Selalu Ter-extend
Formula kolom bantu (kolom A dll) di sheet Pemasukan/Pembelian tidak otomatis menyalin ke baris baru. Beberapa baris bahkan punya formula yang bergeser (referensi #REF! — karakteristik bawaan template versi KLINIKTA yang fasilitasnya dibatasi). **Saat menulis via GAS, pastikan baris target punya formula bantu yang utuh, atau salin formula dari baris valid sebelumnya.**

### Aturan 5 — Stok Awal HARUS via Pembelian, BUKAN Saldo Awal
Ini hasil uji paling kritis. **Stok awal persediaan TIDAK boleh diketik sebagai saldo awal** (baik di kolom K Daftar Persediaan, maupun D23 Neraca). Sebabnya: mengisi saldo awal langsung menaikkan aset tanpa pasangan → **Neraca timpang persis sebesar nilai stok awal**.
- **Cara benar:** stok awal dicatat sebagai transaksi pembelian pertama (tanggal mulai sistem) di sheet Pembelian. Sistem otomatis mencatat pasangannya (kas keluar), Neraca tetap seimbang.
- Bukti uji: Cara 1 (ketik D23) → Neraca timpang Rp 4.000.000. Cara 2 (via Pembelian) → Neraca seimbang sempurna (selisih 0).

### Aturan 6 — Metode Penilaian: Rata-rata Tertimbang
Formula HPP Akoontan: `HPP/unit = (nilai awal + nilai beli) / (qty awal + qty beli)`. Ini **weighted average** — harga beli berbeda-beda otomatis dirata-rata. Harga fluktuatif & multi-merek (yang digabung) terserap otomatis.

### Aturan 7 — Penjualan vs Pemakaian
Item yang **dijual** (bukan dipakai internal) diinput di Pemasukan dengan harga jual nyata + kategori pendapatan ("Penjualan BHP", "Penjualan Alkes", atau "Obat-obatan"). Beda dari pemakaian hanya di dua kolom: Harga (jual vs 0) dan Kategori (pendapatan vs "Beban Penggunaan Produk Internal"). Obat punya dua jalur: dipakai internal ATAU dijual.

---

## 3. FOKUS & MODEL HPP (Keputusan Final — DIREVISI)

**Fokus web app dipersempit ke 3 hal yang benar-benar dibutuhkan Dok:**
1. Tracking **pengeluaran pembelian** BHP & obat (uang keluar beli stok)
2. **Sisa stok** per item (stok gudang)
3. Tersambung ke **LAPKEU**

**Penjualan ke pasien TIDAK disentuh web app** (tetap via RME + jurnal manual seperti sekarang). Alasannya: kebutuhan Dok ada di sisi pembelian & stok, bukan penjualan. Penjualan tersebar di RME/jurnal adalah masalah terpisah yang tidak diselesaikan di fase ini.

### Model HPP: "Keluar Gudang = Terpakai" (metode beban saat penyerahan)
- **Mode utama = "Pakai / Keluar Gudang"** (BUKAN opname). Begitu staf ambil barang dari gudang, langsung lapor → dihitung sebagai HPP saat itu juga. Tidak menunggu opname.
- **Alasan:** stok di poli kecil/tidak material, jadi "keluar gudang" dianggap "terpakai" — praktis & sesuai alur kerja staf.
- **Konsekuensi yang disadari:** HPP diakui sedikit lebih cepat (saat keluar gudang, bukan saat benar-benar dipakai ke pasien). Selisih kecil karena sisa poli kecil. Ini pilihan sadar, bisa dijelaskan ke konsultan pajak sebagai "beban saat penyerahan ke poli".
- **Data stok = sisa di gudang.** Barang yang sudah keluar gudang ke poli tidak lagi dihitung sebagai stok, walau fisiknya mungkin masih ada di poli.

### Atribut "Praktis vs Detail" per item
- **Praktis (default mayoritas item):** keluar gudang = langsung HPP. Input sekali (jumlah keluar).
- **Detail (item tertentu pilihan Dok):** lacak stok gudang DAN stok poli terpisah; HPP baru saat benar-benar terpakai di poli. Untuk item bernilai besar / sering menumpuk di poli.
- Master data perlu kolom penanda metode ini. Default "Praktis"; Dok tandai item mana yang "Detail" kapan saja.

### Opname = pengecekan berkala (bukan sumber HPP utama lagi)
- Opname tetap ada untuk **verifikasi**: stok sistem cocok dengan fisik gudang.
- Untuk item "Detail", opname poli jadi penentu HPP yang lebih akurat.
- Rumus cek: `Selisih = Stok Sistem − Stok Fisik Opname` (idealnya 0; selisih = kebocoran/salah catat).

---

## 4. MASTER DATA (Sudah Tersedia)

File `Master_Persediaan_KLINIKTA.xlsx` berisi 123 item dalam 3 sheet. Kolom: Kode, Nama Item, Kategori Produk, Sub-Kategori, Satuan Stok, Isi/Kemasan, Harga Beli Acuan, Kategori Jual/Pakai Default.

| Kelompok | Jumlah | Kode | Sumber data | Perlakuan varian |
|---|---|---|---|---|
| BHP Gigi | 61 | BHPG-xxx (baru) | Spreadsheet manual (DI LUAR RME) | Dipisah per varian (komposit A1/A2/dst, paper point F1/F2/F3) |
| Obat | 27 | OBT00000xxx (dari RME) | RME | Pisah per nama obat |
| BHP Umum | 35 | BHP00000xxx (dari RME) | RME | Gabung per fungsi |

**Catatan penting tentang sumber data:**
- **BHP Gigi**: selama ini dikelola manual di spreadsheet terpisah karena staf opname gigi tidak terbiasa RME. **Tidak ada di RME, tidak punya kode RME.** Web app ini akan MENGGANTIKAN spreadsheet manual tersebut.
- **Obat & BHP Umum**: ada di RME dengan kode OBT/BHP. Jembatan sinkronisasi dengan RME pakai kunci **kode item**.
- Sub-kategori adalah atribut master (melekat ke item) — **staf tidak memilih sub-kategori saat input**; otomatis ikut saat item dipilih.

**Yang perlu dikoreksi Dok di master:** beberapa harga acuan janggal (Bonding Rp 890.000/botol terlihat tinggi; NaOCl/Pehacain/Depulp harga 0); sebagian satuan hasil tebakan (Surgical Blade, Bracket).

---

## 5. DESAIN WEB APP (Mockup Sudah Disetujui)

Referensi tampilan: `Mockup_WebApp_Inventory.html` (versi final, sudah disetujui Dok). Gaya bersih: tab mode lega, switcher 3 kelompok di atas (BHP Gigi/Umum/Obat), kolom "Stok Saat Ini" & "Pemakaian Hari Ini", urutan mode: Pemakaian Hari Ini → Stok Opname → Barang Masuk.

### Prinsip UX (dari kebutuhan riil staf)
- Staf catat **10+ item sekaligus** → WAJIB tampilan **grid/tabel isi cepat**, BUKAN form "tambah transaksi satu per satu".
- Dipakai di **HP dan laptop** → responsif: laptop = tabel lebar, HP = daftar dengan tombol +/− besar mudah disentuh.
- Item dikelompokkan per **sub-kategori** (Komposit, Endo, Ortho, dst).
- Badge status stok: aman / menipis / stok rendah (berdasarkan titik reorder per item).
- **Syarat keberhasilan:** harus LEBIH MUDAH dari spreadsheet manual yang dipakai staf gigi sekarang, kalau tidak mereka akan kembali ke cara lama.

### Tiga Mode (urutan baru)
1. **Pakai / Keluar Gudang (MODE UTAMA)** — grid isi cepat "ambil/pakai" saat barang keluar gudang → langsung HPP. Ini mode default yang dibuka pertama.
2. **Barang Masuk** — catat pembelian + harga/unit + supplier → tonjolkan nilai rupiah (tracking pengeluaran). Total otomatis → LAPKEU sebagai Persediaan.
3. **Opname** — cek stok fisik berkala (verifikasi + HPP akurat untuk item "Detail").

### Navigasi 3 Kelompok dengan Akses Lintas-Kelompok
- Kelompok: BHP Gigi (61) · BHP Umum (35) · Obat (27).
- Tiap staf default ke kelompoknya sendiri, TAPI bisa lihat/akses kelompok lain — supaya tidak input ganda untuk BHP yang sama. Tampilkan penanda "Anda pegang [kelompok]".
- Switcher kelompok di atas (pill button), filter sub-kategori di toolbar.

### Brand KLINIKTA
- Warna: navy `#29517F`, biru `#006EB6`, merah `#EE3338`
- Tagline: "Klinik Kita Semua"; arketipe Caregiver + Everyman; nada ramah, jelas, tidak kaku

---

## 6. ARSITEKTUR TEKNIS

### Stack (sama seperti web app absensi yang sudah ada)
```
Frontend:  React/JSX → Vercel
Backend:   Google Apps Script (GAS) sebagai API
Database:  Google Sheets (spreadsheet terpisah khusus inventory)
Storage:   Google Drive (folder terpisah, untuk foto faktur/bukti)
Versioning: GitHub (repo terpisah)
```

### ⚠️ PEMISAHAN TEGAS dari Web App Absensi (KRITIS)
Project absensi sudah ada. Inventory WAJIB pakai resource terpisah di lima titik — **tidak ada yang dibagi pakai** kecuali akun login Google/Vercel/GitHub:

| Komponen | Absensi (ADA) | Inventory (BARU) |
|---|---|---|
| Repo GitHub | repo absensi | **repo baru** |
| Project Vercel | project absensi | **project baru** |
| Spreadsheet DB | sheet absensi | **spreadsheet baru** |
| GAS deployment | script absensi | **script + deployment ID baru** |
| Folder Drive | folder absensi | **folder baru** |

### ⚠️ Pencegahan Konflik Multi-Account (Masalah yang Pernah Terjadi)
Akun Google inventory = SAMA dengan absensi. Konflik multi-account browser saat setup GAS bisa terulang. **Pencegahan:**
- Saat kerja GAS, login HANYA satu akun Google di browser, ATAU pakai profil browser khusus / incognito dengan satu akun.
- Catat dan simpan deployment ID GAS inventory terpisah dari absensi.

### Struktur Spreadsheet Database (usulan)
```
Spreadsheet "INVENTORY_KLINIKTA_DB":
  - master_item     : 123 item + atribut (dari Master_Persediaan)
  - transaksi_masuk : log pembelian diterima
  - transaksi_pakai : log pemakaian harian (pantauan)
  - opname          : hasil stok opname per periode (sumber HPP)
  - rekap_bulanan   : angka siap salin ke Akoontan (pembelian per kategori + HPP per kategori)
```

---

## 7. INTEGRASI KE AKOONTAN (Bertahap)

Implementasikan **bertahap**, jangan loncat ke otomasi penuh:

- **Level 1 (mulai di sini):** Web app hasilkan rekap → admin copy-paste manual ke Akoontan. Aman, ada mata manusia.
- **Level 1.5:** GAS tulis ke sheet staging Akoontan, admin approve 1 klik.
- **Level 2 (tujuan akhir):** GAS tulis otomatis ke sheet Pengeluaran/Pemasukan Akoontan, dengan **baris berwarna pembeda** (biru muda = pembelian/dari sistem; warna lain = HPP opname). Bendahara tetap bisa input manual baris lain; GAS hanya append baris baru, tidak menimpa. **Syarat masuk Level 2:** proses manual sudah mapan 2–3 bulan + data bersih + semua Aturan Main bagian 2 diterapkan di kode.

---

## 8. ROADMAP BUILD BERTAHAP

**Tahap 1 — Web App BHP Gigi (fondasi).** Grid isi cepat 61 item gigi, 3 mode, responsif HP/laptop, simpan ke Sheets. Belum sentuh Akoontan/RME. Tujuan: staf gigi nyaman pakai (uji pakai sungguhan sebelum lanjut).

**Tahap 2 — Modul Opname + hitung HPP.** Hitung pemakaian (awal + masuk − sisa fisik), generate angka HPP siap salin.

**Tahap 3 — Integrasi Akoontan (Level 1 → 1.5).** Output patuh Aturan Main bagian 2. Lalu tambah Obat & BHP Umum + jembatan RME (kunci = kode item).

**Tahap 4 — Otomasi penuh (Level 2)** setelah manual mapan.

---

## 9. KONTEKS BISNIS (Ringkas)

- **Usaha:** KLINIKTA (Klinik Kita Semua), PT Husni Ros Corpora (PT Perorangan), Kab. Bone, Sulsel. Layanan: gigi, umum, fisioterapi, bidan, homecare.
- **Akuntansi:** Akoontan V3.73 di Google Sheets — mesin formula ketat, jangan ketik manual di sheet laporan. Hanya edit: Pengeluaran, Pemasukan, Pembelian, Mutasi Rekening, Daftar Akun, Daftar Persediaan, Daftar Aset.
- **RME:** sistem rekam medis sendiri, TANPA API, hanya bisa export Excel/CSV.
- **Bahasa:** seluruh UI & komunikasi dalam Bahasa Indonesia.

---

## 10. PERINGATAN UNTUK CLAUDE CODE

1. **Jangan utak-atik formula laporan Akoontan.** Hanya tulis ke sheet input (Pembelian, Pemasukan) sesuai Aturan Main bagian 2.
2. **Uji setiap penulisan ke Akoontan dengan recalculation** sebelum dianggap benar — template ini punya banyak jebakan (baris perangkap, formula bergeser, sheet tersembunyi "Rekap | Persediaan" & "Rekap | HPP").
3. **localStorage TIDAK didukung** untuk multi-device — wajib pakai Sheets backend (pelajaran dari web app absensi).
4. **Mulai dari Tahap 1**, jangan bangun semua sekaligus. Mapankan dulu, baru lanjut.
5. **Verifikasi pemisahan resource** dari project absensi sebelum deploy apa pun.
