import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { MASTER_ITEMS, KELOMPOK } from './data/masterItems.js'
import * as api from './api.js'

const MODES = [
  { id: 'pakai',  label: 'Pemakaian Hari Ini', sub: 'Isi yang terpakai hari ini', chip: 'b' },
  { id: 'opname', label: 'Stok Opname',         sub: 'Hitung sisa fisik berkala',  chip: 'n' },
  { id: 'masuk',  label: 'Barang Masuk',        sub: 'Catat pembelian diterima',   chip: 'r' },
]

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0))
const BADGE = { aman: ['ok', 'aman'], menipis: ['warn', 'menipis'], low: ['low', 'stok rendah'] }

// Hitung jumlah master per kelompok (fallback sebelum data server datang).
const MASTER_COUNTS = MASTER_ITEMS.reduce((a, m) => ((a[m.kelompok] = (a[m.kelompok] || 0) + 1), a), {})

function todayParts() {
  const tz = 'Asia/Makassar'
  const now = new Date()
  const tanggal = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now) // yyyy-MM-dd
  const lengkap = new Intl.DateTimeFormat('id-ID', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(now)
  const periode = new Intl.DateTimeFormat('id-ID', { timeZone: tz, month: 'long', year: 'numeric' }).format(now)
  return { tanggal, lengkap, periode }
}

export default function App() {
  const { tanggal: today, lengkap, periode } = useMemo(todayParts, [])

  const [myGroup] = useState(() => localStorage.getItem('inv_myGroup') || 'BHP Gigi')
  const [group, setGroup] = useState(myGroup)
  const [mode, setMode] = useState('pakai')

  const [state, setState] = useState(null)   // { tanggal, items, counts }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [inputs, setInputs] = useState({})    // kode -> value (mode-dependent)
  const [supplier, setSupplier] = useState('')
  const [noFaktur, setNoFaktur] = useState('')
  const [query, setQuery] = useState('')
  const [filterSub, setFilterSub] = useState('Semua')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)    // { type, msg }

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3200)
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await api.getState(group, today)
      setState(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [group, today])

  useEffect(() => { load() }, [load])

  // Ganti kelompok/mode → bersihkan input agar tidak tercampur.
  useEffect(() => { setInputs({}); setFilterSub('Semua') }, [group])
  useEffect(() => { setInputs({}); setSupplier(''); setNoFaktur('') }, [mode])

  const items = state?.items || []
  const counts = state?.counts || MASTER_COUNTS

  const subKategoris = useMemo(() => {
    const seen = []
    items.forEach((i) => { if (i.subKategori && !seen.includes(i.subKategori)) seen.push(i.subKategori) })
    return seen
  }, [items])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((i) => {
      if (filterSub !== 'Semua' && i.subKategori !== filterSub) return false
      if (q && !(`${i.nama} ${i.kode} ${i.subKategori}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [items, query, filterSub])

  // Kelompokkan per sub-kategori (urutan kemunculan).
  const grouped = useMemo(() => {
    const map = new Map()
    visible.forEach((i) => {
      const k = i.subKategori || 'Lainnya'
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(i)
    })
    return [...map.entries()]
  }, [visible])

  // ---- input helpers ----
  const setQty = (kode, val) => setInputs((p) => ({ ...p, [kode]: val }))
  const setMasuk = (kode, field, val) =>
    setInputs((p) => ({ ...p, [kode]: { ...(p[kode] || {}), [field]: val } }))
  const stepQty = (kode, delta) =>
    setInputs((p) => {
      const cur = Number(p[kode]) || 0
      const next = Math.max(0, cur + delta)
      return { ...p, [kode]: next ? String(next) : '' }
    })

  // ---- ringkasan savebar ----
  const summary = useMemo(() => {
    if (mode === 'pakai') {
      let n = 0, units = 0
      Object.values(inputs).forEach((v) => { const x = Number(v); if (x > 0) { n++; units += x } })
      return { n, text: `${n} item terisi · total ${units} unit dipakai`, canSave: n > 0 }
    }
    if (mode === 'opname') {
      let n = 0
      Object.values(inputs).forEach((v) => { if (v !== '' && v != null && !isNaN(Number(v))) n++ })
      return { n, text: `${n} item dihitung fisik`, canSave: n > 0 }
    }
    // masuk
    let n = 0, total = 0
    Object.values(inputs).forEach((v) => {
      const q = Number(v?.qty), h = Number(v?.harga)
      if (q > 0) { n++; total += q * (h || 0) }
    })
    return { n, text: `${n} item · total ${rupiah(total)}`, canSave: n > 0 }
  }, [inputs, mode])

  async function handleSave() {
    if (!summary.canSave || saving) return
    setSaving(true)
    try {
      let res
      if (mode === 'pakai') {
        const lines = Object.entries(inputs)
          .map(([kode, v]) => ({ kode, qty: Number(v) }))
          .filter((l) => l.qty > 0)
        res = await api.savePakai({ kelompok: group, tanggal: today, lines })
      } else if (mode === 'opname') {
        const lines = Object.entries(inputs)
          .filter(([, v]) => v !== '' && v != null && !isNaN(Number(v)))
          .map(([kode, v]) => ({ kode, stokFisik: Number(v) }))
        res = await api.saveOpname({ kelompok: group, tanggal: today, lines })
      } else {
        const lines = Object.entries(inputs)
          .map(([kode, v]) => ({ kode, qty: Number(v?.qty), harga: Number(v?.harga) || 0, supplier, noFaktur }))
          .filter((l) => l.qty > 0)
        res = await api.saveMasuk({ kelompok: group, tanggal: today, lines })
      }
      showToast('ok', `Tersimpan: ${res.tersimpan} item.`)
      setInputs({}); setSupplier(''); setNoFaktur('')
      await load()
    } catch (e) {
      showToast('err', e.message)
    } finally {
      setSaving(false)
    }
  }

  const modeMeta = MODES.find((m) => m.id === mode)

  return (
    <>
      <header>
        <div className="hrow">
          <div className="brand">
            <span className="dot">📦</span>
            <div>KLINIKTA Inventory<small>Stok BHP &amp; Obat</small></div>
          </div>
          <div className="period">{periode}</div>
        </div>
      </header>

      <div className="wrap">
        {/* Group switcher */}
        <div className="groups">
          <span className="glabel">Kelompok:</span>
          {KELOMPOK.map((g) => (
            <button
              key={g}
              className={'gbtn' + (g === group ? ' active' : '')}
              onClick={() => setGroup(g)}
            >
              {g} <span className="cnt">{counts[g] ?? MASTER_COUNTS[g] ?? ''}</span>
            </button>
          ))}
        </div>
        <div className="crossnote">
          Anda pegang <b>{myGroup}</b>. Bisa lihat kelompok lain untuk cek agar tidak input ganda.
        </div>

        {/* Mode tabs */}
        <div className="tabs">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={'tab' + (m.id === mode ? ' active' : '')}
              onClick={() => setMode(m.id)}
            >
              <div className="t-top"><span className={'chip ' + m.chip} />{m.label}</div>
              <div className="t-sub">{m.sub}</div>
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="toolbar">
          <div className="search">
            🔍<input
              placeholder="Cari item… (mis. komposit, paper point)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            className={'filter' + (filterSub === 'Semua' ? ' on' : '')}
            onClick={() => setFilterSub('Semua')}
          >Semua</button>
          {subKategoris.map((s) => (
            <button
              key={s}
              className={'filter' + (filterSub === s ? ' on' : '')}
              onClick={() => setFilterSub(s)}
            >{s}</button>
          ))}
        </div>

        {/* Supplier batch (mode Barang Masuk) */}
        {mode === 'masuk' && (
          <div className="toolbar">
            <div className="search" style={{ flex: 1 }}>
              🏷️<input placeholder="Supplier (opsional, berlaku semua baris)" value={supplier}
                onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <div className="search" style={{ flex: 1 }}>
              🧾<input placeholder="No. faktur (opsional)" value={noFaktur}
                onChange={(e) => setNoFaktur(e.target.value)} />
            </div>
          </div>
        )}

        {/* Grid */}
        <div className="card">
          <div className="cap">
            <h2>{modeMeta.label} · {lengkap}</h2>
            <span className="meta">{group} · {visible.length} item</span>
          </div>

          {loading ? (
            <div className="state"><span className="spin" />Memuat data…</div>
          ) : error ? (
            <div className="state err">
              ⚠️ {error}
              <div style={{ marginTop: 10 }}>
                <button className="btn ghost" onClick={load}>Coba lagi</button>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="state">Tidak ada item cocok.</div>
          ) : (
            <>
              <DesktopTable grouped={grouped} mode={mode} inputs={inputs}
                setQty={setQty} setMasuk={setMasuk} />
              <MobileList grouped={grouped} mode={mode} inputs={inputs}
                setQty={setQty} setMasuk={setMasuk} stepQty={stepQty} />
            </>
          )}
        </div>

        <p className="note">
          Tahap 1 — BHP Gigi. Data tersimpan ke Google Sheets (bukan di HP ini),
          jadi bisa dibuka dari HP & laptop mana pun.
        </p>
      </div>

      {/* Sticky save */}
      <div className="savebar">
        <div className="sum">{summary.text}</div>
        <div className="actions">
          <button className="btn ghost" disabled={!summary.canSave || saving}
            onClick={() => { setInputs({}); setSupplier(''); setNoFaktur('') }}>Reset</button>
          <button className="btn" disabled={!summary.canSave || saving} onClick={handleSave}>
            {saving ? 'Menyimpan…' : saveLabel(mode)}
          </button>
        </div>
      </div>

      {toast && <div className={'toast ' + toast.type}>{toast.msg}</div>}
    </>
  )
}

function saveLabel(mode) {
  return mode === 'pakai' ? 'Simpan Pemakaian' : mode === 'opname' ? 'Simpan Opname' : 'Simpan Barang Masuk'
}

function Badge({ status }) {
  const [cls, txt] = BADGE[status] || BADGE.aman
  return <span className={'badge ' + cls}>{txt}</span>
}

function StokLabel({ it }) {
  return (
    <span className="stk">{it.stok} <span className="unit">{it.satuan}</span> <Badge status={it.status} /></span>
  )
}

// ---------------- Desktop table ----------------
function DesktopTable({ grouped, mode, inputs, setQty, setMasuk }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>{mode === 'opname' ? 'Stok Sistem' : 'Stok Saat Ini'}</th>
          {mode === 'pakai' && <th className="num">Pemakaian Hari Ini</th>}
          {mode === 'opname' && <th className="num">Stok Fisik</th>}
          {mode === 'masuk' && <th className="masuk">Jumlah Masuk + Harga/Unit</th>}
        </tr>
      </thead>
      <tbody>
        {grouped.map(([sub, list]) => (
          <React.Fragment key={sub}>
            <tr className="grp"><td colSpan={3}>{sub}</td></tr>
            {list.map((it) => (
              <tr key={it.kode}>
                <td>
                  <div className="item-name">
                    {it.nama}
                    {it.metode === 'Detail' && <span className="tag-detail">DETAIL</span>}
                  </div>
                  <div className="item-sub">{it.satuan}{it.kemasan && it.kemasan !== '-' ? ` · ${it.kemasan}` : ''}</div>
                </td>
                <td><StokLabel it={it} /></td>
                {mode === 'pakai' && (
                  <td className="num">
                    <input
                      type="number" min="0" inputMode="numeric"
                      className={'qty' + (Number(inputs[it.kode]) > 0 ? ' filled' : '')}
                      placeholder="0" value={inputs[it.kode] ?? ''}
                      onChange={(e) => setQty(it.kode, e.target.value)}
                    />
                  </td>
                )}
                {mode === 'opname' && (
                  <td className="num">
                    <input
                      type="number" min="0" inputMode="numeric"
                      className={'qty' + (inputs[it.kode] !== '' && inputs[it.kode] != null ? ' filled' : '')}
                      placeholder={String(it.stok)} value={inputs[it.kode] ?? ''}
                      onChange={(e) => setQty(it.kode, e.target.value)}
                    />
                    {inputs[it.kode] !== '' && inputs[it.kode] != null && !isNaN(Number(inputs[it.kode])) && (
                      <div className="rowtotal">
                        selisih {Number(inputs[it.kode]) - it.stok > 0 ? '+' : ''}{Number(inputs[it.kode]) - it.stok}
                      </div>
                    )}
                  </td>
                )}
                {mode === 'masuk' && (
                  <td className="num">
                    <div className="masukcell">
                      <input
                        type="number" min="0" inputMode="numeric"
                        className={'qty' + (Number(inputs[it.kode]?.qty) > 0 ? ' filled' : '')}
                        placeholder="0 jumlah" value={inputs[it.kode]?.qty ?? ''}
                        onChange={(e) => setMasuk(it.kode, 'qty', e.target.value)}
                      />
                      <input
                        type="number" min="0" inputMode="numeric" className="price"
                        placeholder={`Rp ${it.hargaAcuan || 0}`} value={inputs[it.kode]?.harga ?? ''}
                        onChange={(e) => setMasuk(it.kode, 'harga', e.target.value)}
                      />
                      {Number(inputs[it.kode]?.qty) > 0 && (
                        <div className="rowtotal">
                          {rupiah(Number(inputs[it.kode]?.qty) * (Number(inputs[it.kode]?.harga) || it.hargaAcuan || 0))}
                        </div>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  )
}

// ---------------- Mobile list ----------------
function MobileList({ grouped, mode, inputs, setQty, setMasuk, stepQty }) {
  return (
    <div className="mlist">
      {grouped.map(([sub, list]) => (
        <React.Fragment key={sub}>
          <div className="grp" style={{ padding: '7px 13px' }}>{sub}</div>
          {list.map((it) =>
            mode === 'masuk' ? (
              <div className="mcard-masuk" key={it.kode}>
                <div className="mtop">
                  <div className="info">
                    <div className="n">{it.nama}{it.metode === 'Detail' && <span className="tag-detail">DETAIL</span>}</div>
                    <div className="s">{it.stok} {it.satuan} <Badge status={it.status} /></div>
                  </div>
                </div>
                <div className="mfields">
                  <input type="number" min="0" inputMode="numeric" placeholder="Jumlah masuk"
                    value={inputs[it.kode]?.qty ?? ''} onChange={(e) => setMasuk(it.kode, 'qty', e.target.value)} />
                  <input type="number" min="0" inputMode="numeric" placeholder={`Harga/unit (${rupiah(it.hargaAcuan)})`}
                    value={inputs[it.kode]?.harga ?? ''} onChange={(e) => setMasuk(it.kode, 'harga', e.target.value)} />
                </div>
                {Number(inputs[it.kode]?.qty) > 0 && (
                  <div className="rowtotal" style={{ marginTop: 6 }}>
                    Total {rupiah(Number(inputs[it.kode]?.qty) * (Number(inputs[it.kode]?.harga) || it.hargaAcuan || 0))}
                  </div>
                )}
              </div>
            ) : (
              <div className="mcard" key={it.kode}>
                <div className="info">
                  <div className="n">{it.nama}{it.metode === 'Detail' && <span className="tag-detail">DETAIL</span>}</div>
                  <div className="s">
                    {mode === 'opname' ? <>sistem {it.stok} {it.satuan}</> : <>{it.stok} {it.satuan}</>} <Badge status={it.status} />
                    {mode === 'opname' && inputs[it.kode] !== '' && inputs[it.kode] != null && !isNaN(Number(inputs[it.kode])) && (
                      <span className="rowtotal">selisih {Number(inputs[it.kode]) - it.stok > 0 ? '+' : ''}{Number(inputs[it.kode]) - it.stok}</span>
                    )}
                  </div>
                </div>
                {mode === 'pakai' ? (
                  <div className="mqty">
                    <button onClick={() => stepQty(it.kode, -1)}>−</button>
                    <input type="number" min="0" inputMode="numeric" placeholder="0"
                      value={inputs[it.kode] ?? ''} onChange={(e) => setQty(it.kode, e.target.value)} />
                    <button onClick={() => stepQty(it.kode, +1)}>+</button>
                  </div>
                ) : (
                  <div className="mqty">
                    <input type="number" min="0" inputMode="numeric" style={{ borderRadius: 9, borderLeft: '1.5px solid var(--line)', borderRight: '1.5px solid var(--line)', width: 70 }}
                      placeholder={String(it.stok)} value={inputs[it.kode] ?? ''} onChange={(e) => setQty(it.kode, e.target.value)} />
                  </div>
                )}
              </div>
            )
          )}
        </React.Fragment>
      ))}
    </div>
  )
}
