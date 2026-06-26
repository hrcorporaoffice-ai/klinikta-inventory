import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { MASTER_ITEMS, KELOMPOK } from './data/masterItems.js'
import * as api from './api.js'
import Belanja from './components/Belanja.jsx'
import Rekap from './components/Rekap.jsx'
import Admin from './components/Admin.jsx'

const MODES = [
  { id: 'pakai',   label: 'Pemakaian Hari Ini', sub: 'Isi yang terpakai hari ini', chip: 'b' },
  { id: 'opname',  label: 'Stok Opname',         sub: 'Hitung sisa fisik berkala',  chip: 'n' },
  { id: 'belanja', label: 'Belanja & Terima',    sub: 'Catat belanja & penerimaan', chip: 'r' },
  { id: 'rekap',   label: 'Rekap → LAPKEU',      sub: 'Angka siap salin Akoontan',  chip: 'n' },
]
const GRID_MODES = ['pakai', 'opname']  // mode yang pakai grid item + savebar

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
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('inv_user') || 'null') } catch { return null }
  })

  if (!user) {
    return <Login onLogin={(u) => { localStorage.setItem('inv_user', JSON.stringify(u)); setUser(u) }} />
  }
  return (
    <InventoryApp
      user={user}
      onLogout={() => { localStorage.removeItem('inv_user'); setUser(null) }}
    />
  )
}

function InventoryApp({ user, onLogout }) {
  const { tanggal: today, lengkap, periode } = useMemo(todayParts, [])

  const myGroup = user.kelompok || 'BHP Gigi'
  const [group, setGroup] = useState(myGroup)
  const [mode, setMode] = useState('pakai')

  const [state, setState] = useState(null)   // { tanggal, items, counts }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [inputs, setInputs] = useState({})    // kode -> value (mode-dependent)
  const [query, setQuery] = useState('')
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
  useEffect(() => { setInputs({}) }, [group])
  useEffect(() => { setInputs({}) }, [mode])

  const items = state?.items || []
  const counts = state?.counts || MASTER_COUNTS

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => `${i.nama} ${i.kode} ${i.subKategori}`.toLowerCase().includes(q))
  }, [items, query])

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
    // opname
    let n = 0
    Object.values(inputs).forEach((v) => { if (v !== '' && v != null && !isNaN(Number(v))) n++ })
    return { n, text: `${n} item dihitung fisik`, canSave: n > 0 }
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
        res = await api.savePakai({ kelompok: group, tanggal: today, user: user.nama, lines })
      } else {
        const lines = Object.entries(inputs)
          .filter(([, v]) => v !== '' && v != null && !isNaN(Number(v)))
          .map(([kode, v]) => ({ kode, stokFisik: Number(v) }))
        res = await api.saveOpname({ kelompok: group, tanggal: today, user: user.nama, lines })
      }
      showToast('ok', `Tersimpan: ${res.tersimpan} item.`)
      setInputs({})
      await load()
    } catch (e) {
      showToast('err', e.message)
    } finally {
      setSaving(false)
    }
  }

  const isAdmin = String(user.peran || '').split(',').map((r) => r.trim()).includes('admin')
  const modes = isAdmin
    ? [...MODES, { id: 'admin', label: 'Admin', sub: 'Kelola data & staf', chip: 'r' }]
    : MODES
  const modeMeta = modes.find((m) => m.id === mode) || MODES[0]
  const isGrid = GRID_MODES.includes(mode)

  return (
    <>
      <header>
        <div className="hrow">
          <div className="brand">
            <span className="dot">📦</span>
            <div>KLINIKTA Inventory<small>Stok BHP &amp; Obat</small></div>
          </div>
          <div className="huser">
            <span className="period">{periode}</span>
            <span className="who" title="Staf yang login">👤 {user.nama}</span>
            <button className="logout" onClick={onLogout}>Ganti</button>
          </div>
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
          {modes.map((m) => (
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

        {isGrid ? (
          <>
            {/* Toolbar — cukup kotak pencarian */}
            <div className="toolbar">
              <div className="search">
                🔍<input
                  placeholder="Cari item… (mis. komposit, paper point, endo)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>

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
                  <DesktopTable grouped={grouped} mode={mode} inputs={inputs} setQty={setQty} />
                  <MobileList grouped={grouped} mode={mode} inputs={inputs} setQty={setQty} stepQty={stepQty} />
                </>
              )}
            </div>

            <p className="note">
              Data tersimpan ke Google Sheets (bukan di HP ini), jadi bisa dibuka dari HP &amp; laptop mana pun.
            </p>
          </>
        ) : mode === 'belanja' ? (
          <Belanja user={user} today={today} onToast={showToast} onChanged={load} />
        ) : mode === 'admin' ? (
          <Admin user={user} onToast={showToast} />
        ) : (
          <Rekap today={today} onToast={showToast} />
        )}
      </div>

      {/* Sticky save — hanya untuk mode grid (Pemakaian/Opname) */}
      {isGrid && (
        <div className="savebar">
          <div className="sum">{summary.text}</div>
          <div className="actions">
            <button className="btn ghost" disabled={!summary.canSave || saving}
              onClick={() => setInputs({})}>Reset</button>
            <button className="btn" disabled={!summary.canSave || saving} onClick={handleSave}>
              {saving ? 'Menyimpan…' : saveLabel(mode)}
            </button>
          </div>
        </div>
      )}

      {toast && <div className={'toast ' + toast.type}>{toast.msg}</div>}
    </>
  )
}

// ---------------- Login (pemilih staf + PIN ringan) ----------------
const splitP = (p) => String(p || 'staf').split(',').map((r) => r.trim()).filter(Boolean)

function Login({ onLogin }) {
  const [users, setUsers] = useState(null)
  const [nama, setNama] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const pinRef = useRef(null)

  useEffect(() => {
    api.getUsers()
      .then((list) => setUsers(list))
      .catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (nama) { setPin(''); setErr(''); setTimeout(() => pinRef.current?.focus(), 50) }
  }, [nama])

  async function doLogin(loginNama, loginPin) {
    if (!loginNama || !loginPin || busy) return
    setBusy(true); setErr('')
    try {
      const u = await api.login({ nama: loginNama, pin: loginPin })
      onLogin(u)
    } catch (e2) {
      setErr(e2.message); setBusy(false); setPin('')
      setTimeout(() => pinRef.current?.focus(), 50)
    }
  }

  function handlePinChange(e) {
    const val = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(val); setErr('')
    if (val.length === 4 && nama && !busy) doLogin(nama, val)
  }

  const admins = (users || []).filter((u) => splitP(u.peran).includes('admin'))
  const staf   = (users || []).filter((u) => !splitP(u.peran).includes('admin'))

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={(e) => { e.preventDefault(); doLogin(nama, pin) }}>

        {/* Brand row: logo + nama klinik (horizontal, persis seperti absensi) */}
        <div className="login-brand-row">
          <div className="login-logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M16 3L29 10v12L16 29 3 22V10L16 3z" fill="rgba(255,255,255,.18)" stroke="white" strokeWidth="1.8" strokeLinejoin="round"/>
              <path d="M3 10l13 7.5L29 10M16 17.5V29" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              <line x1="16" y1="11" x2="16" y2="20" stroke="white" strokeWidth="1.4"/>
              <line x1="12" y1="15.5" x2="20" y2="15.5" stroke="white" strokeWidth="1.4"/>
            </svg>
          </div>
          <div className="login-brand-text">
            <div className="login-title">KLINIKTA</div>
            <div className="login-tagline">KLINIK KITA SEMUA</div>
          </div>
        </div>

        <div className="login-module">Inventory · Stok BHP &amp; Obat</div>

        {users === null && !err ? (
          <div className="state"><span className="spin" />Memuat daftar staf…</div>
        ) : (
          <>
            <select className="login-input login-select" value={nama} onChange={(e) => setNama(e.target.value)} autoFocus={!nama}>
              <option value="">— Pilih nama kamu —</option>
              {staf.map((u) => <option key={u.nama} value={u.nama}>{u.nama}</option>)}
              {admins.length > 0 && (
                <optgroup label="Admin / Manager">
                  {admins.map((u) => <option key={u.nama} value={u.nama}>👤 {u.nama}</option>)}
                </optgroup>
              )}
            </select>

            {nama && (
              <div className="pin-wrap">
                <div className="pin-label">Masukan PIN 4 digit</div>
                <div className="pin-boxes" onClick={() => pinRef.current?.focus()}>
                  {[0,1,2,3].map((i) => (
                    <div key={i} className={'pin-box' + (pin.length === i && !busy ? ' active' : '') + (pin.length > i ? ' filled' : '')}>
                      {pin.length > i ? '•' : ''}
                    </div>
                  ))}
                  <input
                    ref={pinRef}
                    className="pin-overlay-input"
                    type="password" inputMode="numeric"
                    autoComplete="off" maxLength={4}
                    value={pin} onChange={handlePinChange}
                  />
                </div>
              </div>
            )}

            <button className="btn login-btn" type="submit" disabled={busy || !nama || pin.length < 1}>
              {busy ? 'Memeriksa…' : 'Masuk →'}
            </button>
          </>
        )}

        {err && <div className="login-err">{err}</div>}
      </form>
    </div>
  )
}

function saveLabel(mode) {
  return mode === 'pakai' ? 'Simpan Pemakaian' : 'Simpan Opname'
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
function DesktopTable({ grouped, mode, inputs, setQty }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>{mode === 'opname' ? 'Stok Sistem' : 'Stok Saat Ini'}</th>
          {mode === 'pakai' && <th className="num">Pemakaian Hari Ini</th>}
          {mode === 'opname' && <th className="num">Stok Fisik</th>}
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
              </tr>
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  )
}

// ---------------- Mobile list ----------------
function MobileList({ grouped, mode, inputs, setQty, stepQty }) {
  return (
    <div className="mlist">
      {grouped.map(([sub, list]) => (
        <React.Fragment key={sub}>
          <div className="grp" style={{ padding: '7px 13px' }}>{sub}</div>
          {list.map((it) => (
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
