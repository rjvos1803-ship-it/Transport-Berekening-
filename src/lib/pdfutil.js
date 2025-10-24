// src/lib/pdfutil.js
// PDF: toont géén linehaul & géén brandstoftoeslag, wel meegerekend in totalen.
// Laden/lossen als één regel. 0-regels overslaan. Geen haakjes met uren.

import jsPDF from 'jspdf';

function eur(n) {
  return `€ ${Number(n ?? 0).toFixed(2)}`;
}
function line(doc, x1, y1, x2, y2, gray = 0.85) {
  doc.setDrawColor(gray * 255);
  doc.line(x1, y1, x2, y2);
}
function addLabelValue(doc, label, value, x, y, labelW = 60) {
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text(label, x, y);
  doc.setFont("helvetica", "bold");   doc.text(String(value ?? ""), x + labelW, y);
}
async function loadImageAsDataURL(url) {
  try {
    if (!url) return null;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob);
    });
  } catch { return null; }
}

export async function exportQuoteToPDF(quote, meta = {}) {
  if (!quote) return;

  const {
    reference = "",
    logoUrl = "/logo.jpg",
    company = "The Coatinc Company",
    title = "Coatinc Transport berekening"
  } = meta;

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

  const margin = 15;
  let y = margin;

  // Header
  const dataURL = await loadImageAsDataURL(logoUrl);
  if (dataURL) { try { doc.addImage(dataURL, "JPEG", margin, y - 2, 30, 0); } catch {} }
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text(title, margin + 35, y + 2);
  doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text(company, margin + 35, y + 8);
  y += 14; line(doc, margin, y, 210 - margin, y); y += 6;

  // Meta
  addLabelValue(doc, "Referentie:", reference || "-", margin, y);
  addLabelValue(doc, "Datum:", new Date().toLocaleDateString("nl-NL"), 120, y); y += 8;

  // Invoer
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Invoer", margin, y); y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  const tLabel = quote?.inputs?.trailer_type_label || quote?.inputs?.trailer_type || "-";
  const loadLabel = quote?.inputs?.load_label || "-";
  addLabelValue(doc, "Van:", quote?.inputs?.from || "-", margin, y);
  addLabelValue(doc, "Naar:", quote?.inputs?.to || "-", 120, y); y += 6;
  addLabelValue(doc, "Trailertype:", tLabel, margin, y);
  addLabelValue(doc, "Beladingsgraad:", loadLabel, 120, y); y += 6;

  const opt = quote?.inputs?.options || {};
  const optsTxt = [
    opt.load_unload_internal ? "Laden/lossen interne locatie" : null,
    opt.load_unload_external ? "Laden/lossen externe locatie" : null,
    opt.autolaad_kraan ? "Autolaadkraan" : null,
    opt.combined ? "Gecombineerd transport (20% korting)" : null,
    opt.km_levy ? "Kilometerheffing" : null,
    opt.city_delivery ? "Binnenstad" : null
  ].filter(Boolean).join(", ") || "-";
  addLabelValue(doc, "Opties:", optsTxt, margin, y); y += 8;

  // Resultaat
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Resultaat", margin, y); y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  addLabelValue(doc, "Afstand:", `${quote?.derived?.distance_km ?? 0} km`, margin, y);
  addLabelValue(doc, "Uurtarief handling:", `€ ${(quote?.derived?.rate_used ?? 0).toFixed(2)}/u`, 120, y); y += 8;

  // Labels (zonder linehaul en fuel; laden/lossen gecombineerd)
  const labels = {
    base: "Basistarief",
    handling_approach: "Aanrijden",
    handling_combined: "Laden/lossen",
    handling_depart: "Afrijden",
    km_levy: "Kilometerheffing",
    accessorials: "Bijkosten",
    zone_flat: "Zonetoeslag",
    discount: "Korting gecombineerd transport",
  };

  // Maak gecombineerd bedrag
  const b = quote?.breakdown || {};
  const handling_combined = Number(((b.handling_load || 0) + (b.handling_unload || 0)).toFixed(2));

  const items = [
    ['base', b.base],
    ['handling_approach', b.handling_approach],
    ['handling_combined', handling_combined],
    ['handling_depart', b.handling_depart],
    // fuel & linehaul worden bewust NIET toegevoegd
    ['km_levy', b.km_levy],
    ['accessorials', b.accessorials],
    ['zone_flat', b.zone_flat],
    ['discount', b.discount],
  ].filter(([, v]) => v != null && Math.abs(Number(v)) >= 0.005);

  if (items.length) {
    // Sectietitel alleen tonen indien er items zijn
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Kostenoverzicht", margin, y); y += 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);

    for (const [k, v] of items) {
      if (y > 270) { doc.addPage(); y = margin; }
      const isDiscount = k === 'discount' && Number(v) < 0;

      doc.setTextColor(0, 0, 0);
      doc.text(labels[k] || k, margin, y);

      if (isDiscount) doc.setTextColor(20, 120, 90);
      doc.setFont("helvetica", "bold");
      doc.text(eur(v), 210 - margin, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);

      y += 6;
    }
  }

  line(doc, margin, y, 210 - margin, y); y += 8;

  // Totaal
  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("Totaal", margin, y);
  doc.text(eur(quote?.total ?? 0), 210 - margin, y, { align: "right" });

  const safeRef = (reference || "offerte").replace(/[^\w.-]+/g, "_");
  doc.save(`Transportberekening_${safeRef}.pdf`);
}
