# Rencana Migrasi KLINIKTA Inventory → Firebase

Status: **rencana** (belum dieksekusi). Dibuat untuk ditinjau sebelum mulai.

Tujuan: hilangkan cold-start GAS (seringan absensi), tetap punya data realtime di
spreadsheet untuk akuntan/LAPKEU, dan **stack seragam dengan app absensi**.

> Rencana ini sudah disesuaikan dengan arsitektur nyata app absensi:
> **Realtime Database (RTDB), bukan Firestore**, dan **GAS sebagai "sink" laporan
> (bukan database)**. Konsekuensinya: **tidak perlu Cloud Functions, tidak perlu paket Blaze.**

---

## 1. Pola yang dipakai ulang dari absensi

- **RTDB** region `asia-southeast1`, **auth anonymous**, rules `{".read":"auth!=null",".write":"auth!=null"}`.
- `src/firebase.js`: `fbGet(key)`, `fbSet(key,value)`, `fbListen(key,cb)->unsub` + `toPath()`
  (key string `{app}_{entity}_{id}` → path RTDB). Tinggal jiplak dari absensi.
- **localStorage = cermin/cache saja**, bukan sumber kebenaran.
- **GAS = sink laporan**: app `fetch` ke GAS (`mode:'no-cors'`, `doPost`) untuk menulis baris
  ke Google Sheets + simpan file ke Drive. Jadi "realtime di spreadsheet" = **app menulis dua tempat**
  (RTDB sumber kebenaran, GAS mirror ke Sheets). **Tanpa Cloud Function, tanpa Blaze.**
- PWA service worker cache-first; `CACHE` di-bump tiap rilis.

---

## 2. Kenapa ini lebih ringan & lebih aman dari rencana awal

| Aspek | GAS sekarang | Setelah migrasi (RTDB) |
|---|---|---|
| Cold start | 2–4 dtk tiap "bangun" | tidak ada |
| Hitung stok | dihitung ulang dari SELURUH riwayat tiap load | angka stok hidup, baca node master saja |
| Realtime | tidak (perlu reload) | `fbListen`/onValue auto-update |
| Sheets utk akuntan | sumber utama | tetap, via double-write ke GAS-sink |
| Cloud Functions / Blaze | — | **tidak perlu** |

Inti percepatan: **stok jadi angka hidup** per item, di-update tiap transaksi pakai
RTDB `runTransaction` pada leaf-nya — bukan dihitung ulang dari awal.

---

## 3. Model data RTDB (di-nest agar baca murah)

```
klinikta_inv/master_item/{kode}            {nama, kelompok, kategoriProduk, subKategori,
                                            satuan, kemasan, hargaAcuan, kategoriDefault,
                                            metode, titikReorder, aktif,
                                            stok, stokUpdatedAt}   ← stok = angka hidup

klinikta_inv/pakai/{YYYY-MM}/{auto}        {tanggal, kode, nama, kelompok, jumlah, user, ts, catatan}
klinikta_inv/opname/{YYYY-MM}/{auto}       {tanggal, kode, nama, kelompok, stokSistem,
                                            stokFisik, selisih, user, ts, catatan}
klinikta_inv/belanja/{idBelanja}           {tanggalPesan, tanggalTerima, sumber, supplier, noVA,
                                            subtotal, pengiriman, diskonPengiriman, voucherShopee,
                                            voucherToko, biayaLayanan, totalNota, status,
                                            fotoUrl, fakturUrl,
                                            dipesanOleh, dibayarOleh, diterimaOleh, distokOleh,
                                            items:[ {baris, nama, qty, hargaSatuan, subtotalItem,
                                                     alokasiBiaya, hargaRiilTotal, hargaRiilUnit,
                                                     klasifikasi, kodeMaster, kelompok} ]}
klinikta_inv/antrian_aset/{auto}           {idBelanja, nama, tanggalTerima, hargaTotal, sumber,
                                            kategori, statusCatat}
klinikta_inv/klasifikasi_kw/{auto}         {klasifikasi, keyword}
klinikta_inv/users/{nama}                  {pin, peran, aktif}
```

`pakai`/`opname` di-nest per bulan (mengikuti pola `monthlyData` absensi) supaya:
- **getState** = baca node `master_item` (kecil, ~150) + `pakai/{bulan-ini}` (lalu filter tanggal hari ini). Murah.
- **getRekap** = baca `pakai/{bulan}`, `belanja`, `opname/{bulan}`, `antrian_aset` untuk 1 bulan. Tidak scan seluruh sejarah.

---

## 4. Logika stok hidup (bagian paling teliti)

Pakai **RTDB `runTransaction` pada leaf** `master_item/{kode}/stok` — **jangan** menimpa
seluruh node master (pelajaran merge-listener absensi: menimpa node utuh dgn state basi = data hilang).

- **savePakai** → tiap item: `runTransaction(stok, c => (c||0) - jumlah)` + push ke `pakai/{bulan}`.
- **finalizeBelanja** (status → *Masuk Stok*) → tiap item dipetakan: `stok += qty`
  (atau buat item master baru), set `belanja/{id}/status`, item Aset → `antrian_aset`.
- **saveOpname** → opname = kebenaran fisik: `selisih = stokFisik − stok`, lalu **set `stok = stokFisik`**.
  Ini sekaligus jaring pengaman jika stok pernah meleset.
- **updateBelanjaStatus** (Dipesan→Dibayar→Diterima) → hanya ubah field status + jejak; tidak menyentuh stok.

---

## 5. Lapisan API (perubahan frontend minimal)

`src/api.js` ditulis ulang pakai RTDB, **nama fungsi ekspor tetap sama**
(`getState`, `getUsers`, `savePakai`, `saveOpname`, `saveBelanja`, `updateBelanjaStatus`,
`finalizeBelanja`, `uploadFile`, `getRekap`, `getMasterAll`, `getSettings`, admin CRUD).
Jadi `Belanja.jsx`, `Admin.jsx`, Opname, Pakai, Rekap **nyaris tidak berubah**.

Tiap operasi tulis: (1) tulis RTDB (sumber kebenaran), lalu (2) `no-cors` POST ke GAS-sink
untuk mirror baris ke Sheets. Opsional: `fbListen` untuk auto-update → cache localStorage sekarang bisa dilepas.

Upload faktur/foto → base64 POST ke GAS → Drive (pola foto absensi), simpan URL ke node belanja.
Blob besar tidak ditaruh di RTDB.

---

## 6. Peran GAS berubah: dari "database" jadi "sink laporan"

GAS inventory sekarang menghitung & menyimpan (stok, rekap). Setelah migrasi:
- Perhitungan (stok, rekap) **pindah ke klien** (baca RTDB).
- GAS cukup **mencatat baris ke Sheets** + simpan file Drive — seperti absensi.
- Sheet & SS_ID yang sudah ada **dipakai ulang** (tinggal sederhanakan endpoint `doPost` jadi append-row).

---

## 7. Migrasi data lama (sekali jalan)

Skrip Node (`firebase-admin`, anon/SDK) untuk:
1. Baca isi sheet sekarang (master_item, transaksi_pakai, opname, belanja, item_belanja,
   antrian_aset, klasifikasi_kw, users).
2. Tulis ke RTDB sesuai model §3.
3. Hitung **`stok` awal** tiap item satu kali (pakai logika `getState_` lama), tulis ke `master_item`.
4. Verifikasi angka stok cocok dgn webapp lama **sebelum** cutover.

---

## 8. Tahapan eksekusi

1. **Setup** — buat (atau pakai) project Firebase akun hrcorpora.office@gmail.com,
   aktifkan RTDB `asia-southeast1` + Anonymous Auth + rules. Pasang `firebase`, isi env `VITE_FIREBASE_*`.
2. **`src/firebase.js`** — jiplak pola absensi (fbGet/fbSet/fbListen/toPath) utk key `klinikta_inv_*`.
3. **Tulis ulang `api.js`** dgn RTDB (nama fungsi tetap) + double-write ke GAS-sink.
4. **Stok hidup** — savePakai/finalize/opname pakai `runTransaction`. (paling teliti)
5. **Upload** faktur/foto → GAS→Drive, URL ke node belanja.
6. **Sederhanakan GAS** jadi sink append-row (pakai SS_ID & sheet yang ada).
7. **Skrip migrasi data** + verifikasi stok.
8. **Uji tiap alur**: pakai, opname, belanja 4 status, finalisasi, rekap, admin.
9. **Cutover** — ganti config (lepas `VITE_GAS_URL` sbg DB, pakai Firebase), deploy Vercel.

GAS lama bisa disimpan baca-saja sbg cadangan selama transisi.

---

## 9. Risiko & catatan jujur

- **Bukan tempelan kecil** — lapisan data dibangun ulang. Tapi UI aman karena `api.js` jadi sekat.
- **Disiplin merge-listener** wajib: stok via `runTransaction` pada leaf, jangan timpa node utuh;
  log harian append. (Pelajaran mahal dari absensi — data pernah hilang karena ini.)
- **Stok hidup harus benar** — opname jadi reset kebenaran berkala (jaring pengaman).
- **Verifikasi migrasi** angka stok sebelum berhenti pakai GAS.
- **Tidak perlu Blaze / Cloud Functions** — RTDB free tier + GAS gratis cukup.

---

## Yang masih perlu dari Anda

1. ✅ ~~Cara absensi sync ke Sheets~~ — **terjawab**: app double-write + GAS-sink no-cors.
2. ✅ ~~Perlu Blaze?~~ — **tidak**, pakai RTDB + GAS gratis.
3. **Lampu hijau** mulai Tahap 1. Sekalian: pakai **project Firebase yang sama dengan absensi**
   (path `klinikta_inv/*` dipisah) atau **project Firebase baru** khusus inventory?
