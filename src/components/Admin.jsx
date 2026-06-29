import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api.js'
import { BRAND_DEFAULT, FONTS, applyTheme } from '../brand.js'

const KELOMPOK = ['BHP Gigi', 'BHP Umum', 'Obat', 'Alkes', 'ATK']
const PERAN = ['logistik', 'bendahara', 'penerima', 'admin']
const splitPeran = (p) => String(p || 'staf').split(',').map((r) => r.trim()).filter(Boolean)
const joinPeran = (arr) => arr.length ? arr.join(',') : 'staf'
const SECTIONS = [
  ['master', 'Item Master'],
  ['staf', 'Staf & PIN'],
  ['kw', 'Kata Kunci Klasifikasi'],
  ['log', 'Aktivitas'],
  ['tampilan', 'Tampilan'],
  ['ekspor', 'Ekspor'],
]

export default function Admin({ user, onToast, onBrandSaved }) {
  const [sec, setSec] = useState('master')
  return (
    <div className="card">
      <div className="cap"><h2>Panel Admin</h2><span className="meta">peran: {user.peran}</span></div>
      <div className="admin-tabs">
        {SECTIONS.map(([id, label]) => (
          <button key={id} className={'admin-tab' + (sec === id ? ' on' : '')} onClick={() => setSec(id)}>{label}</button>
        ))}
      </div>
      <div className="admin-body">
        {sec === 'master' && <MasterAdmin user={user} onToast={onToast} />}
        {sec === 'staf' && <StafAdmin user={user} onToast={onToast} />}
        {sec === 'kw' && <KeywordAdmin user={user} onToast={onToast} />}
        {sec === 'log' && <ActivityLog onToast={onToast} />}
        {sec === 'tampilan' && <BrandPanel user={user} onToast={onToast} onSaved={onBrandSaved} />}
        {sec === 'ekspor' && <Ekspor user={user} onToast={onToast} />}
      </div>
    </div>
  )
}

// ---------------- Tampilan (brand: logo, warna, font) ----------------
function BrandPanel({ user, onToast, onSaved }) {
  const [brand, setBrand] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => { api.getBrand().then(setBrand).catch((e) => onToast('err', e.message)) }, [])

  if (!brand) return <div className="state"><span className="spin" />Memuat…</div>

  // Ubah + pratinjau langsung (warna/font terlihat seketika di seluruh app).
  const change = (patch) => { const next = { ...brand, ...patch }; setBrand(next); applyTheme(next) }

  function onLogoFile(file) {
    if (!file) return
    if (file.size > 500 * 1024) { onToast('err', 'Logo terlalu besar (maks ~500KB). Kompres dulu.'); return }
    const r = new FileReader()
    r.onload = () => change({ logo: String(r.result) })
    r.readAsDataURL(file)
  }
  async function save() {
    setBusy(true)
    try {
      await api.saveBrand({ user: user.nama, brand })
      onToast('ok', 'Tampilan disimpan.')
      onSaved && onSaved()
    } catch (e) { onToast('err', e.message) } finally { setBusy(false) }
  }
  function resetDefault() {
    const d = { ...BRAND_DEFAULT }
    setBrand(d); applyTheme(d)
  }

  const hasLogo = !!brand.logo
  return (
    <div className="admin-form">
      <p className="rekap-sub">Atur logo, warna, dan font aplikasi. Perubahan tampil langsung sebagai pratinjau; klik <b>Simpan</b> agar berlaku untuk semua perangkat.</p>

      {/* Logo */}
      <div className="brand-logo-row">
        <div className="brand-logo-prev">
          {hasLogo ? <img src={brand.logo} alt="logo" /> : <span className="brand-logo-empty">📦</span>}
        </div>
        <div className="brand-logo-actions">
          <div className="bform-label">Logo</div>
          <div className="actions">
            <button className="btn ghost sm" onClick={() => fileRef.current?.click()}>{hasLogo ? 'Ganti Logo' : 'Unggah Logo'}</button>
            {hasLogo && <button className="btn ghost sm" onClick={() => change({ logo: '' })}>Hapus</button>}
          </div>
          <div className="muted sm" style={{ marginTop: 4 }}>PNG/JPG, maks ~500KB. Kosong = ikon bawaan.</div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onLogoFile(e.target.files[0])} />
        </div>
      </div>

      {/* Teks brand */}
      <div className="bform">
        <label>Nama Aplikasi<input value={brand.title} onChange={(e) => change({ title: e.target.value })} /></label>
        <label>Tagline<input value={brand.tagline} onChange={(e) => change({ tagline: e.target.value })} /></label>
        <label>Subjudul<input value={brand.subtitle} onChange={(e) => change({ subtitle: e.target.value })} /></label>
        <label>Font
          <select value={brand.font} onChange={(e) => change({ font: e.target.value })}>
            {Object.entries(FONTS).map(([id, f]) => <option key={id} value={id}>{f.label}</option>)}
          </select>
        </label>
        <label>Warna Utama
          <div className="color-pick">
            <input type="color" value={brand.colorPrimary} onChange={(e) => change({ colorPrimary: e.target.value })} />
            <input className="hex" value={brand.colorPrimary} onChange={(e) => change({ colorPrimary: e.target.value })} />
          </div>
        </label>
        <label>Warna Aksen
          <div className="color-pick">
            <input type="color" value={brand.colorAccent} onChange={(e) => change({ colorAccent: e.target.value })} />
            <input className="hex" value={brand.colorAccent} onChange={(e) => change({ colorAccent: e.target.value })} />
          </div>
        </label>
      </div>

      <div className="bsave">
        <button className="btn ghost" onClick={resetDefault}>Reset ke Bawaan</button>
        <button className="btn" disabled={busy} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
      </div>
    </div>
  )
}

// ---------------- Master ----------------
const emptyItem = { kode: '', nama: '', kelompok: 'BHP Gigi', subKategori: '', satuan: '', kemasan: '', hargaAcuan: '', metode: 'Praktis', titikReorder: 1, aktif: true }

function MasterAdmin({ user, onToast }) {
  const [items, setItems] = useState(null)
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null) // item being edited/added
  const [busy, setBusy] = useState(false)

  const load = () => api.getMasterAll().then(setItems).catch((e) => onToast('err', e.message))
  useEffect(() => { load() }, [])

  const filtered = (items || []).filter((m) => !q || `${m.nama} ${m.kode} ${m.kelompok} ${m.subKategori}`.toLowerCase().includes(q.toLowerCase()))

  // Saran sub-kategori: ambil nilai unik dari items yang kelompoknya sama.
  const subKatOptions = useMemo(() => {
    if (!items) return []
    return [...new Set(
      items.filter((m) => m.kelompok === (edit?.kelompok || '') && m.subKategori)
           .map((m) => String(m.subKategori).trim())
    )].sort()
  }, [items, edit?.kelompok])

  async function save() {
    if (!edit.nama.trim() || !edit.kelompok) { onToast('err', 'Nama & kelompok wajib.'); return }
    setBusy(true)
    try {
      await api.saveMaster({ user: user.nama, item: edit })
      onToast('ok', edit.kode ? 'Item diperbarui.' : 'Item baru ditambahkan.')
      setEdit(null); load()
    } catch (e) { onToast('err', e.message) } finally { setBusy(false) }
  }

  async function del() {
    if (!edit.kode) return
    if (!window.confirm(`Hapus item "${edit.nama}" (${edit.kode}) dari master?\n\nRiwayat transaksi lama tetap tersimpan. Jika item ini masih dipakai, sebaiknya set "Nonaktif" saja daripada dihapus.`)) return
    setBusy(true)
    try {
      await api.deleteMaster({ user: user.nama, kode: edit.kode })
      onToast('ok', 'Item dihapus.')
      setEdit(null); load()
    } catch (e) { onToast('err', e.message) } finally { setBusy(false) }
  }

  if (edit) {
    return (
      <div className="admin-form">
        <h3 className="rekap-h">{edit.kode ? `Ubah ${edit.kode}` : 'Tambah Item Master'}</h3>
        <div className="bform">
          <label>Nama<input value={edit.nama} onChange={(e) => setEdit({ ...edit, nama: e.target.value })} /></label>
          <label>Kelompok<select value={edit.kelompok} onChange={(e) => setEdit({ ...edit, kelompok: e.target.value })}>{KELOMPOK.map((k) => <option key={k}>{k}</option>)}</select></label>
          <label>Sub-kategori
            <input
              list="subkat-opts"
              value={edit.subKategori}
              onChange={(e) => setEdit({ ...edit, subKategori: e.target.value })}
              placeholder="Pilih saran atau ketik baru…"
            />
            <datalist id="subkat-opts">
              {subKatOptions.map((s) => <option key={s} value={s} />)}
            </datalist>
          </label>
          <label>Satuan<input value={edit.satuan} onChange={(e) => setEdit({ ...edit, satuan: e.target.value })} /></label>
          <label>Isi/Kemasan<input value={edit.kemasan} onChange={(e) => setEdit({ ...edit, kemasan: e.target.value })} /></label>
          <label>Harga acuan (Rp)<input type="number" min="0" value={edit.hargaAcuan} onChange={(e) => setEdit({ ...edit, hargaAcuan: e.target.value })} /></label>
          <label>Metode<select value={edit.metode} onChange={(e) => setEdit({ ...edit, metode: e.target.value })}><option>Praktis</option><option>Detail</option></select></label>
          <label>Titik reorder<input type="number" min="0" value={edit.titikReorder} onChange={(e) => setEdit({ ...edit, titikReorder: e.target.value })} /></label>
          <label>Aktif<select value={edit.aktif ? '1' : '0'} onChange={(e) => setEdit({ ...edit, aktif: e.target.value === '1' })}><option value="1">Aktif</option><option value="0">Nonaktif</option></select></label>
        </div>
        <div className="bsave">
          {edit.kode && <button className="btn danger" disabled={busy} onClick={del} style={{ marginRight: 'auto' }}>Hapus</button>}
          <button className="btn ghost" onClick={() => setEdit(null)}>Batal</button>
          <button className="btn" disabled={busy} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="toolbar">
        <div className="search">🔍<input placeholder="Cari item master…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn sm" onClick={() => setEdit({ ...emptyItem })}>+ Tambah Item</button>
      </div>
      {items === null ? <div className="state"><span className="spin" />Memuat…</div> : (
        <div className="admin-list">
          {filtered.map((m) => (
            <div className={'admin-row' + (m.aktif ? '' : ' off')} key={m.kode}>
              <div><b>{m.nama}</b> <span className="muted">{m.kode} · {m.kelompok} · {m.subKategori}</span></div>
              <button className="linklike" onClick={() => setEdit({ ...emptyItem, ...m, hargaAcuan: m.hargaAcuan || '', titikReorder: m.titikReorder || '' })}>Ubah</button>
            </div>
          ))}
          <div className="muted sm" style={{ padding: '8px 2px' }}>{filtered.length} item</div>
        </div>
      )}
    </div>
  )
}

// ---------------- Multi-select dropdown peran ----------------
function MultiSelect({ value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = splitPeran(value)

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const toggle = (p) => {
    const next = selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p]
    onChange(joinPeran(next))
  }

  return (
    <div className="multisel" ref={ref}>
      <div className={'multisel-btn' + (open ? ' open' : '')} onClick={() => setOpen((v) => !v)}>
        <span className={selected.length ? '' : 'muted'}>{selected.length ? selected.join(', ') : '— pilih peran —'}</span>
        <span className="multisel-arrow">{open ? '▴' : '▾'}</span>
      </div>
      {open && (
        <div className="multisel-list">
          {options.map((p) => (
            <label key={p} className={'multisel-opt' + (selected.includes(p) ? ' on' : '')} onClick={() => toggle(p)}>
              <span className={'multisel-check' + (selected.includes(p) ? ' on' : '')} />
              {p}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------- Staf ----------------
const emptyStaf = { nama: '', pin: '', peran: 'logistik', aktif: true }

function StafAdmin({ user, onToast }) {
  const [list, setList] = useState(null)
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.getUsers().then(setList).catch((e) => onToast('err', e.message))
  useEffect(() => { load() }, [])

  async function save() {
    if (!edit.nama.trim()) { onToast('err', 'Nama wajib.'); return }
    setBusy(true)
    try {
      await api.saveUser({ user: user.nama, staf: edit })
      onToast('ok', 'Staf disimpan.')
      setEdit(null); load()
    } catch (e) { onToast('err', e.message) } finally { setBusy(false) }
  }

  if (edit) {
    return (
      <div className="admin-form">
        <h3 className="rekap-h">{edit.originalNama ? `Ubah ${edit.originalNama}` : 'Tambah Staf'}</h3>
        <div className="bform">
          <label>Nama<input value={edit.nama} onChange={(e) => setEdit({ ...edit, nama: e.target.value })} /></label>
          <label>PIN{edit.originalNama ? ' (kosongkan = tetap)' : ''}<input value={edit.pin} onChange={(e) => setEdit({ ...edit, pin: e.target.value })} /></label>
          <label>Peran
            <MultiSelect value={edit.peran} options={PERAN} onChange={(v) => setEdit({ ...edit, peran: v })} />
          </label>
          <label>Status
            <select value={edit.aktif ? '1' : '0'} onChange={(e) => setEdit({ ...edit, aktif: e.target.value === '1' })}>
              <option value="1">Aktif</option>
              <option value="0">Nonaktif</option>
            </select>
          </label>
        </div>
        <div className="bsave">
          <button className="btn ghost" onClick={() => setEdit(null)}>Batal</button>
          <button className="btn" disabled={busy} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="toolbar"><button className="btn sm" onClick={() => setEdit({ ...emptyStaf })}>+ Tambah Staf</button></div>
      {list === null ? <div className="state"><span className="spin" />Memuat…</div> : (
        <div className="admin-list">
          {list.map((u) => (
            <div className="admin-row" key={u.nama}>
              <div><b>{u.nama}</b> <span className="muted">{u.peran}</span></div>
              <button className="linklike" onClick={() => setEdit({ ...emptyStaf, nama: u.nama, peran: u.peran, originalNama: u.nama, pin: '' })}>Ubah</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------- Keywords ----------------
const KLAS = ['BHP', 'Obat', 'Alkes', 'Aset']

function KeywordAdmin({ user, onToast }) {
  const [kws, setKws] = useState(null)
  const [klas, setKlas] = useState('Aset')
  const [kw, setKw] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.getSettings().then((s) => setKws(s.keywords || [])).catch((e) => onToast('err', e.message))
  useEffect(() => { load() }, [])

  async function add() {
    if (!kw.trim()) return
    setBusy(true)
    try { await api.saveKeyword({ user: user.nama, klasifikasi: klas, keyword: kw.trim() }); setKw(''); load() }
    catch (e) { onToast('err', e.message) } finally { setBusy(false) }
  }
  async function del(k) {
    try { await api.deleteKeyword({ user: user.nama, klasifikasi: k.klasifikasi, keyword: k.keyword }); load() }
    catch (e) { onToast('err', e.message) }
  }

  return (
    <div>
      <p className="rekap-sub">Kata kunci untuk tebakan klasifikasi otomatis saat logistik memasukkan barang ke stok.</p>
      <div className="toolbar">
        <select className="filter" value={klas} onChange={(e) => setKlas(e.target.value)}>{KLAS.map((k) => <option key={k}>{k}</option>)}</select>
        <div className="search">🏷️<input placeholder="kata kunci baru (mis. scaler)" value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></div>
        <button className="btn sm" disabled={busy} onClick={add}>Tambah</button>
      </div>
      {kws === null ? <div className="state"><span className="spin" />Memuat…</div> : (
        <div className="kw-grid">
          {KLAS.map((k) => (
            <div className="kw-col" key={k}>
              <div className="kw-head">{k}</div>
              {kws.filter((x) => x.klasifikasi === k).map((x, i) => (
                <span className="kw-chip" key={i}>{x.keyword}<button onClick={() => del(x)}>✕</button></span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------- Log Aktivitas ----------------
function ActivityLog({ onToast }) {
  const [logs, setLogs] = useState(null)
  const [who, setWho] = useState('')

  const load = () => { setLogs(null); api.getActivity().then(setLogs).catch((e) => onToast('err', e.message)) }
  useEffect(() => { load() }, [])

  const users = useMemo(() => [...new Set((logs || []).map((l) => l.user))].sort(), [logs])
  const filtered = (logs || []).filter((l) => !who || l.user === who)
  const fmtTime = (ts) => { try { return new Date(ts).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) } catch { return '' } }

  return (
    <div>
      <p className="rekap-sub">Riwayat tindakan tiap akun (pemakaian, opname, belanja, perubahan data). Tercatat otomatis.</p>
      <div className="toolbar">
        <select className="filter" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Semua staf</option>
          {users.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <button className="btn ghost sm" onClick={load}>Muat ulang</button>
      </div>
      {logs === null ? <div className="state"><span className="spin" />Memuat…</div> : filtered.length === 0 ? (
        <div className="state">Belum ada aktivitas tercatat.</div>
      ) : (
        <div className="log-list">
          {filtered.map((l, i) => (
            <div className="log-row" key={i}>
              <div className="log-head"><b>{l.user}</b> <span className="log-aksi">{l.aksi}</span></div>
              {l.detail && <div className="muted sm">{l.detail}</div>}
              <div className="log-time">{fmtTime(l.ts)}</div>
            </div>
          ))}
          <div className="muted sm" style={{ padding: '8px 2px' }}>{filtered.length} aktivitas</div>
        </div>
      )}
    </div>
  )
}

// ---------------- Ekspor ----------------
function Ekspor({ user, onToast }) {
  const [busy, setBusy] = useState('')
  const [syncing, setSyncing] = useState(false)

  async function resync() {
    if (!window.confirm('Tulis ulang Google Spreadsheet agar sama persis dengan data app sekarang? Baris lama di sheet akan ditimpa.')) return
    setSyncing(true)
    try {
      const r = await api.resyncSheets({ user: user.nama })
      const c = r.counts || {}
      onToast('ok', `Sinkron selesai: ${c.master || 0} master, ${c.pakai || 0} pakai, ${c.belanja || 0} belanja, ${c.opname || 0} opname.`)
    } catch (e) { onToast('err', e.message) } finally { setSyncing(false) }
  }

  function toCSV(rows) {
    if (!rows.length) return ''
    const head = Object.keys(rows[0])
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'
    return [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n')
  }
  function download(name, csv) {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
  }
  async function exp(kind) {
    setBusy(kind)
    try {
      if (kind === 'master') download('master_item.csv', toCSV(await api.getMasterAll()))
      else download('belanja.csv', toCSV((await api.getBelanja()).map((n) => ({ ...n, items: n.items.length }))))
      onToast('ok', 'File diunduh.')
    } catch (e) { onToast('err', e.message) } finally { setBusy('') }
  }

  return (
    <div className="admin-form">
      <p className="rekap-sub">Unduh data sebagai CSV (bisa dibuka di Excel/Sheets).</p>
      <div className="actions">
        <button className="btn ghost" disabled={busy} onClick={() => exp('master')}>{busy === 'master' ? '…' : 'Ekspor Item Master'}</button>
        <button className="btn ghost" disabled={busy} onClick={() => exp('belanja')}>{busy === 'belanja' ? '…' : 'Ekspor Belanja'}</button>
      </div>

      <h3 className="rekap-h" style={{ marginTop: 22 }}>Sinkronkan ke Spreadsheet</h3>
      <p className="rekap-sub">Tulis ulang Google Spreadsheet agar <b>sama persis</b> dengan data app saat ini (membersihkan baris lama yang tidak terpakai). Data app tetap di Firebase; ini hanya menyegarkan cermin Sheets untuk akuntan.</p>
      <div className="actions">
        <button className="btn" disabled={syncing} onClick={resync}>{syncing ? 'Menyinkronkan…' : '🔄 Sinkronkan ke Spreadsheet'}</button>
      </div>
    </div>
  )
}
