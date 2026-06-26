/**
 * KLINIKTA Inventory — Backend Google Apps Script (Tahap 1)
 * ----------------------------------------------------------------------------
 * Sub-ledger persediaan KLINIKTA. TERPISAH PENUH dari project absensi:
 * script ini, spreadsheet-nya, dan folder Drive-nya semua milik project inventory.
 *
 * Cara pakai pertama kali:
 *   1. Buat Google Sheet BARU kosong (mis. beri nama "INVENTORY_KLINIKTA_DB").
 *   2. Extensions > Apps Script. Tempel Code.gs DAN master_seed.gs ke editor.
 *   3. Jalankan fungsi setup() sekali (pilih setup di dropdown > Run, beri izin).
 *      -> Membuat semua sheet, mengisi 123 master item, dan membuat folder Drive.
 *   4. Deploy > New deployment > Web app:
 *        - Execute as: Me
 *        - Who has access: Anyone
 *      Salin "Web app URL" -> taruh di .env frontend sebagai VITE_GAS_URL.
 *
 * Catatan Tahap 1: belum menyentuh Akoontan/RME. Fokus: pakai (keluar gudang),
 * barang masuk, opname, dan sisa stok. Lihat SPEK_TEKNIS bagian 8.
 *
 * CORS: web app GAS tidak mengirim header CORS untuk POST application/json
 * (kena preflight). Maka frontend mengirim POST dengan Content-Type text/plain
 * dan body JSON; dibaca via e.postData.contents. GET dipakai untuk membaca.
 */

// === Konfigurasi nama sheet (jangan diubah sembarangan) ===
var SHEETS = {
  master: 'master_item',
  pakai: 'transaksi_pakai',
  opname: 'opname',
  belanja: 'transaksi_belanja',     // satu baris per nota/pesanan
  itemBelanja: 'item_belanja',      // detail item per nota (many-to-one)
  antrianAset: 'antrian_aset',      // barang Aset yang belum dicatat ke Akoontan
  klasifikasiKw: 'klasifikasi_kw',  // kata kunci tebakan klasifikasi (dikelola admin)
  rekap: 'rekap_bulanan',
  users: 'users',
};

// Status nota belanja, berurutan. Lihat alur peran di updateBelanjaStatus_/finalizeBelanja_.
var STATUS_FLOW = ['Dipesan', 'Dibayar', 'Diterima', 'Masuk Stok'];
// Kelompok yang dihitung sebagai Persediaan (aset lancar) di rekap LAPKEU.
var KELOMPOK_PERSEDIAAN = { 'BHP Gigi': true, 'BHP Umum': true, 'Obat': true };
// Semua kelompok stok yang valid sebagai tujuan saat "Masuk Stok".
var KELOMPOK_STOK = ['BHP Gigi', 'BHP Umum', 'Obat', 'Alkes'];
// Prefix kode item master baru per kelompok (untuk tambah item saat finalisasi).
var KODE_PREFIX = { 'BHP Gigi': 'BHPG-', 'BHP Umum': 'BHPU-', 'Obat': 'OBT-', 'Alkes': 'ALK-' };

var DRIVE_FOLDER_NAME = 'INVENTORY_KLINIKTA_Bukti'; // folder bukti faktur/foto (Drive terpisah)
var PROP_FOLDER_ID = 'INVENTORY_DRIVE_FOLDER_ID';

// Header tiap sheet (urutan kolom = sumber kebenaran).
var HEADERS = {
  master: ['kode', 'nama', 'kelompok', 'kategoriProduk', 'subKategori', 'satuan',
           'kemasan', 'hargaAcuan', 'kategoriDefault', 'metode', 'titikReorder', 'aktif'],
  pakai:  ['timestamp', 'tanggal', 'kelompok', 'kode', 'nama', 'jumlah', 'user', 'catatan'],
  opname: ['timestamp', 'tanggal', 'kelompok', 'kode', 'nama', 'stokSistem',
           'stokFisik', 'selisih', 'user', 'catatan'],
  belanja: ['idBelanja', 'timestamp', 'tanggalPesan', 'tanggalTerima', 'sumber', 'supplier',
            'noVA', 'subtotal', 'pengiriman', 'diskonPengiriman', 'voucherShopee', 'voucherToko',
            'biayaLayanan', 'totalNota', 'status', 'fotoUrl', 'fakturUrl',
            'dipesanOleh', 'dibayarOleh', 'diterimaOleh', 'distokOleh', 'catatan'],
  itemBelanja: ['idBelanja', 'baris', 'nama', 'qty', 'hargaSatuan', 'subtotalItem',
                'alokasiBiaya', 'hargaRiilTotal', 'hargaRiilUnit',
                'klasifikasi', 'kodeMaster', 'kelompok'],
  antrianAset: ['idAset', 'timestamp', 'idBelanja', 'nama', 'tanggalTerima', 'hargaTotal',
                'sumber', 'kategori', 'statusCatat'],
  klasifikasiKw: ['klasifikasi', 'keyword'],
  rekap:  ['periode', 'kelompok', 'totalPembelian', 'totalHpp', 'dibuat'],
  users:  ['nama', 'pin', 'kelompok', 'peran', 'aktif'],
};

// Staf contoh — GANTI nama, PIN & peran ini di sheet "users" sesuai staf asli KLINIKTA.
// Peran: admin | bendahara | penerima | logistik | staf.
// Peran: admin | bendahara | penerima | logistik (logistik = pesan + terima + masuk stok).
// Tidak ada peran 'staf' — semua staf setidaknya logistik.
var USERS_SEED = [
  ['Admin',      '0000', '', 'admin',     true],
  ['Bendahara',  '2025', '', 'bendahara', true],
  ['Penerima',   '2026', '', 'penerima',  true],
  ['Logistik',   '2027', '', 'logistik',  true],
];

// Kata kunci tebakan klasifikasi awal (dikelola admin di sheet klasifikasi_kw).
var KW_SEED = [
  ['Aset', 'scaler'], ['Aset', 'light cure'], ['Aset', 'curing'], ['Aset', 'dental unit'],
  ['Aset', 'kompresor'], ['Aset', 'compressor'], ['Aset', 'autoclave'], ['Aset', 'sterilisator'],
  ['Aset', 'apex locator'], ['Aset', 'micromotor'], ['Aset', 'contra angle'], ['Aset', 'handpiece'],
  ['Aset', 'rontgen'], ['Aset', 'x-ray'], ['Aset', 'endomotor'], ['Aset', 'nebulizer'], ['Aset', 'kursi'],
  ['Alkes', 'pinset'], ['Alkes', 'sonde'], ['Alkes', 'ekskavator'], ['Alkes', 'kaca mulut'],
  ['Alkes', 'tang'], ['Alkes', 'forceps'], ['Alkes', 'bur set'], ['Alkes', 'elevator'], ['Alkes', 'kuret'],
  ['Alkes', 'gunting'], ['Alkes', 'needle holder'], ['Alkes', 'retractor'], ['Alkes', 'spatula'],
  ['Obat', 'amoxicillin'], ['Obat', 'paracetamol'], ['Obat', 'ibuprofen'], ['Obat', 'metronidazole'],
  ['Obat', 'cefadroxil'], ['Obat', 'dexamethasone'], ['Obat', 'ranitidine'], ['Obat', 'injeksi'],
  ['Obat', 'tablet'], ['Obat', 'kapsul'], ['Obat', 'ampul'], ['Obat', 'vial'], ['Obat', 'obat'],
];

// ----------------------------------------------------------------------------
// SETUP — jalankan sekali secara manual dari editor Apps Script
// ----------------------------------------------------------------------------
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Buka script ini dari dalam Google Sheet (Extensions > Apps Script).');

  // Idempoten: aman dijalankan ulang. Hanya tulis baris header; TIDAK menghapus data
  // yang sudah ada (mis. staf/master yang sudah diedit Dok).
  Object.keys(SHEETS).forEach(function (key) {
    var name = SHEETS[key];
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var header = HEADERS[key];
    sh.getRange(1, 1, 1, header.length).setValues([header])
      .setFontWeight('bold').setBackground('#29517F').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });

  seedMaster_(ss);
  seedUsers_(ss);
  seedKeywords_(ss);
  ensureDriveFolder_();

  // Hapus sheet default "Sheet1" jika masih kosong/ada.
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Sheet 1');
  if (def && ss.getSheets().length > 1) {
    try { ss.deleteSheet(def); } catch (e) {}
  }

  SpreadsheetApp.flush();
  Logger.log('Setup selesai. Spreadsheet: %s', ss.getUrl());
}

function seedMaster_(ss) {
  if (typeof MASTER_SEED === 'undefined') {
    throw new Error('master_seed.gs belum ditempel. Tambahkan file itu lalu jalankan setup() lagi.');
  }
  var sh = ss.getSheetByName(SHEETS.master);
  if (sh.getLastRow() > 1) return; // sudah terisi, jangan timpa
  var rows = MASTER_SEED.map(function (it) {
    return [it.kode, it.nama, it.kelompok, it.kategoriProduk, it.subKategori,
            it.satuan, it.kemasan, it.hargaAcuan, it.kategoriDefault,
            'Praktis', '', true];  // metode default Praktis, titikReorder kosong, aktif
  });
  if (rows.length) {
    sh.getRange(2, 1, rows.length, HEADERS.master.length).setValues(rows);
  }
}

function seedUsers_(ss) {
  var sh = ss.getSheetByName(SHEETS.users);
  // Hanya seed bila masih kosong, supaya tidak menimpa staf yang sudah diedit.
  if (sh.getLastRow() > 1) return;
  sh.getRange(2, 1, USERS_SEED.length, HEADERS.users.length).setValues(USERS_SEED);
}

function seedKeywords_(ss) {
  var sh = ss.getSheetByName(SHEETS.klasifikasiKw);
  if (sh.getLastRow() > 1) return;
  sh.getRange(2, 1, KW_SEED.length, HEADERS.klasifikasiKw.length).setValues(KW_SEED);
}

function ensureDriveFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_FOLDER_ID);
  if (id) {
    try { DriveApp.getFolderById(id); return id; } catch (e) { /* hilang, buat ulang */ }
  }
  var folder = DriveApp.createFolder(DRIVE_FOLDER_NAME);
  props.setProperty(PROP_FOLDER_ID, folder.getId());
  return folder.getId();
}

// ----------------------------------------------------------------------------
// API
// ----------------------------------------------------------------------------
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'getState';
  try {
    if (action === 'ping') return json_({ ok: true, service: 'klinikta-inventory', version: 1 });
    if (action === 'getUsers') return json_({ ok: true, data: listUsers_() });
    if (action === 'getState') {
      return json_({ ok: true, data: getState_(e.parameter.kelompok || null, e.parameter.tanggal || null) });
    }
    if (action === 'getBelanja') {
      return json_({ ok: true, data: getBelanja_(e.parameter.periode || null) });
    }
    if (action === 'getRekap') {
      return json_({ ok: true, data: getRekap_(e.parameter.periode || null) });
    }
    if (action === 'getSettings') return json_({ ok: true, data: getSettings_() });
    if (action === 'getMasterAll') return json_({ ok: true, data: getMasterAll_() });
    return json_({ ok: false, error: 'Action GET tidak dikenal: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Body bukan JSON valid.' });
  }
  var action = body.action;

  // Login tidak butuh lock (hanya baca + verifikasi PIN).
  if (action === 'login') {
    try {
      return json_({ ok: true, data: login_(body.nama, body.pin) });
    } catch (err) {
      return json_({ ok: false, error: String(err && err.message || err) });
    }
  }

  // MIRROR (RTDB = sumber kebenaran; ini hanya menyalin ke Sheets sbg log/cadangan).
  // Dikirim app dengan fetch mode 'no-cors' (fire-and-forget), tidak butuh user.
  if (action && action.indexOf('mirror_') === 0) {
    var lkm = LockService.getScriptLock();
    try {
      lkm.waitLock(20000);
      var rm;
      switch (action) {
        case 'mirror_pakai':   rm = mirrorAppend_(SHEETS.pakai, body.rows); break;
        case 'mirror_opname':  rm = mirrorAppend_(SHEETS.opname, body.rows); break;
        case 'mirror_belanja': rm = mirrorBelanja_(body.nota, body.items); break;
        case 'mirror_antrian': rm = mirrorUpsert_(SHEETS.antrianAset, 'idAset', body.rows); break;
        default: return json_({ ok: false, error: 'Mirror tak dikenal: ' + action });
      }
      return json_({ ok: true, data: rm });
    } catch (errm) {
      return json_({ ok: false, error: String(errm && errm.message || errm) });
    } finally { try { lkm.releaseLock(); } catch (e3) {} }
  }

  // Tulis wajib menyertakan nama staf yang sudah login.
  if (!body.user) return json_({ ok: false, error: 'Belum login: nama staf wajib ada.' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // cegah tulisan bersamaan dari banyak HP
    var result;
    switch (action) {
      case 'savePakai':           result = saveLines_(SHEETS.pakai, body); break;
      case 'saveOpname':          result = saveLines_(SHEETS.opname, body); break;
      case 'saveBelanja':         result = saveBelanja_(body); break;
      case 'updateBelanjaStatus': result = updateBelanjaStatus_(body); break;
      case 'finalizeBelanja':     result = finalizeBelanja_(body); break;
      case 'uploadFile':          result = uploadFile_(body); break;
      case 'updateAntrianAset':   result = updateAntrianAset_(body); break;
      // Admin only:
      case 'saveMaster':          result = adminSaveMaster_(body); break;
      case 'saveUser':            result = adminSaveUser_(body); break;
      case 'saveKeyword':         result = adminSaveKeyword_(body); break;
      case 'deleteKeyword':       result = adminDeleteKeyword_(body); break;
      default: return json_({ ok: false, error: 'Action POST tidak dikenal: ' + action });
    }
    return json_({ ok: true, data: result });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// ----------------------------------------------------------------------------
// USERS: daftar staf + login PIN ringan
// ----------------------------------------------------------------------------
function listUsers_() {
  return readSheet_(SHEETS.users)
    .filter(function (u) { return u.nama && u.aktif !== false && String(u.aktif) !== 'false'; })
    .map(function (u) { return { nama: String(u.nama), kelompok: u.kelompok || 'BHP Gigi', peran: u.peran || 'staf' }; });
}

function login_(nama, pin) {
  if (!nama || pin == null || pin === '') throw new Error('Nama dan PIN wajib diisi.');
  var rows = readSheet_(SHEETS.users);
  var found = null;
  rows.forEach(function (u) {
    if (String(u.nama) === String(nama) && u.aktif !== false && String(u.aktif) !== 'false') found = u;
  });
  if (!found) throw new Error('Staf tidak ditemukan / tidak aktif.');
  if (String(found.pin) !== String(pin)) throw new Error('PIN salah.');
  return { nama: String(found.nama), kelompok: found.kelompok || 'BHP Gigi', peran: found.peran || 'staf' };
}

// Peran staf (tepercaya, dibaca dari sheet users — bukan dari klien) untuk enforcement.
// Mengembalikan ARRAY peran (satu akun bisa punya beberapa peran, mis. ['logistik','staf']).
function peranOf_(nama) {
  var raw = 'staf';
  readSheet_(SHEETS.users).forEach(function (u) { if (String(u.nama) === String(nama)) raw = u.peran || 'staf'; });
  return String(raw).split(',').map(function(r) { return r.trim(); }).filter(Boolean);
}
// Lempar error bila tidak ada satupun peran user yang termasuk yang diizinkan (admin selalu boleh).
function requireRole_(nama, allowed) {
  var roles = peranOf_(nama);
  if (roles.indexOf('admin') >= 0) return roles.join(',');
  var ok = allowed.some(function(a) { return roles.indexOf(a) >= 0; });
  if (!ok) {
    throw new Error('Akses ditolak: butuh peran ' + allowed.join('/') + ' atau admin. Peran Anda: ' + roles.join(',') + '.');
  }
  return roles.join(',');
}

// ----------------------------------------------------------------------------
// READ: master + stok terhitung + pemakaian hari ini
// ----------------------------------------------------------------------------
function getState_(kelompok, tanggal) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var today = tanggal || todayStr_();

  var master = readSheet_(SHEETS.master);
  // "Barang masuk" kini berasal dari item_belanja pada nota berstatus "Diterima"
  // (menggantikan transaksi_masuk). Tiap baris: {kode, jumlah, tanggal}.
  var masuk = receivedMasuk_();
  var pakai = readSheet_(SHEETS.pakai);
  var opname = readSheet_(SHEETS.opname);

  // Akumulasi per kode.
  var masukByKode = sumBy_(masuk, 'kode', 'jumlah');
  var pakaiByKode = sumBy_(pakai, 'kode', 'jumlah');

  // Opname terakhir per kode (stok fisik) jadi titik baseline.
  var lastOpname = {};       // kode -> {tanggal, stokFisik}
  opname.forEach(function (r) {
    var k = r.kode;
    if (!k) return;
    if (!lastOpname[k] || String(r.tanggal) >= String(lastOpname[k].tanggal)) {
      lastOpname[k] = { tanggal: r.tanggal, stokFisik: num_(r.stokFisik) };
    }
  });

  // Pemakaian hari ini per kode.
  var pakaiTodayByKode = {};
  pakai.forEach(function (r) {
    if (fmtDate_(r.tanggal) === today) {
      pakaiTodayByKode[r.kode] = (pakaiTodayByKode[r.kode] || 0) + num_(r.jumlah);
    }
  });

  var items = master.filter(function (m) {
    if (kelompok && m.kelompok !== kelompok) return false;
    return m.aktif !== false && String(m.aktif) !== 'false';
  }).map(function (m) {
    var k = m.kode;
    var stok;
    if (lastOpname[k]) {
      // Stok = opname fisik terakhir + masuk sesudahnya - pakai sesudahnya.
      var since = lastOpname[k].tanggal;
      stok = lastOpname[k].stokFisik
        + sumSince_(masuk, k, since) - sumSince_(pakai, k, since);
    } else {
      stok = (masukByKode[k] || 0) - (pakaiByKode[k] || 0);
    }
    var reorder = num_(m.titikReorder);
    return {
      kode: k, nama: m.nama, kelompok: m.kelompok,
      kategoriProduk: m.kategoriProduk, subKategori: m.subKategori,
      satuan: m.satuan, kemasan: m.kemasan,
      hargaAcuan: num_(m.hargaAcuan), kategoriDefault: m.kategoriDefault,
      metode: m.metode || 'Praktis', titikReorder: reorder,
      stok: stok,
      pakaiHariIni: pakaiTodayByKode[k] || 0,
      status: stockStatus_(stok, reorder),
    };
  });

  return {
    tanggal: today,
    kelompok: kelompok,
    counts: groupCounts_(master),
    items: items,
  };
}

function stockStatus_(stok, reorder) {
  // Tanpa titik reorder, anggap aman (Tahap 1: belum semua item punya reorder).
  if (!reorder || reorder <= 0) return 'aman';
  if (stok <= reorder) return 'low';        // stok rendah
  if (stok <= reorder * 2) return 'menipis';
  return 'aman';
}

// ----------------------------------------------------------------------------
// WRITE: append baris pemakaian / masuk / opname
// ----------------------------------------------------------------------------
function saveLines_(sheetName, body) {
  var lines = body.lines || [];
  if (!lines.length) throw new Error('Tidak ada baris untuk disimpan.');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet belum ada: ' + sheetName + '. Jalankan setup() dulu.');

  var masterByKode = indexBy_(readSheet_(SHEETS.master), 'kode');
  var ts = new Date();
  var tanggal = body.tanggal || todayStr_();
  var user = body.user || '';
  var rows = [];

  lines.forEach(function (ln) {
    var m = masterByKode[ln.kode];
    if (!m) throw new Error('Kode tidak ada di master: ' + ln.kode);
    var nama = m.nama;
    var kelompok = m.kelompok;

    if (sheetName === SHEETS.pakai) {
      var qty = num_(ln.qty);
      if (qty <= 0) return;
      rows.push([ts, tanggal, kelompok, ln.kode, nama, qty, user, ln.catatan || '']);
    } else if (sheetName === SHEETS.opname) {
      // stokFisik wajib; stokSistem & selisih dihitung server.
      if (ln.stokFisik === '' || ln.stokFisik == null) return;
      var fisik = num_(ln.stokFisik);
      var state = getState_(kelompok, tanggal);
      var sysItem = state.items.filter(function (i) { return i.kode === ln.kode; })[0];
      var sistem = sysItem ? sysItem.stok : 0;
      rows.push([ts, tanggal, kelompok, ln.kode, nama, sistem, fisik, fisik - sistem,
                 user, ln.catatan || '']);
    }
  });

  if (!rows.length) throw new Error('Tidak ada baris valid (semua kosong/nol).');
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  SpreadsheetApp.flush();
  return { tersimpan: rows.length, tanggal: tanggal };
}

// ----------------------------------------------------------------------------
// BELANJA & TERIMA
// ----------------------------------------------------------------------------

// Baris "barang masuk" dari item_belanja pada nota berstatus "Masuk Stok" yang
// sudah dipetakan ke master (kodeMaster). Stok bertambah hanya setelah finalisasi logistik.
function receivedMasuk_() {
  var belanja = readSheet_(SHEETS.belanja);
  var info = {};
  belanja.forEach(function (b) {
    if (b.idBelanja) info[b.idBelanja] = { status: String(b.status), tanggalTerima: b.tanggalTerima };
  });
  var out = [];
  readSheet_(SHEETS.itemBelanja).forEach(function (it) {
    var parent = info[it.idBelanja];
    if (!parent || parent.status !== 'Masuk Stok' || !it.kodeMaster) return;
    out.push({ kode: it.kodeMaster, jumlah: num_(it.qty), tanggal: fmtDate_(parent.tanggalTerima) });
  });
  return out;
}

// Harga beli rata-rata tertimbang per kode (Aturan 6), dari item yang sudah masuk stok.
function avgCostByKode_() {
  var belanja = readSheet_(SHEETS.belanja);
  var recv = {};
  belanja.forEach(function (b) { if (b.idBelanja && String(b.status) === 'Masuk Stok') recv[b.idBelanja] = true; });
  var qty = {}, val = {};
  readSheet_(SHEETS.itemBelanja).forEach(function (it) {
    if (!recv[it.idBelanja] || !it.kodeMaster) return;
    qty[it.kodeMaster] = (qty[it.kodeMaster] || 0) + num_(it.qty);
    val[it.kodeMaster] = (val[it.kodeMaster] || 0) + num_(it.hargaRiilTotal);
  });
  var avg = {};
  Object.keys(qty).forEach(function (k) { if (qty[k] > 0) avg[k] = val[k] / qty[k]; });
  return avg;
}

// Simpan satu nota + itemnya. Status awal SELALU "Dipesan". Item hanya nama/qty/harga;
// klasifikasi & pemetaan master diisi nanti saat finalisasi (logistik).
// Biaya tambahan (pengiriman, diskon pengiriman, voucher Shopee/Toko, biaya layanan)
// digabung jadi netBiaya lalu dialokasikan proporsional ke nilai tiap item (Aturan 6).
function saveBelanja_(body) {
  var nota = body.nota || {};
  var items = body.items || [];
  if (!items.length) throw new Error('Tidak ada item belanja.');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shB = ss.getSheetByName(SHEETS.belanja);
  var shI = ss.getSheetByName(SHEETS.itemBelanja);
  if (!shB || !shI) throw new Error('Sheet belanja belum ada. Jalankan setup() lagi.');

  var pengiriman = num_(nota.pengiriman), diskonPengiriman = num_(nota.diskonPengiriman);
  var voucherShopee = num_(nota.voucherShopee), voucherToko = num_(nota.voucherToko);
  var biayaLayanan = num_(nota.biayaLayanan);

  var sumSub = 0;
  items.forEach(function (it) { sumSub += num_(it.qty) * num_(it.hargaSatuan); });
  if (sumSub <= 0) throw new Error('Subtotal item harus lebih dari 0.');

  // Penambah (pengiriman, biaya layanan) − pengurang (diskon pengiriman, voucher).
  var netBiaya = pengiriman + biayaLayanan - diskonPengiriman - voucherShopee - voucherToko;
  var totalNota = sumSub + netBiaya;
  var tglPesan = nota.tanggalPesan || todayStr_();
  var id = 'BLJ' + (new Date()).getTime();
  var ts = new Date();

  shB.appendRow([id, ts, tglPesan, '', nota.sumber || '', nota.supplier || '', nota.noVA || '',
                 sumSub, pengiriman, diskonPengiriman, voucherShopee, voucherToko, biayaLayanan,
                 totalNota, 'Dipesan', '', '', body.user || '', '', '', '', nota.catatan || '']);

  var rows = [], baris = 0;
  items.forEach(function (it) {
    baris++;
    var q = num_(it.qty), h = num_(it.hargaSatuan);
    var sub = q * h;
    var prop = sumSub > 0 ? sub / sumSub : 0;
    var aBiaya = netBiaya * prop;
    var riilTotal = sub + aBiaya;
    var riilUnit = q > 0 ? riilTotal / q : 0;
    // klasifikasi/kodeMaster/kelompok dikosongkan — diisi saat finalisasi.
    rows.push([id, baris, it.nama || '', q, h, sub, aBiaya, riilTotal, riilUnit, '', '', '']);
  });
  shI.getRange(shI.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

  SpreadsheetApp.flush();
  return { idBelanja: id, totalNota: totalNota, items: rows.length, status: 'Dipesan' };
}

// Masukkan item ber-klasifikasi Aset (status Diterima) ke antrian_aset, hindari duplikat.
function queueAssets_(idBelanja) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var nota = indexBy_(readSheet_(SHEETS.belanja), 'idBelanja')[idBelanja];
  if (!nota) return;
  var items = readSheet_(SHEETS.itemBelanja).filter(function (it) {
    return it.idBelanja === idBelanja && String(it.klasifikasi) === 'Aset';
  });
  if (!items.length) return;

  var shA = ss.getSheetByName(SHEETS.antrianAset);
  var existing = {};
  readSheet_(SHEETS.antrianAset).forEach(function (a) {
    if (a.idBelanja === idBelanja) existing[String(a.nama)] = true;
  });
  var ts = new Date(), rows = [];
  items.forEach(function (it) {
    if (existing[String(it.nama)]) return;
    var aid = 'AST' + (new Date()).getTime() + '-' + baris3_(rows.length);
    rows.push([aid, ts, idBelanja, it.nama, nota.tanggalTerima || todayStr_(),
               num_(it.hargaRiilTotal), nota.sumber || '', 'Aset', 'Belum dicatat']);
  });
  if (rows.length) shA.getRange(shA.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
function baris3_(n) { return ('00' + n).slice(-3); }

// Transisi status berbasis peran:
//   Dipesan  -> Dibayar  : bendahara (catat noVA + dibayarOleh)
//   Dibayar  -> Diterima : penerima  (foto barang + tanggalTerima + diterimaOleh)
// Transisi -> "Masuk Stok" lewat finalizeBelanja_ (logistik), bukan di sini.
function updateBelanjaStatus_(body) {
  var id = body.idBelanja;
  if (!id) throw new Error('idBelanja wajib.');
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.belanja);
  var rowIdx = findRow_(sh, 'idBelanja', id);
  if (rowIdx < 0) throw new Error('Nota tidak ditemukan: ' + id);
  var to = body.status;

  if (to === 'Dibayar') {
    requireRole_(body.user, ['bendahara']);
    setCell_(sh, rowIdx, 'status', 'Dibayar');
    setCell_(sh, rowIdx, 'dibayarOleh', body.user || '');
    if (body.noVA) setCell_(sh, rowIdx, 'noVA', body.noVA);
  } else if (to === 'Diterima') {
    requireRole_(body.user, ['penerima']);
    setCell_(sh, rowIdx, 'status', 'Diterima');
    setCell_(sh, rowIdx, 'diterimaOleh', body.user || '');
    setCell_(sh, rowIdx, 'tanggalTerima', body.tanggalTerima || todayStr_());
    if (body.fotoUrl) setCell_(sh, rowIdx, 'fotoUrl', body.fotoUrl);
  } else {
    throw new Error('Transisi status tidak didukung di sini: ' + to);
  }
  SpreadsheetApp.flush();
  return { idBelanja: id, status: to };
}

// Finalisasi oleh logistik: petakan tiap item ke master (atau tambah item master baru),
// upload faktur, lalu set status "Masuk Stok" (stok bertambah). Item Aset -> antrian.
function finalizeBelanja_(body) {
  var id = body.idBelanja;
  if (!id) throw new Error('idBelanja wajib.');
  requireRole_(body.user, ['logistik']);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shB = ss.getSheetByName(SHEETS.belanja);
  var rowIdx = findRow_(shB, 'idBelanja', id);
  if (rowIdx < 0) throw new Error('Nota tidak ditemukan: ' + id);

  var shI = ss.getSheetByName(SHEETS.itemBelanja);
  var data = shI.getDataRange().getValues();
  var head = data[0];
  var cId = head.indexOf('idBelanja'), cBaris = head.indexOf('baris');
  var cKode = head.indexOf('kodeMaster'), cKel = head.indexOf('kelompok'), cKlas = head.indexOf('klasifikasi');

  (body.mappings || []).forEach(function (mp) {
    var target = mp.target;  // salah satu KELOMPOK_STOK, atau 'Aset'
    var kode = '', kelompok = '', klas = '';
    if (target === 'Aset') {
      klas = 'Aset';
    } else {
      if (KELOMPOK_STOK.indexOf(target) < 0) throw new Error('Tujuan tidak valid: ' + target);
      kelompok = target;
      klas = (target === 'Obat') ? 'Obat' : (target === 'Alkes') ? 'Alkes' : 'BHP';
      if (mp.kodeMaster) kode = mp.kodeMaster;
      else if (mp.newItem && mp.newItem.nama) kode = createMasterItem_(target, mp.newItem);
      else throw new Error('Baris ' + mp.baris + ' belum dipetakan ke item master.');
    }
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][cId]) === String(id) && String(data[i][cBaris]) === String(mp.baris)) {
        if (cKode >= 0) shI.getRange(i + 1, cKode + 1).setValue(kode);
        if (cKel >= 0) shI.getRange(i + 1, cKel + 1).setValue(kelompok);
        if (cKlas >= 0) shI.getRange(i + 1, cKlas + 1).setValue(klas);
        break;
      }
    }
  });

  setCell_(shB, rowIdx, 'status', 'Masuk Stok');
  setCell_(shB, rowIdx, 'distokOleh', body.user || '');
  if (body.fakturUrl) setCell_(shB, rowIdx, 'fakturUrl', body.fakturUrl);
  var nota = indexBy_(readSheet_(SHEETS.belanja), 'idBelanja')[id];
  if (nota && !fmtDate_(nota.tanggalTerima)) setCell_(shB, rowIdx, 'tanggalTerima', todayStr_());

  SpreadsheetApp.flush();
  queueAssets_(id);  // item yang baru ditandai Aset masuk antrian
  return { idBelanja: id, status: 'Masuk Stok' };
}

// Buat item master baru saat finalisasi (kode otomatis per kelompok). Kembalikan kode.
function createMasterItem_(kelompok, d) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.master);
  var prefix = KODE_PREFIX[kelompok] || 'ITM-';
  var max = 0;
  readSheet_(SHEETS.master).forEach(function (m) {
    var k = String(m.kode || '');
    if (k.indexOf(prefix) === 0) {
      var n = parseInt(k.slice(prefix.length).replace(/\D/g, ''), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  var kode = prefix + ('000' + (max + 1)).slice(-3);
  sh.appendRow([kode, d.nama, kelompok, kelompok, d.subKategori || 'Lainnya', d.satuan || '',
                d.kemasan || '', num_(d.hargaAcuan), defaultKategori_(kelompok), 'Praktis', '', true]);
  return kode;
}

function defaultKategori_(kelompok) {
  if (kelompok === 'Obat') return 'Obat-obatan';
  if (kelompok === 'BHP Umum') return 'Penjualan BHP';
  if (kelompok === 'Alkes') return 'Beban Alkes';
  return 'Beban Penggunaan Produk Internal'; // BHP Gigi
}

// Upload file (foto barang / faktur) base64 -> Drive, simpan URL di nota.
function uploadFile_(body) {
  var id = body.idBelanja, kind = body.kind;
  if (!body.dataBase64) throw new Error('File kosong.');
  // Catatan: sejak pindah ke RTDB, daftar staf tepercaya ada di RTDB (bukan sheet users
  // GAS ini). Cek peran sudah dilakukan di sisi app sebelum upload, jadi di sini hanya
  // menyimpan file ke Drive tanpa enforcement peran.

  var parent = DriveApp.getFolderById(ensureDriveFolder_());
  var sub = getOrCreateSubfolder_(parent, kind === 'faktur' ? 'Faktur' : 'Foto Barang');
  var blob = Utilities.newBlob(Utilities.base64Decode(body.dataBase64),
                               body.mimeType || 'application/octet-stream',
                               body.filename || (kind + '-' + id));
  var file = sub.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  var url = file.getUrl();
  if (id) {
    var shB = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.belanja);
    var rowIdx = findRow_(shB, 'idBelanja', id);
    if (rowIdx > 0) setCell_(shB, rowIdx, kind === 'faktur' ? 'fakturUrl' : 'fotoUrl', url);
  }
  return { url: url, kind: kind };
}

function getOrCreateSubfolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function updateAntrianAset_(body) {
  var id = body.idAset;
  if (!id) throw new Error('idAset wajib.');
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.antrianAset);
  var rowIdx = findRow_(sh, 'idAset', id);
  if (rowIdx < 0) throw new Error('Antrian aset tidak ditemukan: ' + id);
  var col = HEADERS.antrianAset.indexOf('statusCatat') + 1;
  var val = body.statusCatat || 'Sudah dicatat';
  sh.getRange(rowIdx, col).setValue(val);
  SpreadsheetApp.flush();
  return { idAset: id, statusCatat: val };
}

// ----------------------------------------------------------------------------
// MIRROR ke Sheets — RTDB tetap sumber kebenaran; ini cermin/log untuk akuntan.
// Payload memakai NAMA KOLOM (header) sebagai kunci; nilai ditata sesuai urutan header.
// ----------------------------------------------------------------------------
function mirrorAppend_(sheetName, rows) {
  if (!rows || !rows.length) return { appended: 0 };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet belum ada: ' + sheetName);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var out = rows.map(function (r) { return head.map(function (h) { return r[h] != null ? r[h] : ''; }); });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, head.length).setValues(out);
  SpreadsheetApp.flush();
  return { appended: out.length };
}

// Upsert berdasarkan kolom kunci: jika baris ada → timpa; jika belum → tambah.
function mirrorUpsert_(sheetName, keyField, rows) {
  if (!rows || !rows.length) return { upserted: 0 };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet belum ada: ' + sheetName);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  rows.forEach(function (r) {
    var line = head.map(function (h) { return r[h] != null ? r[h] : ''; });
    var rowIdx = findRow_(sh, keyField, r[keyField]);
    if (rowIdx > 0) sh.getRange(rowIdx, 1, 1, head.length).setValues([line]);
    else sh.appendRow(line);
  });
  SpreadsheetApp.flush();
  return { upserted: rows.length };
}

// Upsert satu nota belanja + tulis ulang seluruh item_belanja-nya agar sinkron dgn RTDB.
function mirrorBelanja_(nota, items) {
  if (!nota || !nota.idBelanja) throw new Error('nota.idBelanja wajib.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shB = ss.getSheetByName(SHEETS.belanja);
  var headB = shB.getRange(1, 1, 1, shB.getLastColumn()).getValues()[0];
  var rowB = headB.map(function (h) { return nota[h] != null ? nota[h] : ''; });
  var rowIdx = findRow_(shB, 'idBelanja', nota.idBelanja);
  if (rowIdx > 0) shB.getRange(rowIdx, 1, 1, headB.length).setValues([rowB]);
  else shB.appendRow(rowB);

  var shI = ss.getSheetByName(SHEETS.itemBelanja);
  var dataI = shI.getDataRange().getValues();
  var cId = dataI[0].indexOf('idBelanja');
  for (var i = dataI.length - 1; i >= 1; i--) {
    if (String(dataI[i][cId]) === String(nota.idBelanja)) shI.deleteRow(i + 1);
  }
  if (items && items.length) {
    var headI = shI.getRange(1, 1, 1, shI.getLastColumn()).getValues()[0];
    var out = items.map(function (it) { return headI.map(function (h) { return it[h] != null ? it[h] : ''; }); });
    shI.getRange(shI.getLastRow() + 1, 1, out.length, headI.length).setValues(out);
  }
  SpreadsheetApp.flush();
  return { idBelanja: nota.idBelanja, items: (items || []).length };
}

// Daftar nota + itemnya (terbaru dulu).
function getBelanja_(periode) {
  var byId = {};
  readSheet_(SHEETS.itemBelanja).forEach(function (it) {
    (byId[it.idBelanja] = byId[it.idBelanja] || []).push({
      baris: num_(it.baris), nama: it.nama, qty: num_(it.qty), hargaSatuan: num_(it.hargaSatuan),
      hargaRiilTotal: num_(it.hargaRiilTotal), hargaRiilUnit: num_(it.hargaRiilUnit),
      klasifikasi: it.klasifikasi, kodeMaster: it.kodeMaster, kelompok: it.kelompok,
    });
  });
  var out = readSheet_(SHEETS.belanja).filter(function (b) { return b.idBelanja; }).map(function (b) {
    return {
      idBelanja: b.idBelanja, tanggalPesan: fmtDate_(b.tanggalPesan), tanggalTerima: fmtDate_(b.tanggalTerima),
      sumber: b.sumber, supplier: b.supplier, noVA: b.noVA,
      subtotal: num_(b.subtotal), pengiriman: num_(b.pengiriman), diskonPengiriman: num_(b.diskonPengiriman),
      voucherShopee: num_(b.voucherShopee), voucherToko: num_(b.voucherToko), biayaLayanan: num_(b.biayaLayanan),
      totalNota: num_(b.totalNota), status: b.status,
      fotoUrl: b.fotoUrl, fakturUrl: b.fakturUrl,
      dipesanOleh: b.dipesanOleh, dibayarOleh: b.dibayarOleh, diterimaOleh: b.diterimaOleh, distokOleh: b.distokOleh,
      catatan: b.catatan,
      items: (byId[b.idBelanja] || []).sort(function (a, c) { return a.baris - c.baris; }),
    };
  });
  out.reverse();
  return out;
}

// Rekap angka siap salin ke Akoontan (per periode YYYY-MM).
function getRekap_(periode) {
  var per = periode || todayStr_().slice(0, 7);
  var belanja = readSheet_(SHEETS.belanja);
  var master = indexBy_(readSheet_(SHEETS.master), 'kode');

  var recvInPeriod = {};
  belanja.forEach(function (b) {
    if (String(b.status) === 'Masuk Stok' && fmtDate_(b.tanggalTerima).slice(0, 7) === per) recvInPeriod[b.idBelanja] = b;
  });

  var totalPersediaan = 0, totalBebanAlkes = 0;
  readSheet_(SHEETS.itemBelanja).forEach(function (it) {
    if (!recvInPeriod[it.idBelanja]) return;
    var v = num_(it.hargaRiilTotal);
    if (KELOMPOK_PERSEDIAAN[it.kelompok]) totalPersediaan += v;       // BHP Gigi/Umum/Obat
    else if (String(it.kelompok) === 'Alkes') totalBebanAlkes += v;   // Alkes -> beban
  });

  var aset = readSheet_(SHEETS.antrianAset)
    .filter(function (a) { return a.idAset && String(a.statusCatat) !== 'Sudah dicatat'; })
    .map(function (a) {
      return { idAset: a.idAset, nama: a.nama, tanggalTerima: fmtDate_(a.tanggalTerima),
               hargaTotal: num_(a.hargaTotal), sumber: a.sumber };
    });

  var avg = avgCostByKode_();
  var hpp = {};
  readSheet_(SHEETS.pakai).forEach(function (r) {
    if (fmtDate_(r.tanggal).slice(0, 7) !== per) return;
    var kel = r.kelompok || (master[r.kode] ? master[r.kode].kelompok : 'Lainnya');
    var cost = (avg[r.kode] != null) ? avg[r.kode] : (master[r.kode] ? num_(master[r.kode].hargaAcuan) : 0);
    hpp[kel] = (hpp[kel] || 0) + num_(r.jumlah) * cost;
  });

  var selisih = readSheet_(SHEETS.opname)
    .filter(function (o) { return fmtDate_(o.tanggal).slice(0, 7) === per && num_(o.selisih) !== 0; })
    .map(function (o) {
      return { kode: o.kode, nama: o.nama, kelompok: o.kelompok, selisih: num_(o.selisih), tanggal: fmtDate_(o.tanggal) };
    });

  return {
    periode: per,
    persediaan: { totalPersediaan: Math.round(totalPersediaan), totalBebanAlkes: Math.round(totalBebanAlkes) },
    antrianAset: aset,
    hppPemakaian: Object.keys(hpp).map(function (k) { return { kelompok: k, total: Math.round(hpp[k]) }; }),
    selisihOpname: selisih,
  };
}

// ----------------------------------------------------------------------------
// ADMIN — kelola master, staf, kata kunci klasifikasi (peran admin)
// ----------------------------------------------------------------------------
function requireAdmin_(nama) {
  if (peranOf_(nama).indexOf('admin') < 0) throw new Error('Hanya admin yang boleh melakukan ini.');
}

// Pengaturan untuk frontend: kata kunci klasifikasi + daftar kelompok & status.
function getSettings_() {
  return {
    keywords: readSheet_(SHEETS.klasifikasiKw)
      .filter(function (r) { return r.keyword; })
      .map(function (r) { return { klasifikasi: r.klasifikasi, keyword: String(r.keyword) }; }),
    kelompokStok: KELOMPOK_STOK,
    statusFlow: STATUS_FLOW,
  };
}

// Semua master termasuk yang nonaktif (untuk panel admin).
function getMasterAll_() {
  return readSheet_(SHEETS.master).filter(function (m) { return m.kode; }).map(function (m) {
    return {
      kode: m.kode, nama: m.nama, kelompok: m.kelompok, subKategori: m.subKategori,
      satuan: m.satuan, kemasan: m.kemasan, hargaAcuan: num_(m.hargaAcuan),
      metode: m.metode || 'Praktis', titikReorder: num_(m.titikReorder),
      aktif: !(m.aktif === false || String(m.aktif) === 'false'),
    };
  });
}

function adminSaveMaster_(body) {
  requireAdmin_(body.user);
  var it = body.item || {};
  if (!it.nama || !it.kelompok) throw new Error('Nama & kelompok wajib.');
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.master);

  if (it.kode) {
    var rowIdx = findRow_(sh, 'kode', it.kode);
    if (rowIdx < 0) throw new Error('Kode tidak ditemukan: ' + it.kode);
    setCell_(sh, rowIdx, 'nama', it.nama);
    setCell_(sh, rowIdx, 'kelompok', it.kelompok);
    setCell_(sh, rowIdx, 'kategoriProduk', it.kelompok);
    setCell_(sh, rowIdx, 'subKategori', it.subKategori || '');
    setCell_(sh, rowIdx, 'satuan', it.satuan || '');
    setCell_(sh, rowIdx, 'kemasan', it.kemasan || '');
    setCell_(sh, rowIdx, 'hargaAcuan', num_(it.hargaAcuan));
    setCell_(sh, rowIdx, 'metode', it.metode || 'Praktis');
    setCell_(sh, rowIdx, 'titikReorder', (it.titikReorder === '' || it.titikReorder == null) ? '' : num_(it.titikReorder));
    setCell_(sh, rowIdx, 'aktif', it.aktif !== false);
    SpreadsheetApp.flush();
    return { kode: it.kode, updated: true };
  }
  var kode = createMasterItem_(it.kelompok, it);
  var r2 = findRow_(sh, 'kode', kode);
  if (it.metode) setCell_(sh, r2, 'metode', it.metode);
  if (it.titikReorder != null && it.titikReorder !== '') setCell_(sh, r2, 'titikReorder', num_(it.titikReorder));
  SpreadsheetApp.flush();
  return { kode: kode, created: true };
}

function adminSaveUser_(body) {
  requireAdmin_(body.user);
  var s = body.staf || {};
  if (!s.nama) throw new Error('Nama staf wajib.');
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.users);
  var key = s.originalNama || s.nama;
  var rowIdx = findRow_(sh, 'nama', key);
  if (rowIdx < 0) {
    sh.appendRow([s.nama, String(s.pin || ''), s.kelompok || '', s.peran || 'logistik', s.aktif !== false]);
    SpreadsheetApp.flush();
    return { nama: s.nama, created: true };
  }
  setCell_(sh, rowIdx, 'nama', s.nama);
  if (s.pin != null && s.pin !== '') setCell_(sh, rowIdx, 'pin', String(s.pin));
  setCell_(sh, rowIdx, 'kelompok', s.kelompok || '');
  setCell_(sh, rowIdx, 'peran', s.peran || 'logistik');
  setCell_(sh, rowIdx, 'aktif', s.aktif !== false);
  SpreadsheetApp.flush();
  return { nama: s.nama, updated: true };
}

function adminSaveKeyword_(body) {
  requireAdmin_(body.user);
  var klas = body.klasifikasi, kw = (body.keyword || '').toString().trim().toLowerCase();
  if (!klas || !kw) throw new Error('Klasifikasi & keyword wajib.');
  var dup = readSheet_(SHEETS.klasifikasiKw).some(function (r) {
    return String(r.klasifikasi) === String(klas) && String(r.keyword).toLowerCase() === kw;
  });
  if (dup) return { klasifikasi: klas, keyword: kw, duplikat: true };
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.klasifikasiKw).appendRow([klas, kw]);
  SpreadsheetApp.flush();
  return { klasifikasi: klas, keyword: kw, created: true };
}

function adminDeleteKeyword_(body) {
  requireAdmin_(body.user);
  var klas = body.klasifikasi, kw = (body.keyword || '').toString().trim().toLowerCase();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.klasifikasiKw);
  var data = sh.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(klas) && String(data[i][1]).toLowerCase() === kw) {
      sh.deleteRow(i + 1);
      SpreadsheetApp.flush();
      return { deleted: true };
    }
  }
  return { deleted: false };
}

// ----------------------------------------------------------------------------
// Util
// ----------------------------------------------------------------------------
// Set sel berdasarkan nama kolom (header baris 1) pada baris rowIdx.
function setCell_(sh, rowIdx, colName, val) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var c = head.indexOf(colName);
  if (c >= 0) sh.getRange(rowIdx, c + 1).setValue(val);
}

// Cari nomor baris (1-based, termasuk header) berdasarkan nilai di kolom bernama colName.
function findRow_(sh, colName, value) {
  var data = sh.getDataRange().getValues();
  if (!data.length) return -1;
  var col = data[0].indexOf(colName);
  if (col < 0) return -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][col]) === String(value)) return i + 1;
  }
  return -1;
}

function readSheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) return [];
  var rng = sh.getDataRange().getValues();
  if (rng.length < 2) return [];
  var head = rng[0];
  return rng.slice(1).map(function (row) {
    var o = {};
    head.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  }).filter(function (o) {
    // Buang baris yang benar-benar kosong (semua sel kosong).
    return Object.keys(o).some(function (k) { return o[k] !== '' && o[k] != null; });
  });
}

function sumBy_(rows, keyField, valField) {
  var out = {};
  rows.forEach(function (r) {
    var k = r[keyField];
    if (!k) return;
    out[k] = (out[k] || 0) + num_(r[valField]);
  });
  return out;
}

function sumSince_(rows, kode, sinceTanggal) {
  var since = fmtDate_(sinceTanggal);
  var total = 0;
  rows.forEach(function (r) {
    if (r.kode === kode && fmtDate_(r.tanggal) > since) total += num_(r.jumlah);
  });
  return total;
}

function indexBy_(rows, keyField) {
  var out = {};
  rows.forEach(function (r) { if (r[keyField]) out[r[keyField]] = r; });
  return out;
}

function groupCounts_(master) {
  var c = {};
  master.forEach(function (m) {
    if (m.aktif === false || String(m.aktif) === 'false') return;
    c[m.kelompok] = (c[m.kelompok] || 0) + 1;
  });
  return c;
}

function num_(v) {
  if (v === '' || v == null) return 0;
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function todayStr_() { return fmtDate_(new Date()); }

function fmtDate_(d) {
  if (!d) return '';
  if (Object.prototype.toString.call(d) === '[object Date]') {
    var tz = Session.getScriptTimeZone() || 'Asia/Makassar';
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }
  // Sudah string; ambil 10 char pertama (yyyy-MM-dd).
  return String(d).slice(0, 10);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
