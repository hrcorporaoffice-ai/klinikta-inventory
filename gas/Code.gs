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
  rekap: 'rekap_bulanan',
  users: 'users',
};

// Klasifikasi yang menambah stok (dipetakan ke master). Selain ini tidak menambah stok.
var KLAS_STOK = { 'BHP': true, 'Obat': true };

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
            'subtotal', 'ongkir', 'diskon', 'totalNota', 'status', 'user', 'catatan'],
  itemBelanja: ['idBelanja', 'baris', 'nama', 'qty', 'hargaSatuan', 'subtotalItem',
                'alokasiOngkir', 'alokasiDiskon', 'hargaRiilTotal', 'hargaRiilUnit',
                'klasifikasi', 'kodeMaster', 'kelompok'],
  antrianAset: ['idAset', 'timestamp', 'idBelanja', 'nama', 'tanggalTerima', 'hargaTotal',
                'sumber', 'kategori', 'statusCatat'],
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
    if (action === 'getBelanja') {
      return json_({ ok: true, data: getBelanja_(e.parameter.periode || null) });
    }
    if (action === 'getRekap') {
      return json_({ ok: true, data: getRekap_(e.parameter.periode || null) });
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
      case 'savePakai':           result = saveLines_(SHEETS.pakai, body); break;
      case 'saveOpname':          result = saveLines_(SHEETS.opname, body); break;
      case 'saveBelanja':         result = saveBelanja_(body); break;
      case 'updateBelanjaStatus': result = updateBelanjaStatus_(body); break;
      case 'updateAntrianAset':   result = updateAntrianAset_(body); break;
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

// Baris "barang masuk" dari item_belanja pada nota berstatus "Diterima" yang
// sudah dipetakan ke master (kodeMaster). Format kompatibel sumBy_/sumSince_.
function receivedMasuk_() {
  var belanja = readSheet_(SHEETS.belanja);
  var info = {};
  belanja.forEach(function (b) {
    if (b.idBelanja) info[b.idBelanja] = { status: String(b.status), tanggalTerima: b.tanggalTerima };
  });
  var out = [];
  readSheet_(SHEETS.itemBelanja).forEach(function (it) {
    var parent = info[it.idBelanja];
    if (!parent || parent.status !== 'Diterima' || !it.kodeMaster) return;
    out.push({ kode: it.kodeMaster, jumlah: num_(it.qty), tanggal: fmtDate_(parent.tanggalTerima) });
  });
  return out;
}

// Harga beli rata-rata tertimbang per kode (Aturan 6), dari item diterima.
function avgCostByKode_() {
  var belanja = readSheet_(SHEETS.belanja);
  var recv = {};
  belanja.forEach(function (b) { if (b.idBelanja && String(b.status) === 'Diterima') recv[b.idBelanja] = true; });
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

// Simpan satu nota + item-itemnya. Alokasi ongkir & diskon proporsional ke nilai item.
function saveBelanja_(body) {
  var nota = body.nota || {};
  var items = body.items || [];
  if (!items.length) throw new Error('Tidak ada item belanja.');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shB = ss.getSheetByName(SHEETS.belanja);
  var shI = ss.getSheetByName(SHEETS.itemBelanja);
  if (!shB || !shI) throw new Error('Sheet belanja belum ada. Jalankan setup() lagi.');

  var masterByKode = indexBy_(readSheet_(SHEETS.master), 'kode');
  var ongkir = num_(nota.ongkir), diskon = num_(nota.diskon);
  var sumSub = 0;
  items.forEach(function (it) { sumSub += num_(it.qty) * num_(it.hargaSatuan); });
  if (sumSub <= 0) throw new Error('Subtotal item harus lebih dari 0.');

  var status = nota.status || 'Dipesan';
  var tglPesan = nota.tanggalPesan || todayStr_();
  var tglTerima = (status === 'Diterima') ? (nota.tanggalTerima || todayStr_()) : (nota.tanggalTerima || '');
  var id = 'BLJ' + (new Date()).getTime();
  var ts = new Date();
  var totalNota = sumSub + ongkir - diskon;

  shB.appendRow([id, ts, tglPesan, tglTerima, nota.sumber || '', nota.supplier || '',
                 sumSub, ongkir, diskon, totalNota, status, body.user || '', nota.catatan || '']);

  var rows = [], baris = 0;
  items.forEach(function (it) {
    baris++;
    var q = num_(it.qty), h = num_(it.hargaSatuan);
    var sub = q * h;
    var prop = sumSub > 0 ? sub / sumSub : 0;
    var aOngkir = ongkir * prop, aDiskon = diskon * prop;
    var riilTotal = sub + aOngkir - aDiskon;
    var riilUnit = q > 0 ? riilTotal / q : 0;
    var klas = it.klasifikasi || 'BHP';
    var kode = (KLAS_STOK[klas] && it.kodeMaster) ? it.kodeMaster : '';
    var kelompok = (kode && masterByKode[kode]) ? masterByKode[kode].kelompok : (it.kelompok || '');
    rows.push([id, baris, it.nama || '', q, h, sub, aOngkir, aDiskon, riilTotal, riilUnit, klas, kode, kelompok]);
  });
  shI.getRange(shI.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

  if (status === 'Diterima') queueAssets_(id);
  SpreadsheetApp.flush();
  return { idBelanja: id, totalNota: totalNota, items: rows.length, status: status };
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

function updateBelanjaStatus_(body) {
  var id = body.idBelanja;
  if (!id) throw new Error('idBelanja wajib.');
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.belanja);
  var rowIdx = findRow_(sh, 'idBelanja', id);
  if (rowIdx < 0) throw new Error('Nota tidak ditemukan: ' + id);
  var statusCol = HEADERS.belanja.indexOf('status') + 1;
  var terimaCol = HEADERS.belanja.indexOf('tanggalTerima') + 1;
  if (body.status) sh.getRange(rowIdx, statusCol).setValue(body.status);
  if (body.status === 'Diterima') {
    sh.getRange(rowIdx, terimaCol).setValue(body.tanggalTerima || todayStr_());
    SpreadsheetApp.flush();
    queueAssets_(id);
  }
  SpreadsheetApp.flush();
  return { idBelanja: id, status: body.status };
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
      sumber: b.sumber, supplier: b.supplier, subtotal: num_(b.subtotal), ongkir: num_(b.ongkir),
      diskon: num_(b.diskon), totalNota: num_(b.totalNota), status: b.status, user: b.user, catatan: b.catatan,
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
    if (String(b.status) === 'Diterima' && fmtDate_(b.tanggalTerima).slice(0, 7) === per) recvInPeriod[b.idBelanja] = b;
  });

  var totalPersediaan = 0, totalBebanAlkes = 0;
  readSheet_(SHEETS.itemBelanja).forEach(function (it) {
    if (!recvInPeriod[it.idBelanja]) return;
    var v = num_(it.hargaRiilTotal);
    if (KLAS_STOK[it.klasifikasi]) totalPersediaan += v;
    else if (String(it.klasifikasi) === 'Alkes') totalBebanAlkes += v;
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
// Util
// ----------------------------------------------------------------------------
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
