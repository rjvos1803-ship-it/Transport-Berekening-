// src/lib/pdfutil.js
// Maakt een nette PDF van een berekende offerte, incl. gesplitste handlingregels.

function eur(n) {
  return `€ ${Number(n ?? 0).toFixed(2)}`;
}

function line(doc, x1, y1, x2, y2, gray = 0.85) {
  doc.setDrawColor(gray * 255);
  doc.line(x1, y1, x2, y2);
}

function addLabelValue(doc, label, value, x, y, labelW = 60) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(label, x, y);
  doc.setFont("helvetica", "bold");
  doc.text(String(value ?? ""), x + labelW, y);
}

async function loadImageAsDataURL(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Exporteert de berekening naar PDF en start direct een download.
 * @param {object} quote - payload vanuit /.netlify/functions/quote
 * @param {object} meta  - { reference, logoUrl, company, title }
 */
export async function exportQuoteToPDF(quote, meta = {}) {
  // jsPDF lazy import (werkt in Vite zonder extra config)
  const { default: jspdfNS } = await import('jspdf');
  const jsPDF = jspdfNS.jsPDF || jspdfNS; // compat

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

  const {
    reference = "",
    logoUrl = "/logo.jpg",
    company = "The Coatinc Company",
    title = "Coatinc Transport berekening"
  } = meta;

  const margin = 15;
  let y = margin;

  // Header
  if (logoUrl) {
    const dataURL = await loadImageAsDataURL(logoUrl);
    if (dataURL) {
      // breedte max 30mm, hoogte autoscale
      doc.addImage(dataURL, "JPEG", margin, y - 2, 30, 0);
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, margin + 35, y + 2);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(company, margin + 35, y + 8);

  y += 14;
  line(doc, margin, y, 210 - margin, y);
  y += 6;

  // Referentie + datum
  addLabelValue(doc, "Referentie:", reference || "-", margin, y);
  addLabelValue(doc, "Datum:", new Date().toLocaleDateString("nl-NL"), 120, y);
  y += 8;

  // Invoer
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Invoer", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const tLabel = quote?.inputs?.trailer_type_label || quote?.inputs?.trailer_type || "-";
  const loadLabel = quote?.inputs?.load_label || "-";

  addLabelValue(doc, "Van:", quote?.inputs?.from || "-", margin, y);
  addLabelValue(doc, "Naar:", quote?.inputs?.to || "-", 120, y);
  y += 6;

  addLabelValue(doc, "Trailertype:", tLabel, margin, y);
  addLabelValue(doc, "Beladingsgraad:", loadLabel, 120, y);
  y += 6;

  // Opties
  const opt = quote?.inputs?.options || {};
  const optsTxt = [
    opt.city_delivery ? "Binnenstad" : null,
    opt.autolaad_kraan ? "Autolaadkraan" : null,
    opt.load ? "Laden" : null,
    opt.unload ? "Lossen" : null,
    opt.km_levy ? "Kilometerheffing" : null
  ].filter(Boolean).join(", ") || "-";
  addLabelValue(doc, "Opties:", optsTxt, margin, y);
  y += 8;

  // Resultaten/afgeleiden
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Resultaat", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  addLabelValue(doc, "Afstand:", `${quote?.derived?.distance_km ?? 0} km`, margin, y);
  addLabelValue(doc, "Uurtarief handling:", `${eur(quote?.derived?.rate_used ?? 0)}/u`, 120, y);
  y += 8;

  // Kostenspecificatie
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Kostenspecificatie", margin, y);
  y += 5;

  // labels NL + uren-suffix
  const labels = {
    base: "Basistarief",
    linehaul: "Kilometerkosten",
    handling_approach: "Aanrijden",
    handling_depart: "Afrijden",
    handling_load: "Laden",
    handling_unload: "Lossen",
    handling_total: "Totaal behandelingskosten",
    km_levy: "Kilometerheffing",
    accessorials: "Bijkosten",
    fuel: "Brandstoftoeslag",
    zone_flat: "Zonetoeslag"
  };

  const hoursSuffix = (k) => {
    const d = quote?.derived || {};
    if (k === "handling_approach") return ` (${(d.approach_hours ?? 0).toFixed(2)} u)`;
    if (k === "handling_depart")   return ` (${(d.depart_hours ?? 0).toFixed(2)} u)`;
    if (k === "handling_load")     return ` (${(d.load_hours ?? 0).toFixed(2)} u)`;
    if (k === "handling_unload")   return ` (${(d.unload_hours ?? 0).toFixed(2)} u)`;
    if (k === "handling_total")    return ` (${(d.total_hours ?? 0).toFixed(2)} u @ ${eur(d.rate_used ?? 0)}/u)`;
    return "";
  };

  const order = [
    "base",
    "linehaul",
    "handling_approach",
    "handling_depart",
    "handling_load",
    "handling_unload",
    "handling_total",
    "km_levy",
    "accessorials",
    "fuel",
    "zone_flat"
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  for (const key of order) {
    const val = quote?.breakdown?.[key];
    if (val == null) continue;

    // nieuwe pagina als we onderaan komen
    if (y > 270) {
      doc.addPage();
      y = margin;
    }

    const label = labels[key] || key;
    doc.text(`${label}${hoursSuffix(key)}`, margin, y);
    doc.setFont("helvetica", "bold");
    doc.text(eur(val), 210 - margin, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 6;
  }

  y += 2;
  line(doc, margin, y, 210 - margin, y);
  y += 8;

  // Totaal
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Totaal", margin, y);
  doc.text(eur(quote?.total ?? 0), 210 - margin, y, { align: "right" });

  // Bestandsnaam
  const safeRef = (reference || "offerte").replace(/[^\w.-]+/g, "_");
  const fileName = `Transportberekening_${safeRef}.pdf`;

  // Download
  doc.save(fileName);
}
