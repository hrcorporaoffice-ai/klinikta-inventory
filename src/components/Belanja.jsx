import React, { useEffect, useMemo, useState } from 'react'
import * as api from '../api.js'
import { MASTER_ITEMS } from '../data/masterItems.js'
import { KLASIFIKASI, guessKlasifikasi, PANDUAN_KLAS } from '../classify.js'

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0))
const STATUS = ['Dipesan', 'Dibayar', 'Diterima']
const STATUS_BADGE = { Dipesan: 'warn', Dibayar: 'b', Diterima: 'ok' }
const newRow = () => ({ id: Math.random().toString(36).slice(2), nama: '', qty: '', hargaSatuan: '', klasifikasi: 'BHP', klasTouched: false, kodeMaster: '' })

export default function Belanja({ user, today, onToast, onChanged }) {
  // --- Composer nota ---
  const [tanggalPesan, setTanggalPesan] = useState(today)
  const [sumber, setSumber] = useState('')
  const [supplier, setSupplier] = useState('')
  const [ongkir, setOngkir] = useState('')
  const [diskon, setDiskon] = useState('')
  const [status, setStatus] = useState('Dipesan')
  const [catatan, setCatatan] = useState('')
  const [rows, setRows] = useState([newRow()])
  const [saving, setSaving] = useState(false)
  const [showPanduan, setShowPanduan] = useState(false)

  // --- Daftar nota ---
  const [list, setList] = useState(null)
  const [listErr, setListErr] = useState('')

  const loadList = () => {
    setListErr('')
    api.getBelanja().then(setList).catch((e) => setListErr(e.message))
  }
  useEffect(() => { loadList() }, [])

  const setRow = (id, patch) => setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const addRow = () => setRows((p) => [...p, newRow()])
  const delRow = (id) => setRows((p) => (p.length > 1 ? p.filter((r) => r.id !== id) : p))

  const onNamaBlur = (r) => {
    if (!r.klasTouched && r.nama) setRow(r.id, { klasifikasi: guessKlasifikasi(r.nama) })
  }

  // --- Hitung alokasi (sama dengan server) ---
  const calc = useMemo(() => {
    const sumSub = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.hargaSatuan) || 0), 0)
    const ong = Number(ongkir) || 0, dis = Number(diskon) || 0
    const perRow = {}
    rows.forEach((r) => {
      const sub = (Number(r.qty) || 0) * (Number(r.hargaSatuan) || 0)
      const prop = sumSub > 0 ? sub / sumSub : 0
      const riilTotal = sub + ong * prop - dis * prop
      perRow[r.id] = { sub, riilTotal, riilUnit: Number(r.qty) > 0 ? riilTotal / Number(r.qty) : 0 }
    })
    return { sumSub, total: sumSub + ong - dis, perRow }
  }, [rows, ongkir, diskon])

  const validRows = rows.filter((r) => r.nama.trim() && Number(r.qty) > 0)
  const needsMap = status === 'Diterima'
    && validRows.some((r) => (r.klasifikasi === 'BHP' || r.klasifikasi === 'Obat') && !r.kodeMaster)
  const canSave = validRows.length > 0 && calc.sumSub > 0 && !needsMap && !saving

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      const items = validRows.map((r) => ({
        nama: r.nama.trim(), qty: Number(r.qty), hargaSatuan: Number(r.hargaSatuan) || 0,
        klasifikasi: r.klasifikasi, kodeMaster: r.kodeMaster || '',
      }))
      const nota = {
        tanggalPesan, tanggalTerima: status === 'Diterima' ? today : '',
        sumber, supplier, ongkir: Number(ongkir) || 0, diskon: Number(diskon) || 0, status, catatan,
      }
      const res = await api.saveBelanja({ nota, items, user: user.nama })
      onToast('ok', `Belanja tersimpan (${res.items} item, ${rupiah(res.totalNota)}).`)
      // reset
      setRows([newRow()]); setSumber(''); setSupplier(''); setOngkir(''); setDiskon('')
      setStatus('Dipesan'); setCatatan(''); setTanggalPesan(today)
      loadList()
      if (status === 'Diterima') onChanged && onChanged()
    } catch (e) {
      onToast('err', e.message)
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(nota, newStatus) {
    try {
      await api.updateBelanjaStatus({ idBelanja: nota.idBelanja, status: newStatus, tanggalTerima: today, user: user.nama })
      onToast('ok', `Status nota → ${newStatus}.`)
      loadList()
      if (newStatus === 'Diterima') onChanged && onChanged()
    } catch (e) {
      onToast('err', e.message)
    }
  }

  return (
    <div>
      {/* Composer */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="cap">
          <h2>Catat Belanja Baru</h2>
          <button className="linklike" onClick={() => setShowPanduan((v) => !v)}>
            {showPanduan ? 'Tutup panduan' : '❓ Panduan klasifikasi'}
          </button>
        </div>

        {showPanduan && (
          <div className="panduan">
            {PANDUAN_KLAS.map(([k, d]) => (
              <div key={k}><b>{k}</b> — {d}</div>
            ))}
            <div className="muted">Patokan: masa pakai &gt; 1 tahun → kemungkinan <b>Aset</b>. Keputusan akhir di tangan Anda.</div>
          </div>
        )}

        <div className="bform">
          <label>Tanggal pesan<input type="date" value={tanggalPesan} onChange={(e) => setTanggalPesan(e.target.value)} /></label>
          <label>Sumber / No. pesanan<input placeholder="mis. Shopee #1234" value={sumber} onChange={(e) => setSumber(e.target.value)} /></label>
          <label>Supplier<input placeholder="Toko / supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></label>
          <label>Ongkir (Rp)<input type="number" min="0" inputMode="numeric" placeholder="0" value={ongkir} onChange={(e) => setOngkir(e.target.value)} /></label>
          <label>Diskon (Rp)<input type="number" min="0" inputMode="numeric" placeholder="0" value={diskon} onChange={(e) => setDiskon(e.target.value)} /></label>
          <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>

        {/* Item rows */}
        <div className="bitems">
          {rows.map((r, i) => {
            const c = calc.perRow[r.id] || {}
            const isStok = r.klasifikasi === 'BHP' || r.klasifikasi === 'Obat'
            return (
              <div className="bitem" key={r.id}>
                <div className="bitem-main">
                  <input className="bi-nama" placeholder={`Nama barang #${i + 1}`} value={r.nama}
                    onChange={(e) => setRow(r.id, { nama: e.target.value })} onBlur={() => onNamaBlur(r)} />
                  <input className="bi-qty" type="number" min="0" inputMode="numeric" placeholder="qty" value={r.qty}
                    onChange={(e) => setRow(r.id, { qty: e.target.value })} />
                  <input className="bi-harga" type="number" min="0" inputMode="numeric" placeholder="harga satuan" value={r.hargaSatuan}
                    onChange={(e) => setRow(r.id, { hargaSatuan: e.target.value })} />
                  <select className="bi-klas" value={r.klasifikasi}
                    onChange={(e) => setRow(r.id, { klasifikasi: e.target.value, klasTouched: true })}>
                    {KLASIFIKASI.map((k) => <option key={k}>{k}</option>)}
                  </select>
                  <button className="bi-del" title="Hapus baris" onClick={() => delRow(r.id)}>✕</button>
                </div>
                <div className="bitem-sub">
                  {isStok ? (
                    <select className={'bi-map' + (needsMap && !r.kodeMaster ? ' err' : '')} value={r.kodeMaster}
                      onChange={(e) => setRow(r.id, { kodeMaster: e.target.value })}>
                      <option value="">— petakan ke item master (untuk tambah stok) —</option>
                      {MASTER_ITEMS.map((m) => (
                        <option key={m.kode} value={m.kode}>{m.kelompok} · {m.nama} ({m.kode})</option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted">
                      {r.klasifikasi === 'Alkes' ? 'Beban Alkes — tidak menambah stok' : 'Aset — masuk antrian Daftar Aset, tidak menambah stok'}
                    </span>
                  )}
                  {Number(r.qty) > 0 && (
                    <span className="bi-riil">riil {rupiah(c.riilTotal)} · {rupiah(c.riilUnit)}/unit</span>
                  )}
                </div>
              </div>
            )
          })}
          <button className="btn ghost addrow" onClick={addRow}>+ Tambah baris</button>
        </div>

        {/* Totals + save */}
        <div className="btotals">
          <div className="bt-line"><span>Subtotal</span><b>{rupiah(calc.sumSub)}</b></div>
          <div className="bt-line"><span>Ongkir</span><b>{rupiah(Number(ongkir) || 0)}</b></div>
          <div className="bt-line"><span>Diskon</span><b>− {rupiah(Number(diskon) || 0)}</b></div>
          <div className="bt-line total"><span>Total nota</span><b>{rupiah(calc.total)}</b></div>
        </div>
        {needsMap && (
          <div className="bwarn">⚠️ Ada item BHP/Obat berstatus "Diterima" yang belum dipetakan ke master. Petakan dulu agar stok bertambah.</div>
        )}
        <div className="bsave">
          <button className="btn" disabled={!canSave} onClick={handleSave}>
            {saving ? 'Menyimpan…' : 'Simpan Belanja'}
          </button>
        </div>
      </div>

      {/* Daftar nota */}
      <div className="card">
        <div className="cap"><h2>Riwayat Belanja</h2><span className="meta">terbaru di atas</span></div>
        {listErr ? (
          <div className="state err">⚠️ {listErr}<div style={{ marginTop: 8 }}><button className="btn ghost" onClick={loadList}>Coba lagi</button></div></div>
        ) : list === null ? (
          <div className="state"><span className="spin" />Memuat…</div>
        ) : list.length === 0 ? (
          <div className="state">Belum ada belanja tercatat.</div>
        ) : (
          <div className="notalist">
            {list.map((n) => (
              <div className="nota" key={n.idBelanja}>
                <div className="nota-top">
                  <div>
                    <div className="nota-title">{n.sumber || n.supplier || n.idBelanja}</div>
                    <div className="nota-sub">{n.tanggalPesan}{n.tanggalTerima ? ` · diterima ${n.tanggalTerima}` : ''} · {n.items.length} item</div>
                  </div>
                  <div className="nota-right">
                    <span className="nota-total">{rupiah(n.totalNota)}</span>
                    <span className={'badge ' + (STATUS_BADGE[n.status] || 'warn')}>{n.status}</span>
                  </div>
                </div>
                <div className="nota-items">
                  {n.items.map((it) => (
                    <span className="nota-chip" key={it.baris}>
                      {it.nama} ×{it.qty} <i>{it.klasifikasi}{it.kodeMaster ? ` → ${it.kodeMaster}` : ''}</i>
                    </span>
                  ))}
                </div>
                {n.status !== 'Diterima' && (
                  <div className="nota-actions">
                    {n.status === 'Dipesan' && <button className="btn ghost sm" onClick={() => changeStatus(n, 'Dibayar')}>Tandai Dibayar</button>}
                    <button className="btn sm" onClick={() => changeStatus(n, 'Diterima')}>Tandai Diterima</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
