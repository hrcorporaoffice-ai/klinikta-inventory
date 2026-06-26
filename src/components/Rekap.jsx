import React, { useCallback, useEffect, useState } from 'react'
import * as api from '../api.js'

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0))

export default function Rekap({ today, onToast }) {
  const [periode, setPeriode] = useState(today.slice(0, 7)) // YYYY-MM
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
        </div>
      )}
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
