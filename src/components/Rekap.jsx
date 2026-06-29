import React, { useCallback, useEffect, useState } from 'react'
import * as api from '../api.js'

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0))

export default function Rekap({ user, today, onToast }) {
  const [periode, setPeriode] = useState(today.slice(0, 7)) // YYYY-MM
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const isAdmin = String(user?.peran || '').split(',').map((r) => r.trim()).includes('admin')

  const load = useCallback(() => {
    setLoading(true); setError('')
    api.getRekap(periode).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [periode])
  useEffect(() => { load() }, [load])

  const copy = async (val, label) => {
    try { await navigator.clipboard.writeText(String(val)); onToast('ok', `Disalin: ${label}`) }
    catch { onToast('err', 'Gagal menyalin.') }
  }

  async function tandaiAset(idAset) {
    try {
      await api.updateAntrianAset({ idAset, statusCatat: 'Sudah dicatat' })
      onToast('ok', 'Aset ditandai sudah dicatat.')
      load()
    } catch (e) { onToast('err', e.message) }
  }

  return (
    <div className="card">
      <div className="cap">
        <h2>Rekap → LAPKEU</h2>
        <label className="periode-pick">Periode
          <input type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} />
        </label>
      </div>

      {loading ? (
        <div className="state"><span className="spin" />Menghitung rekap…</div>
      ) : error ? (
        <div className="state err">⚠️ {error}<div style={{ marginTop: 8 }}><button className="btn ghost" onClick={load}>Coba lagi</button></div></div>
      ) : (
        <div className="rekap">
          <p className="rekap-note">Angka siap salin ke Akoontan (Level 1 — manual, ada mata manusia). Belum ada otomasi langsung.</p>

          {/* Bagian 1 */}
          <h3 className="rekap-h">1 · Dari Belanja &amp; Terima</h3>
          <RekapRow
            label="Total Persediaan BHP + Obat"
            akun="Akoontan: Pengeluaran · kategori Persediaan"
            value={data.persediaan.totalPersediaan} onCopy={copy} />
          <RekapRow
            label="Total Beban Alkes"
            akun="Akoontan: Pengeluaran · kategori Beban Alkes"
            value={data.persediaan.totalBebanAlkes} onCopy={copy} />
          <RekapRow
            label="Total Beban ATK & Perlengkapan Kantor"
            akun="Akoontan: Pengeluaran · kategori Beban ATK dan Perlengkapan Kantor"
            value={data.persediaan.totalBebanATK || 0} onCopy={copy} />

          <div className="rekap-aset">
            <div className="ra-head">Aset perlu dicatat manual ke Daftar Aset Akoontan ({data.antrianAset.length})</div>
            {data.antrianAset.length === 0 ? (
              <div className="muted" style={{ padding: '6px 0' }}>Tidak ada aset menunggu.</div>
            ) : data.antrianAset.map((a) => (
              <div className="ra-item" key={a.idAset}>
                <div>
                  <b>{a.nama}</b> · {rupiah(a.hargaTotal)}
                  <div className="muted">{a.tanggalTerima}{a.sumber ? ` · ${a.sumber}` : ''}</div>
                </div>
                <button className="btn ghost sm" onClick={() => tandaiAset(a.idAset)}>Sudah dicatat</button>
              </div>
            ))}
          </div>

          {/* Bagian 2 */}
          <h3 className="rekap-h">2 · Dari Pemakaian (HPP)</h3>
          <p className="rekap-sub">→ Akoontan: Pemasukan · harga 0 · kategori "Beban Penggunaan Produk Internal"</p>
          {data.hppPemakaian.length === 0 ? (
            <div className="muted" style={{ padding: '6px 0' }}>Belum ada pemakaian di periode ini.</div>
          ) : data.hppPemakaian.map((h) => (
            <RekapRow key={h.kelompok} label={`HPP ${h.kelompok}`} value={h.total} onCopy={copy} />
          ))}

          {/* Bagian 3 */}
          <h3 className="rekap-h">3 · Dari Opname (selisih)</h3>
          {data.selisihOpname.length === 0 ? (
            <div className="muted" style={{ padding: '6px 0' }}>Tidak ada selisih opname di periode ini.</div>
          ) : (
            <div className="selisih-list">
              {data.selisihOpname.map((s, i) => (
                <div className="selisih-row" key={i}>
                  <span>{s.nama} <i className="muted">({s.kelompok})</i></span>
                  <b className={s.selisih < 0 ? 'neg' : 'pos'}>{s.selisih > 0 ? '+' : ''}{s.selisih}</b>
                </div>
              ))}
              <div className="muted" style={{ marginTop: 6 }}>Selisih negatif = stok fisik kurang dari sistem (kemungkinan kebocoran/salah catat).</div>
            </div>
          )}

          {isAdmin && <KelolaData user={user} periode={periode} onToast={onToast} onChanged={load} />}
        </div>
      )}
    </div>
  )
}

// ---------------- Kelola data pemakaian & opname (admin) ----------------
function KelolaData({ user, periode, onToast, onChanged }) {
  const [pakai, setPakai] = useState(null)
  const [opname, setOpname] = useState(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    api.getPakaiRecords(periode).then(setPakai).catch((e) => onToast('err', e.message))
    api.getOpnameRecords(periode).then(setOpname).catch((e) => onToast('err', e.message))
  }, [periode])
  useEffect(() => { load() }, [load])

  const afterChange = () => { load(); onChanged && onChanged() }

  async function savePakai(r, val) {
    setBusy(r.id)
    try { await api.updatePakai({ user: user.nama, id: r.id, jumlah: val }); onToast('ok', 'Pemakaian diperbarui.'); afterChange() }
    catch (e) { onToast('err', e.message) } finally { setBusy('') }
  }
  async function delPakai(r) {
    if (!window.confirm(`Hapus pemakaian "${r.nama}" (${r.jumlah}) tgl ${r.tanggal}?`)) return
    setBusy(r.id)
    try { await api.deletePakai({ user: user.nama, id: r.id }); onToast('ok', 'Pemakaian dihapus.'); afterChange() }
    catch (e) { onToast('err', e.message) } finally { setBusy('') }
  }
  async function saveOpname(r, val) {
    setBusy(r.id)
    try { await api.updateOpname({ user: user.nama, id: r.id, stokFisik: val }); onToast('ok', 'Opname diperbarui.'); afterChange() }
    catch (e) { onToast('err', e.message) } finally { setBusy('') }
  }
  async function delOpname(r) {
    if (!window.confirm(`Hapus opname "${r.nama}" tgl ${r.tanggal}?`)) return
    setBusy(r.id)
    try { await api.deleteOpname({ user: user.nama, id: r.id }); onToast('ok', 'Opname dihapus.'); afterChange() }
    catch (e) { onToast('err', e.message) } finally { setBusy('') }
  }

  return (
    <div className="kelola">
      <h3 className="rekap-h">⚙️ Kelola Data (Admin) · {periode}</h3>
      <p className="rekap-sub">Perbaiki salah input atau hapus data pemakaian/opname pada periode ini. Stok & rekap dihitung ulang otomatis.</p>

      <div className="kelola-sub">Pemakaian</div>
      {pakai === null ? <div className="muted sm">Memuat…</div> : pakai.length === 0 ? <div className="muted sm">Tidak ada pemakaian di periode ini.</div> : (
        <div className="kelola-list">
          {pakai.map((r) => <PakaiEditRow key={r.id} r={r} busy={busy === r.id} onSave={savePakai} onDelete={delPakai} />)}
        </div>
      )}

      <div className="kelola-sub" style={{ marginTop: 14 }}>Opname</div>
      {opname === null ? <div className="muted sm">Memuat…</div> : opname.length === 0 ? <div className="muted sm">Tidak ada opname di periode ini.</div> : (
        <div className="kelola-list">
          {opname.map((r) => <OpnameEditRow key={r.id} r={r} busy={busy === r.id} onSave={saveOpname} onDelete={delOpname} />)}
        </div>
      )}
    </div>
  )
}

function PakaiEditRow({ r, busy, onSave, onDelete }) {
  const [val, setVal] = useState(r.jumlah)
  return (
    <div className="kelola-row">
      <div className="kelola-info"><b>{r.nama}</b><span className="muted sm">{r.tanggal} · {r.kelompok} · {r.user || '-'}</span></div>
      <div className="kelola-act">
        <input className="kelola-num" type="number" min="0" value={val} onChange={(e) => setVal(e.target.value)} />
        <button className="btn ghost sm" disabled={busy || String(val) === String(r.jumlah)} onClick={() => onSave(r, val)}>Simpan</button>
        <button className="btn danger sm" disabled={busy} onClick={() => onDelete(r)}>Hapus</button>
      </div>
    </div>
  )
}

function OpnameEditRow({ r, busy, onSave, onDelete }) {
  const [val, setVal] = useState(r.stokFisik)
  const selisih = Number(val || 0) - r.stokSistem
  return (
    <div className="kelola-row">
      <div className="kelola-info"><b>{r.nama}</b><span className="muted sm">{r.tanggal} · sistem {r.stokSistem} · selisih {selisih > 0 ? '+' : ''}{selisih} · {r.user || '-'}</span></div>
      <div className="kelola-act">
        <input className="kelola-num" type="number" value={val} onChange={(e) => setVal(e.target.value)} />
        <button className="btn ghost sm" disabled={busy || String(val) === String(r.stokFisik)} onClick={() => onSave(r, val)}>Simpan</button>
        <button className="btn danger sm" disabled={busy} onClick={() => onDelete(r)}>Hapus</button>
      </div>
    </div>
  )
}

function RekapRow({ label, akun, value, onCopy }) {
  return (
    <div className="rekap-row">
      <div className="rr-left">
        <div className="rr-label">{label}</div>
        {akun && <div className="rr-akun">{akun}</div>}
      </div>
      <div className="rr-right">
        <span className="rr-val">{rupiah(value)}</span>
        <button className="btn ghost sm" onClick={() => onCopy(value, label)}>Salin</button>
      </div>
    </div>
  )
}
