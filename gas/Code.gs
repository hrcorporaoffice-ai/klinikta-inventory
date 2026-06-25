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
  masuk: 'transaksi_masuk',
  pakai: 'transaksi_pakai',
  opname: 'opname',
  rekap: 'rekap_bulanan',
  users: 'users',
};

var DRIVE_FOLDER_NAME = 'INVENTORY_KLINIKTA_Bukti'; // folder bukti faktur/foto (Drive terpisah)
var PROP_FOLDER_ID = 'INVENTORY_DRIVE_FOLDER_ID';

// Header tiap sheet (urutan kolom = sumber kebenaran).
var HEADERS = {
  master: ['kode', 'nama', 'kelompok', 'kategoriProduk', 'subKategori', 'satuan',
           'kemasan', 'hargaAcuan', 'kategoriDefault', 'metode', 'titikReorder', 'aktif'],
  masuk:  ['timestamp', 'tanggal', 'kelompok', 'kode', 'nama', 'jumlah', 'hargaUnit',
           'total', 'supplier', 'noFaktur', 'buktiUrl', 'user', 'catatan'],
  pakai:  ['timestamp', 'tanggal', 'kelompok', 'kode', 'nama', 'jumlah', 'user', 'catatan'],
  opname: ['timestamp', 'tanggal', 'kelompok', 'kode', 'nama', 'stokSistem',
           'stokFisik', 'selisih', 'user', 'catatan'],
  rekap:  ['periode', 'kelompok', 'totalPembelian', 'totalHpp', 'dibuat'],
  users:  ['nama', 'pin', 'kelompok', 'aktif'],
};

// Staf contoh — GANTI nama & PIN ini di sheet "users" sesuai staf asli KLINIKTA.
var USERS_SEED = [
  ['Staf Gigi', '1111', 'BHP Gigi', true],
  ['Staf Umum', '2222', 'BHP Umum', true],
  ['Staf Obat', '3333', 'Obat', true],
  ['Admin',     '0000', 'BHP Gigi', true],
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

  // Tulis wajib menyertakan nama staf yang sudah login.
  if (!body.user) return json_({ ok: false, error: 'Belum login: nama staf wajib ada.' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // cegah tulisan bersamaan dari banyak HP
    var result;
    switch (action) {
      case 'savePakai':  result = saveLines_(SHEETS.pakai, body); break;
      case 'saveMasuk':  result = saveLines_(SHEETS.masuk, body); break;
      case 'saveOpname': result = saveLines_(SHEETS.opname, body); break;
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
    .map(function (u) { return { nama: String(u.nama), kelompok: u.kelompok || 'BHP Gigi' }; });
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
  return { nama: String(found.nama), kelompok: found.kelompok || 'BHP Gigi' };
}

// ----------------------------------------------------------------------------
// READ: master + stok terhitung + pemakaian hari ini
// ----------------------------------------------------------------------------
function getState_(kelompok, tanggal) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var today = tanggal || todayStr_();

  var master = readSheet_(SHEETS.master);
  var masuk = readSheet_(SHEETS.masuk);
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
    } else if (sheetName === SHEETS.masuk) {
      var jml = num_(ln.qty);
      if (jml <= 0) return;
      var harga = num_(ln.harga);
      rows.push([ts, tanggal, kelompok, ln.kode, nama, jml, harga, jml * harga,
                 ln.supplier || '', ln.noFaktur || '', ln.buktiUrl || '', user, ln.catatan || '']);
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
// Util
// ----------------------------------------------------------------------------
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
