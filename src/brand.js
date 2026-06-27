// Brand/tema KLINIKTA Inventory — disimpan di RTDB (klinikta_inv/brand),
// logo (data URL besar) di key terpisah (klinikta_inv/brandLogo). Pola menyusul absensi.

export const BRAND_DEFAULT = {
  title: 'KLINIKTA',
  tagline: 'KLINIK KITA SEMUA',
  subtitle: 'Stok BHP & Obat',
  colorPrimary: '#29517F',  // --navy (warna utama / header)
  colorAccent: '#006EB6',   // --blue (warna aksen / tombol & tautan)
  font: 'system',
  logo: '',                 // data URL bila kustom; '' = pakai ikon bawaan
}

// Pilihan font. Yang punya `google` dimuat dari Google Fonts saat dipilih.
export const FONTS = {
  system:  { label: 'Default Sistem', stack: "-apple-system,'Segoe UI',Roboto,Arial,sans-serif", google: '' },
  poppins: { label: 'Poppins',        stack: "'Poppins',sans-serif",            google: 'Poppins:wght@400;500;600;700;800' },
  nunito:  { label: 'Nunito',         stack: "'Nunito',sans-serif",             google: 'Nunito:wght@400;600;700;800' },
  inter:   { label: 'Inter',          stack: "'Inter',sans-serif",              google: 'Inter:wght@400;500;600;700;800' },
  jakarta: { label: 'Plus Jakarta Sans', stack: "'Plus Jakarta Sans',sans-serif", google: 'Plus+Jakarta+Sans:wght@400;500;600;700;800' },
  rounded: { label: 'Quicksand (bulat)', stack: "'Quicksand',sans-serif",       google: 'Quicksand:wght@400;500;600;700' },
}

// Terapkan tema ke CSS variables + muat font bila perlu.
export function applyTheme(brand) {
  const b = { ...BRAND_DEFAULT, ...(brand || {}) }
  const root = document.documentElement
  root.style.setProperty('--navy', b.colorPrimary)
  root.style.setProperty('--blue', b.colorAccent)
  const f = FONTS[b.font] || FONTS.system
  root.style.setProperty('--font', f.stack)
  if (f.google) {
    let link = document.getElementById('brand-font')
    if (!link) {
      link = document.createElement('link')
      link.id = 'brand-font'; link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`
  }
}
