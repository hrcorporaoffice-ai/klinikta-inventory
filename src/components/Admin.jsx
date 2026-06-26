import React, { useEffect, useState } from 'react'
import * as api from '../api.js'

const KELOMPOK = ['BHP Gigi', 'BHP Umum', 'Obat', 'Alkes']
const PERAN = ['staf', 'bendahara', 'penerima', 'logistik', 'admin']
const splitPeran = (p) => String(p || 'staf').split(',').map((r) => r.trim()).filter(Boolean)
const joinPeran = (arr) => arr.length ? arr.join(',') : 'staf'
const SECTIONS = [
  ['master', 'Item Master'],
  ['staf', 'Staf & PIN'],
  ['kw', 'Kata Kunci Klasifikasi'],
  ['ekspor', 'Ekspor'],
]

export default function Admin({ user, onToast }) {
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
        {sec === 'ekspor' && <Ekspor onToast={onToast} />}
      </div>
    </div>
  )
}

// ---------------- Master ----------------
const emptyItem = { kode: '', nama: '', kelompok: 'BHP Gigi', subKategori: '', satuan: '', kemasan: '', hargaAcuan: '', metode: 'Praktis', titikReorder: '', aktif: true }

function MasterAdmin({ user, onToast }) {
  const [items, setItems] = useState(null)
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null) // item being edited/added
  const [busy, setBusy] = useState(false)

  const load = () => api.getMasterAll().then(setItems).catch((e) => onToast('err', e.message))
  useEffect(() => { load() }, [])

  const filtered = (items || []).filter((m) => !q || `${m.nama} ${m.kode} ${m.kelompok} ${m.subKategori}`.toLowerCase().includes(q.toLowerCase()))

  async function save() {
    if (!edit.nama.trim() || !edit.kelompok) { onToast('err', 'Nama & kelompok wajib.'); return }
    setBusy(true)
    try {
      await api.saveMaster({ user: user.nama, item: edit })
      onToast('ok', edit.kode ? 'Item diperbarui.' : 'Item baru ditambahkan.')
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
          <label>Sub-kategori<input value={edit.subKategori} onChange={(e) => setEdit({ ...edit, subKategori: e.target.value })} /></label>
          <label>Satuan<input value={edit.satuan} onChange={(e) => setEdit({ ...edit, satuan: e.target.value })} /></label>
          <label>Isi/Kemasan<input value={edit.kemasan} onChange={(e) => setEdit({ ...edit, kemasan: e.target.value })} /></label>
          <label>Harga acuan (Rp)<input type="number" min="0" value={edit.hargaAcuan} onChange={(e) => setEdit({ ...edit, hargaAcuan: e.target.value })} /></label>
          <label>Metode<select value={edit.metode} onChange={(e) => setEdit({ ...edit, metode: e.target.value })}><option>Praktis</option><option>Detail</option></select></label>
          <label>Titik reorder<input type="number" min="0" value={edit.titikReorder} onChange={(e) => setEdit({ ...edit, titikReorder: e.target.value })} /></label>
          <label>Aktif<select value={edit.aktif ? '1' : '0'} onChange={(e) => setEdit({ ...edit, aktif: e.target.value === '1' })}><option value="1">Aktif</option><option value="0">Nonaktif</option></select></label>
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

// ---------------- Staf ----------------
const emptyStaf = { nama: '', pin: '', kelompok: 'BHP Gigi', peran: 'staf', aktif: true }

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
          <label>Kelompok<select value={edit.kelompok} onChange={(e) => setEdit({ ...edit, kelompok: e.target.value })}>{KELOMPOK.map((k) => <option key={k}>{k}</option>)}</select></label>
          <label>Peran</label>
          <div className="peran-checks">
            {PERAN.map((p) => {
              const cur = splitPeran(edit.peran)
              const checked = cur.includes(p)
              return (
                <label key={p} className="peran-check">
                  <input type="checkbox" checked={checked} onChange={(e) => {
                    const next = e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)
                    setEdit({ ...edit, peran: joinPeran(next) })
                  }} />
                  {p}
                </label>
              )
            })}
          </div>
          <label>Aktif<select value={edit.aktif ? '1' : '0'} onChange={(e) => setEdit({ ...edit, aktif: e.target.value === '1' })}><option value="1">Aktif</option><option value="0">Nonaktif</option></select></label>
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
              <div><b>{u.nama}</b> <span className="muted">{u.peran} · {u.kelompok}</span></div>
              <button className="linklike" onClick={() => setEdit({ ...emptyStaf, nama: u.nama, kelompok: u.kelompok, peran: u.peran, originalNama: u.nama, pin: '' })}>Ubah</button>
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

// ---------------- Ekspor ----------------
function Ekspor({ onToast }) {
  const [busy, setBusy] = useState('')

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
      <p className="rekap-sub">Unduh data sebagai CSV (bisa dibuka di Excel/Sheets). Data lengkap selalu tersedia di spreadsheet sumber.</p>
      <div className="actions">
        <button className="btn ghost" disabled={busy} onClick={() => exp('master')}>{busy === 'master' ? '…' : 'Ekspor Item Master'}</button>
        <button className="btn ghost" disabled={busy} onClick={() => exp('belanja')}>{busy === 'belanja' ? '…' : 'Ekspor Belanja'}</button>
      </div>
    </div>
  )
}
