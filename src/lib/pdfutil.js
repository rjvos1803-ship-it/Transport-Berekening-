// src/lib/pdfutil.js
import jsPDF from "jspdf"

// hulpfunctie: blob -> dataURL
async function blobToDataURL(blob) {
  return await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(blob)
  })
}

// probeer logo te laden als dataURL (mag ontbreken)
async function loadLogoDataURL(logoUrl) {
  try {
    const res = await fetch(logoUrl)
    if (!res.ok) return null
    const blob = await res.blob()
    return await blobToDataURL(blob)
  } catch {
    return null
  }
}

/**
 * Genereer en download een nette PDF:
 * - Logo linksboven
 * - Titel + datum
 * - Invoer (referentie, addresses, beladingsgraad, trailer)
 * - Berekeningstabel
 * - Totaal prominent
 */
export async function exportQuoteToPDF(quote, opts = {}) {
  const {
    reference = "",
    logoUrl = "/logo.png",
    company = "Coatinc",
    title = "Coatinc Transport berekening"
  } = opts

  const doc = new jsPDF({ unit: "pt", format: "a4" }) // 595 x 842 pt
  const pageW = doc.internal.pageSize.getWidth()
  let y = 40
  const left = 40
  const right = pageW - 40

  // header met logo
  const logoDataUrl = await loadLogoDataURL(logoUrl)
  const logoH = 36
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', left, y, logoH * 3, logoH, undefined, 'FAST')
  }
  // titel en datum rechts
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(title, right, y + 10, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const dateStr = new Date().toLocaleString()
  doc.text(`${company} · ${dateStr}`, right, y + 26, { align: 'right' })
  y += 60

  // lijn
  doc.setDrawColor(220)
  doc.line(left, y, right, y)
  y += 18

  // Referentie + invoer
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text('Invoer', left, y); y += 16
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)

  const loadPct = quote?.inputs?.options?.load_fraction
    ? `${(quote.inputs.options.load_fraction * 100).toFixed(0)}%`
    : '—'
  const loadLabel = quote?.inputs?.load_label || quote?.inputs?.options?.load_grade || '—'
  const trailer = quote?.inputs?.trailer_type_label || quote?.inputs?.trailer_type || '—'

  const rowsIn = [
    ['Referentie', reference || '—'],
    ['Van', quote.inputs.from],
    ['Naar', quote.inputs.to],
    ['Trailer', trailer],
    ['Beladingsgraad', `${loadLabel} (${loadPct})`],
    ['Afstand', `${quote.derived.distance_km} km`],
  ]

  const col1W = 140
  rowsIn.forEach(([k, v]) => {
    doc.setTextColor(100)
    doc.text(k, left, y)
    doc.setTextColor(20)
    doc.text(String(v), left + col1W, y)
    y += 14
  })

  y += 10
  doc.setDrawColor(240)
  doc.line(left, y, right, y)
  y += 18

  // Berekeningstabel
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.setTextColor(20)
  doc.text('Berekening', left, y); y += 16
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)

  const LABELS_NL = {
    base: 'Basistarief',
    linehaul: 'Kilometerkosten',
    handling: 'Behandelingskosten (aan-/afrijden + laden/lossen)',
    km_levy: 'Kilometerheffing',
    accessorials: 'Bijkosten',
    fuel: 'Brandstoftoeslag',
    zone_flat: 'Zonetoeslag'
  }

  const rowsCalc = Object.entries(quote.breakdown || {})
    .map(([k, v]) => [LABELS_NL[k] || k, `€ ${Number(v).toFixed(2)}`])

  const valX = right - 120
  rowsCalc.forEach(([k, v]) => {
    // label
    doc.setTextColor(80)
    doc.text(k, left, y)
    // value rechts
    doc.setTextColor(20)
    doc.text(v, valX, y)
    y += 14
    if (y > 780) { doc.addPage(); y = 40 }
  })

  y += 8
  doc.setDrawColor(220)
  doc.line(left, y, right, y)
  y += 18

  // Totaal
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
  doc.setTextColor(20)
  doc.text('Totaal', left, y)
  doc.text(`€ ${Number(quote.total).toFixed(2)}`, valX, y)
  y += 20

  // voetnoot
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120)
  const foot = 'Aanrij 0,5u + afrij 0,5u. Laden/lossen 1,5u bij volle trailer, naar rato per beladingsgraad. Kilometerheffing optioneel. Brandstoftoeslag op subtotaal.'
  const split = doc.splitTextToSize(foot, right - left)
  doc.text(split, left, y)

  // Download direct
  doc.save('Coatinc-Transport-Berekening.pdf')
}

}
