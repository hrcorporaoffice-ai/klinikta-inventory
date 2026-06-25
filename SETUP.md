# SETUP — KLINIKTA Inventory (Tahap 1)

Panduan klik-demi-klik untuk menyalakan web app. Langkah backend (Sheet, GAS, Drive)
butuh login akun Google Anda; langkah deploy butuh akun GitHub & Vercel. Semua
**resource dibuat baru, terpisah dari project absensi**.

---

## ⚠️ SEBELUM MULAI — Akun & Pencegahan Konflik Multi-Account
**Akun resmi semua resource project ini: `hrcorpora.office@gmail.com`**
(GitHub, Vercel, Spreadsheet, GAS, Drive — semua pakai akun ini).

Konflik multi-account browser pernah terjadi waktu setup GAS absensi. Cegah dengan
salah satu cara:
- Login **HANYA `hrcorpora.office@gmail.com`** di browser selama kerja GAS, **atau**
- Pakai **profil browser khusus** / jendela **incognito** dengan akun itu saja.

Pastikan saat Run `setup()` dan Deploy, akun yang aktif adalah `hrcorpora.office@gmail.com`,
bukan akun lain.

Catat semua ID inventory di tabel paling bawah dokumen ini, terpisah dari absensi.

---

## Langkah 1 — Buat Spreadsheet Database (BARU)
1. Buka <https://sheets.google.com> → **Blank spreadsheet**.
2. Beri nama: **`INVENTORY_KLINIKTA_DB`** (bukan sheet absensi).
3. Biarkan terbuka untuk langkah berikutnya.

## Langkah 2 — Pasang & Jalankan Backend GAS
1. Di spreadsheet itu: menu **Extensions → Apps Script**.
2. Hapus isi `Code.gs` bawaan. Tempel isi file [`gas/Code.gs`](gas/Code.gs).
3. **File → + → Script**, beri nama `master_seed`, tempel isi [`gas/master_seed.gs`](gas/master_seed.gs).
   *(Opsional)* sesuaikan `appsscript.json` lewat ⚙ Project Settings → "Show appsscript.json".
4. Pilih fungsi **`setup`** di dropdown atas → klik **Run**.
   - Saat diminta izin: **Review permissions** → pilih akun → Allow.
   - Selesai: sheet `master_item`, `transaksi_masuk`, `transaksi_pakai`, `opname`,
     `rekap_bulanan` terisi, dan folder Drive `INVENTORY_KLINIKTA_Bukti` dibuat.
   - Cek tab **Execution log** muncul `Setup selesai`.

### Atur Staf & PIN (penting untuk log "siapa input")
Setelah `setup()`, buka sheet **`users`**. Sudah terisi contoh
(`Staf Gigi/1111`, `Staf Umum/2222`, `Staf Obat/3333`, `Admin/0000`).
**Ganti** kolom `nama` & `pin` sesuai staf asli KLINIKTA:
| nama | pin | kelompok | aktif |
|---|---|---|---|
| (nama staf) | (4 digit) | BHP Gigi / BHP Umum / Obat | TRUE |

Saat staf login di app, nama mereka otomatis ikut tercatat di setiap baris
`transaksi_pakai` / `transaksi_masuk` / `opname` (kolom `user` + `timestamp` jam),
sehingga di spreadsheet kelihatan **siapa input apa, kapan**. Untuk menonaktifkan
staf: set `aktif` = FALSE (jangan dihapus, agar log lama tetap utuh).

## Langkah 3 — Deploy GAS sebagai Web App
1. Tombol **Deploy → New deployment**.
2. ⚙ (gear) → pilih tipe **Web app**.
3. Isi:
   - **Description:** `inventory v1`
   - **Execute as:** *Me*
   - **Who has access:** *Anyone*  ← penting agar frontend bisa akses.
4. **Deploy** → Authorize jika diminta → **salin Web app URL**
   (bentuknya `https://script.google.com/macros/s/.../exec`).
5. **Catat Deployment ID** (di layar Deploy → Manage deployments) — simpan terpisah dari absensi.
6. Uji cepat: buka `URL?action=ping` di browser → harus muncul
   `{"ok":true,"service":"klinikta-inventory","version":1}`.

> Setiap kali Code.gs diubah, **Deploy → Manage deployments → Edit (pensil) →
> Version: New version → Deploy**. URL tetap sama. (Jangan "New deployment" tiap kali,
> nanti URL berubah.)

## Langkah 4 — Jalankan Frontend Lokal (uji dulu)
```bash
npm install
cp .env.example .env
```
Edit `.env`, isi `VITE_GAS_URL` dengan Web App URL dari Langkah 3, lalu:
```bash
npm run dev
```
Buka alamat yang ditampilkan (mis. http://localhost:5173). Coba isi pemakaian → Simpan →
cek baris masuk di sheet `transaksi_pakai`.

## Langkah 5 — Repo GitHub (BARU, terpisah)
```bash
git add -A
git commit -m "Tahap 1: web app inventory BHP Gigi"
```
Buat repo baru kosong di <https://github.com/new> (mis. `klinikta-inventory`,
**bukan** repo absensi), lalu:
```bash
git remote add origin https://github.com/<user>/klinikta-inventory.git
git branch -M main
git push -u origin main
```

## Langkah 6 — Deploy ke Vercel (project BARU)
1. <https://vercel.com/new> → **Import** repo `klinikta-inventory` (project baru, bukan absensi).
2. Framework otomatis terdeteksi **Vite** (sudah ada `vercel.json`).
3. **Environment Variables** → tambahkan:
   - Name: `VITE_GAS_URL` — Value: Web App URL dari Langkah 3.
4. **Deploy**. Setelah selesai, buka URL Vercel di HP & laptop untuk uji nyata.

---

## Verifikasi Pemisahan dari Absensi (WAJIB sebelum dipakai)
Centang semua sebelum dianggap selesai:
- [ ] Repo GitHub berbeda dari absensi
- [ ] Project Vercel berbeda dari absensi
- [ ] Spreadsheet `INVENTORY_KLINIKTA_DB` berbeda dari sheet absensi
- [ ] Deployment GAS + Deployment ID berbeda dari absensi
- [ ] Folder Drive `INVENTORY_KLINIKTA_Bukti` berbeda dari folder absensi

## Catatan ID Inventory (isi & simpan)
| Item | Nilai |
|---|---|
| Spreadsheet ID | |
| GAS Deployment ID | |
| Web App URL | |
| Drive Folder ID | |
| GitHub repo | |
| Vercel project | |

---

## Catatan teknis
- **CORS:** frontend membaca via GET dan menulis via POST `text/plain` (menghindari
  preflight yang tidak didukung web app GAS). Sudah ditangani di `src/api.js`.
- **Stok dihitung server:** `transaksi_masuk − transaksi_pakai`; bila ada opname,
  pakai stok fisik opname terakhir sebagai baseline.
- **Item "Detail":** di sheet `master_item` kolom `metode`, ubah dari `Praktis`
  ke `Detail` untuk item yang dilacak terpisah (badge DETAIL muncul di UI).
- **Titik reorder:** kolom `titikReorder` di `master_item`. Kosong = badge selalu "aman".
  Isi angka → otomatis badge "stok rendah"/"menipis".
