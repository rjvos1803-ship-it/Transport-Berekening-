// src/lib/pdfutil.js
// Strakke PDF: secties alleen tonen als er zichtbare regels (≠0) zijn, 0-regels overslaan,
// korting (negatieve) groen tonen, nette kop en tabel-achtige lijst.

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
  if (dataURL) {
    try { doc.addImage(dataURL, "JPEG", margin, y - 2, 30, 0); } catch {}
  }
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
    opt.city_delivery ? "Binnenstad" : null,
    opt.autolaad_kraan ? "Autolaadkraan" : null,
    opt.combined ? "Gecombineerd transport (20% korting)" : null,
    opt.load ? "Laden" : null,
    opt.unload ? "Lossen" : null,
    opt.km_levy ? "Kilometerheffing" : null
  ].filter(Boolean).join(", ") || "-";
  addLabelValue(doc, "Opties:", optsTxt, margin, y); y += 8;

  // Resultaat
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Resultaat", margin, y); y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  addLabelValue(doc, "Afstand:", `${quote?.derived?.distance_km ?? 0} km`, margin, y);
  addLabelValue(doc, "Uurtarief handling:", `${eur(quote?.derived?.rate_used ?? 0)}/u`, 120, y); y += 8;

  // Labels + uren
  const labels = {
    base: "Basistarief",
    linehaul: "Kilometerkosten",
    handling_approach: "Aanrijden",
    handling_depart: "Afrijden",
    handling_load: "Laden",
    handling_unload: "Lossen",
    km_levy: "Kilometerheffing",
    accessorials: "Bijkosten",
    fuel: "Brandstoftoeslag",
    zone_flat: "Zonetoeslag",
    discount: "Korting gecombineerd transport",
  };
  const hoursSuffix = (k) => {
    const d = quote?.derived || {};
    if (k === "handling_approach") return ` (${(d.approach_hours ?? 0).toFixed(2)} u)`;
    if (k === "handling_depart")   return ` (${(d.depart_hours ?? 0).toFixed(2)} u)`;
    if (k === "handling_load")     return ` (${(d.load_hours ?? 0).toFixed(2)} u)`;
    if (k === "handling_unload")   return ` (${(d.unload_hours ?? 0).toFixed(2)} u)`;
    return "";
  };

  const sections = [
    { title: "Kilometers & basistarief", items: ["base", "linehaul"] },
    { title: "Behandelingskosten",       items: ["handling_approach", "handling_depart", "handling_load", "handling_unload"] },
    { title: "Toeslagen & heffingen",    items: ["km_levy", "accessorials", "fuel", "zone_flat", "discount"] },
  ];

  for (const sec of sections) {
    const visible = sec.items
      .map(k => ({ k, v: quote?.breakdown?.[k] }))
      .filter(({ v }) => v != null && Math.abs(Number(v)) >= 0.005);
    if (visible.length === 0) continue;

    if (y > 270) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(sec.title, margin, y);
    y += 5; doc.setFont("helvetica", "normal"); doc.setFontSize(10);

    for (const { k, v } of visible) {
      if (y > 270) { doc.addPage(); y = margin; }
      const isDiscount = k === 'discount' && Number(v) < 0;

      doc.setTextColor(0, 0, 0);
      doc.text(`${labels[k] || k}${hoursSuffix(k)}`, margin, y);

      if (isDiscount) doc.setTextColor(20, 120, 90);
      doc.setFont("helvetica", "bold");
      doc.text(eur(v), 210 - margin, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);

      y += 6;
    }
    y += 2;
  }

  line(doc, margin, y, 210 - margin, y); y += 8;

  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("Totaal", margin, y);
  doc.text(eur(quote?.total ?? 0), 210 - margin, y, { align: "right" });

  const safeRef = (reference || "offerte").replace(/[^\w.-]+/g, "_");
  const fileName = `Transportberekening_${safeRef}.pdf`;
  doc.save(fileName);
}
