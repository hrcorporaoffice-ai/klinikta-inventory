import React, { useEffect, useMemo, useState } from 'react'
import * as api from '../api.js'
import { guessTarget } from '../classify.js'

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0))
const STATUS_BADGE = { Dipesan: 'warn', Dibayar: 'b', Diterima: 'b', 'Masuk Stok': 'ok' }
const newRow = () => ({ id: Math.random().toString(36).slice(2), nama: '', qty: '', hargaSatuan: '' })

// peran boleh menjalankan langkah tertentu? admin selalu boleh.
const can = (user, role) => user.peran === 'admin' || user.peran === role

// Baca file jadi base64 (tanpa prefix data:).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export default function Belanja({ user, today, onToast, onChanged }) {
  // Composer nota
  const [tanggalPesan, setTanggalPesan] = useState(today)
  const [sumber, setSumber] = useState('')
  const [supplier, setSupplier] = useState('')
  const [noVA, setNoVA] = useState('')
  const [pengiriman, setPengiriman] = useState('')
  const [diskonPengiriman, setDiskonPengiriman] = useState('')
  const [voucherShopee, setVoucherShopee] = useState('')
  const [voucherToko, setVoucherToko] = useState('')
  const [biayaLayanan, setBiayaLayanan] = useState('')
  const [rows, setRows] = useState([newRow()])
  const [saving, setSaving] = useState(false)

  // Data pendukung
  const [list, setList] = useState(null)
  const [listErr, setListErr] = useState('')
  const [keywords, setKeywords] = useState([])
  const [masterList, setMasterList] = useState([])

  const loadList = () => { setListErr(''); api.getBelanja().then(setList).catch((e) => setListErr(e.message)) }
  const loadMaster = () => api.getMasterAll().then(setMasterList).catch(() => {})
  useEffect(() => {
    loadList(); loadMaster()
    api.getSettings().then((s) => setKeywords(s.keywords || [])).catch(() => {})
  }, [])

  const setRow = (id, patch) => setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const addRow = () => setRows((p) => [...p, newRow()])
  const delRow = (id) => setRows((p) => (p.length > 1 ? p.filter((r) => r.id !== id) : p))

  const calc = useMemo(() => {
    const sumSub = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.hargaSatuan) || 0), 0)
    const net = (Number(pengiriman) || 0) + (Number(biayaLayanan) || 0)
      - (Number(diskonPengiriman) || 0) - (Number(voucherShopee) || 0) - (Number(voucherToko) || 0)
    const perRow = {}
    rows.forEach((r) => {
      const sub = (Number(r.qty) || 0) * (Number(r.hargaSatuan) || 0)
      const prop = sumSub > 0 ? sub / sumSub : 0
      perRow[r.id] = { sub, riilUnit: Number(r.qty) > 0 ? (sub + net * prop) / Number(r.qty) : 0 }
    })
    return { sumSub, net, total: sumSub + net, perRow }
  }, [rows, pengiriman, diskonPengiriman, voucherShopee, voucherToko, biayaLayanan])

  const validRows = rows.filter((r) => r.nama.trim() && Number(r.qty) > 0)
  const canSave = validRows.length > 0 && calc.sumSub > 0 && !saving

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      const items = validRows.map((r) => ({ nama: r.nama.trim(), qty: Number(r.qty), hargaSatuan: Number(r.hargaSatuan) || 0 }))
      const nota = {
        tanggalPesan, sumber, supplier, noVA,
        pengiriman: Number(pengiriman) || 0, diskonPengiriman: Number(diskonPengiriman) || 0,
        voucherShopee: Number(voucherShopee) || 0, voucherToko: Number(voucherToko) || 0,
        biayaLayanan: Number(biayaLayanan) || 0,
      }
      const res = await api.saveBelanja({ nota, items, user: user.nama })
      onToast('ok', `Belanja tersimpan (${res.items} item, ${rupiah(res.totalNota)}) — status Dipesan.`)
      setRows([newRow()]); setSumber(''); setSupplier(''); setNoVA('')
      setPengiriman(''); setDiskonPengiriman(''); setVoucherShopee(''); setVoucherToko(''); setBiayaLayanan('')
      setTanggalPesan(today)
      loadList()
    } catch (e) { onToast('err', e.message) } finally { setSaving(false) }
  }

  return (
    <div>
      {/* Composer */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="cap"><h2>Catat Belanja Baru</h2><span className="meta">status awal: Dipesan</span></div>

        <div className="bform">
          <label>Tanggal pesan<input type="date" value={tanggalPesan} onChange={(e) => setTanggalPesan(e.target.value)} /></label>
          <label>Sumber / No. pesanan<input placeholder="mis. Shopee 24061..." value={sumber} onChange={(e) => setSumber(e.target.value)} /></label>
          <label>Supplier / Toko<input placeholder="nama toko" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></label>
          <label>No. VA pembayaran<input placeholder="opsional" value={noVA} onChange={(e) => setNoVA(e.target.value)} /></label>
        </div>

        {/* Item rows — cukup nama, qty, harga */}
        <div className="bitems">
          {rows.map((r, i) => {
            const c = calc.perRow[r.id] || {}
            return (
              <div className="bitem" key={r.id}>
                <div className="bitem-main">
                  <input className="bi-nama" placeholder={`Nama barang #${i + 1}`} value={r.nama}
                    onChange={(e) => setRow(r.id, { nama: e.target.value })} />
                  <input className="bi-qty" type="number" min="0" inputMode="numeric" placeholder="qty" value={r.qty}
                    onChange={(e) => setRow(r.id, { qty: e.target.value })} />
                  <input className="bi-harga" type="number" min="0" inputMode="numeric" placeholder="harga satuan" value={r.hargaSatuan}
                    onChange={(e) => setRow(r.id, { hargaSatuan: e.target.value })} />
                  <button className="bi-del" title="Hapus baris" onClick={() => delRow(r.id)}>✕</button>
                </div>
                {Number(r.qty) > 0 && <div className="bitem-sub"><span className="bi-riil">≈ {rupiah(c.riilUnit)}/unit setelah biaya</span></div>}
              </div>
            )
          })}
          <button className="btn ghost addrow" onClick={addRow}>+ Tambah baris</button>
        </div>

        {/* Komponen biaya checkout Shopee */}
        <div className="bform shopee">
          <label>Subtotal Pengiriman<input type="number" min="0" inputMode="numeric" placeholder="0" value={pengiriman} onChange={(e) => setPengiriman(e.target.value)} /></label>
          <label>Diskon Pengiriman<input type="number" min="0" inputMode="numeric" placeholder="0" value={diskonPengiriman} onChange={(e) => setDiskonPengiriman(e.target.value)} /></label>
          <label>Voucher Shopee<input type="number" min="0" inputMode="numeric" placeholder="0" value={voucherShopee} onChange={(e) => setVoucherShopee(e.target.value)} /></label>
          <label>Voucher Toko<input type="number" min="0" inputMode="numeric" placeholder="0" value={voucherToko} onChange={(e) => setVoucherToko(e.target.value)} /></label>
          <label>Biaya Layanan<input type="number" min="0" inputMode="numeric" placeholder="0" value={biayaLayanan} onChange={(e) => setBiayaLayanan(e.target.value)} /></label>
        </div>

        <div className="btotals">
          <div className="bt-line"><span>Subtotal Produk</span><b>{rupiah(calc.sumSub)}</b></div>
          <div className="bt-line"><span>Biaya bersih (kirim/diskon/voucher/layanan)</span><b>{calc.net >= 0 ? '' : '− '}{rupiah(Math.abs(calc.net))}</b></div>
          <div className="bt-line total"><span>Total bayar</span><b>{rupiah(calc.total)}</b></div>
        </div>
        <div className="bsave">
          <button className="btn" disabled={!canSave} onClick={handleSave}>{saving ? 'Menyimpan…' : 'Simpan Belanja'}</button>
        </div>
      </div>

      {/* Riwayat */}
      <div className="card">
        <div className="cap"><h2>Riwayat Belanja</h2><span className="meta">alur: Dipesan → Dibayar → Diterima → Masuk Stok</span></div>
        {listErr ? (
          <div className="state err">⚠️ {listErr}<div style={{ marginTop: 8 }}><button className="btn ghost" onClick={loadList}>Coba lagi</button></div></div>
        ) : list === null ? (
          <div className="state"><span className="spin" />Memuat…</div>
        ) : list.length === 0 ? (
          <div className="state">Belum ada belanja tercatat.</div>
        ) : (
          <div className="notalist">
            {list.map((n) => (
              <NotaRow key={n.idBelanja} n={n} user={user} today={today} masterList={masterList}
                keywords={keywords} onToast={onToast}
                onChanged={() => { loadList(); loadMaster(); onChanged && onChanged() }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function NotaRow({ n, user, today, masterList, keywords, onToast, onChanged }) {
  const [openFinal, setOpenFinal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [va, setVa] = useState(n.noVA || '')

  async function mark(status, extra = {}) {
    setBusy(true)
    try {
      await api.updateBelanjaStatus({ idBelanja: n.idBelanja, status, user: user.nama, ...extra })
      onToast('ok', `Status → ${status}.`)
      onChanged()
    } catch (e) { onToast('err', e.message) } finally { setBusy(false) }
  }

  async function uploadFoto(file) {
    if (!file) return
    setBusy(true)
    try {
      const dataBase64 = await fileToBase64(file)
      await api.uploadFile({ idBelanja: n.idBelanja, kind: 'foto', filename: file.name, mimeType: file.type, dataBase64, user: user.nama })
      onToast('ok', 'Foto barang terunggah.')
      onChanged()
    } catch (e) { onToast('err', e.message) } finally { setBusy(false) }
  }

  return (
    <div className="nota">
      <div className="nota-top">
        <div>
          <div className="nota-title">{n.sumber || n.supplier || n.idBelanja}</div>
          <div className="nota-sub">
            {n.tanggalPesan}{n.tanggalTerima ? ` · diterima ${n.tanggalTerima}` : ''} · {n.items.length} item
            {n.noVA ? ` · VA ${n.noVA}` : ''}
          </div>
        </div>
        <div className="nota-right">
          <span className="nota-total">{rupiah(n.totalNota)}</span>
          <span className={'badge ' + (STATUS_BADGE[n.status] || 'warn')}>{n.status}</span>
        </div>
      </div>

      <div className="nota-items">
        {n.items.map((it) => (
          <span className="nota-chip" key={it.baris}>
            {it.nama} ×{it.qty}{it.kelompok ? <i> → {it.kelompok}{it.kodeMaster ? ` (${it.kodeMaster})` : ''}</i> : (it.klasifikasi ? <i> → {it.klasifikasi}</i> : null)}
          </span>
        ))}
      </div>

      {/* jejak siapa */}
      <div className="nota-trail">
        {n.dipesanOleh && <span>📝 {n.dipesanOleh}</span>}
        {n.dibayarOleh && <span>💳 {n.dibayarOleh}</span>}
        {n.diterimaOleh && <span>📦 {n.diterimaOleh}</span>}
        {n.distokOleh && <span>✅ {n.distokOleh}</span>}
        {n.fotoUrl && <a href={n.fotoUrl} target="_blank" rel="noreferrer">foto barang</a>}
        {n.fakturUrl && <a href={n.fakturUrl} target="_blank" rel="noreferrer">faktur</a>}
      </div>

      {/* aksi sesuai status + peran */}
      <div className="nota-actions">
        {n.status === 'Dipesan' && can(user, 'bendahara') && (
          <>
            <input className="va-inline" placeholder="No. VA (opsional)" value={va} onChange={(e) => setVa(e.target.value)} />
            <button className="btn sm" disabled={busy} onClick={() => mark('Dibayar', { noVA: va })}>Tandai Dibayar</button>
          </>
        )}
        {n.status === 'Dibayar' && can(user, 'penerima') && (
          <>
            <label className="btn ghost sm filelabel">
              📷 Foto barang<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => uploadFoto(e.target.files[0])} />
            </label>
            <button className="btn sm" disabled={busy} onClick={() => mark('Diterima')}>Tandai Diterima</button>
          </>
        )}
        {n.status === 'Diterima' && can(user, 'logistik') && (
          <button className="btn sm" disabled={busy} onClick={() => setOpenFinal((v) => !v)}>
            {openFinal ? 'Tutup' : 'Masukkan ke Stok →'}
          </button>
        )}
        {/* info untuk peran yang tidak berwenang di langkah ini */}
        {n.status === 'Dipesan' && !can(user, 'bendahara') && <span className="muted sm">menunggu bendahara menandai Dibayar</span>}
        {n.status === 'Dibayar' && !can(user, 'penerima') && <span className="muted sm">menunggu penerima menandai Diterima</span>}
        {n.status === 'Diterima' && !can(user, 'logistik') && <span className="muted sm">menunggu logistik memasukkan ke stok</span>}
      </div>

      {openFinal && n.status === 'Diterima' && can(user, 'logistik') && (
        <Finalisasi n={n} user={user} masterList={masterList} keywords={keywords}
          onToast={onToast} onDone={() => { setOpenFinal(false); onChanged() }} />
      )}
    </div>
  )
}

const TARGETS = ['BHP Gigi', 'BHP Umum', 'Obat', 'Alkes', 'Aset']

function Finalisasi({ n, user, masterList, keywords, onToast, onDone }) {
  // satu baris pemetaan per item nota
  const [maps, setMaps] = useState(() => n.items.map((it) => {
    const target = guessTarget(it.nama, keywords)
    return { baris: it.baris, nama: it.nama, qty: it.qty, target, kodeMaster: '', addNew: false, newItem: { nama: it.nama, subKategori: '', satuan: '', kemasan: '', hargaAcuan: '' } }
  }))
  const [faktur, setFaktur] = useState(null)
  const [busy, setBusy] = useState(false)

  const setMap = (baris, patch) => setMaps((p) => p.map((m) => (m.baris === baris ? { ...m, ...patch } : m)))
  const setNew = (baris, patch) => setMaps((p) => p.map((m) => (m.baris === baris ? { ...m, newItem: { ...m.newItem, ...patch } } : m)))

  const masterByKelompok = (kel) => masterList.filter((m) => m.kelompok === kel && m.aktif)

  const incomplete = maps.some((m) => m.target !== 'Aset' && !m.addNew && !m.kodeMaster)
    || maps.some((m) => m.target !== 'Aset' && m.addNew && !m.newItem.nama.trim())

  async function submit() {
    if (incomplete) { onToast('err', 'Lengkapi pemetaan tiap item (pilih item master / tambah baru / Aset).'); return }
    setBusy(true)
    try {
      let fakturUrl = ''
      if (faktur) {
        const dataBase64 = await fileToBase64(faktur)
        const up = await api.uploadFile({ idBelanja: n.idBelanja, kind: 'faktur', filename: faktur.name, mimeType: faktur.type, dataBase64, user: user.nama })
        fakturUrl = up.url
      }
      const mappings = maps.map((m) => ({
        baris: m.baris,
        target: m.target,
        kodeMaster: m.target !== 'Aset' && !m.addNew ? m.kodeMaster : '',
        newItem: m.target !== 'Aset' && m.addNew ? { ...m.newItem, hargaAcuan: Number(m.newItem.hargaAcuan) || 0 } : null,
      }))
      await api.finalizeBelanja({ idBelanja: n.idBelanja, mappings, fakturUrl, user: user.nama })
      onToast('ok', 'Barang masuk stok. Faktur tersimpan.')
      onDone()
    } catch (e) { onToast('err', e.message) } finally { setBusy(false) }
  }

  return (
    <div className="finalisasi">
      <div className="fin-head">Masukkan ke stok — petakan tiap item ke persediaan (logistik)</div>
      {maps.map((m) => (
        <div className="fin-item" key={m.baris}>
          <div className="fin-name">{m.nama} <span className="muted">×{m.qty}</span></div>
          <div className="fin-controls">
            <select value={m.target} onChange={(e) => setMap(m.baris, { target: e.target.value, kodeMaster: '', addNew: false })}>
              {TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>

            {m.target === 'Aset' ? (
              <span className="muted sm">→ antrian Daftar Aset (tidak menambah stok)</span>
            ) : m.addNew ? (
              <div className="fin-new">
                <input placeholder="Nama item master baru" value={m.newItem.nama} onChange={(e) => setNew(m.baris, { nama: e.target.value })} />
                <input placeholder="Sub-kategori" value={m.newItem.subKategori} onChange={(e) => setNew(m.baris, { subKategori: e.target.value })} />
                <input placeholder="Satuan (mis. botol)" value={m.newItem.satuan} onChange={(e) => setNew(m.baris, { satuan: e.target.value })} />
                <button className="linklike" onClick={() => setMap(m.baris, { addNew: false })}>pilih yang ada</button>
              </div>
            ) : (
              <>
                <select value={m.kodeMaster} onChange={(e) => setMap(m.baris, { kodeMaster: e.target.value })}>
                  <option value="">— pilih item master —</option>
                  {masterByKelompok(m.target).map((it) => <option key={it.kode} value={it.kode}>{it.nama} ({it.kode})</option>)}
                </select>
                <button className="linklike" onClick={() => setMap(m.baris, { addNew: true })}>+ item baru</button>
              </>
            )}
          </div>
        </div>
      ))}
      <div className="fin-foot">
        <label className="btn ghost sm filelabel">
          {faktur ? `📄 ${faktur.name.slice(0, 18)}…` : '📄 Upload faktur'}
          <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => setFaktur(e.target.files[0])} />
        </label>
        <button className="btn sm" disabled={busy} onClick={submit}>{busy ? 'Memproses…' : 'Masukkan ke Stok'}</button>
      </div>
    </div>
  )
}
