// src/lib/pdfutil.js
// Compacte PDF voor klant: verbergt base/linehaul/fuel, slaat 0-regels & lege secties over,
// combineert laden + lossen, toont afstand en uren, met logo en nette layout.

function eur(n) {
  return `€ ${Number(n ?? 0).toFixed(2)}`;
}

function line(doc, x1, y1, x2, y2, gray = 0.85) {
  doc.setDrawColor(gray * 255);
  doc.line(x1, y1, x2, y2);
}

function labelValue(doc, label, value, x, y, labelW = 46) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(label, x, y);
  doc.setFont("helvetica", "bold");
  doc.text(String(value ?? ""), x + labelW, y);
}

async function fetchAsDataURL(url) {
  try {
    const r = await fetch(url);
    const b = await r.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(b);
    });
  } catch {
    return null;
  }
}

function buildVisibleRows(breakdown = {}) {
  const hidden = new Set(["base", "linehaul", "fuel"]);
  const rows = [];

  // Laden/Lossen samen
  const load = Number(breakdown.handling_load || 0);
  const unload = Number(breakdown.handling_unload || 0);
  const loadUnload = load + unload;
  if (Math.abs(loadUnload) >= 0.005) rows.push(["Laden/Lossen", loadUnload]);

  // Aanrijden / Afrijden
  const approach = Number(breakdown.handling_approach || 0);
  if (Math.abs(approach) >= 0.005) rows.push(["Aanrijden", approach]);

  const depart = Number(breakdown.handling_depart || 0);
  if (Math.abs(depart) >= 0.005) rows.push(["Afrijden", depart]);

  // Overige posten (excl. verborgen en 0,00)
  const labels = {
    km_levy: "Kilometerheffing",
    zone_flat: "Zonetoeslag",
    discount: "Korting gecombineerd transport"
  };
  for (const [k, vRaw] of Object.entries(breakdown)) {
    if (hidden.has(k)) continue;
    if (k.startsWith("handling_")) continue;
    const v = Number(vRaw || 0);
    if (Math.abs(v) < 0.005) continue;
    rows.push([labels[k] || k, v]);
  }

  return rows;
}

export async function exportQuoteToPDF(quote, meta = {}) {
  const { default: jspdfNS } = await import("jspdf");
  const jsPDF = jspdfNS.jsPDF || jspdfNS;

  const {
    reference = "",
    logoUrl = "/logo.jpg",
    company = "The Coatinc Company",
    title = "Coatinc Transport berekening"
  } = meta;

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const margin = 16;
  let y = margin;

  // Header
  if (logoUrl) {
    const img = await fetchAsDataURL(logoUrl);
    if (img) doc.addImage(img, "JPEG", margin, y - 2, 30, 0);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, margin + 36, y + 2);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(company, margin + 36, y + 8);
  y += 14;
  line(doc, margin, y, 210 - margin, y);
  y += 7;

  // Kop-info (invoer)
  const inputs = quote?.inputs || {};
  const opt = inputs.options || {};
  const trailerLabel = inputs.trailer_type_label || inputs.trailer_type || "-";

  labelValue(doc, "Referentie:", reference || "-", margin, y);
  labelValue(doc, "Datum:", new Date().toLocaleDateString("nl-NL"), 120, y);
  y += 6;
  labelValue(doc, "Van:", inputs.from || "-", margin, y);
  labelValue(doc, "Naar:", inputs.to || "-", 120, y);
  y += 6;
  labelValue(doc, "Trailer:", trailerLabel, margin, y);

  // Beladingsgraad tonen uit inputs.options.load_grade als tekst
  const loadGradeMap = {
    one_pallet: "1× pallet",
    quarter: "¼ trailer",
    half: "½ trailer",
    three_quarter: "¾ trailer",
    full: "Volle trailer"
  };
  const loadTxt =
    loadGradeMap[opt.load_grade] ??
    (typeof opt.load_fraction === "number" ? `${Math.round(opt.load_fraction * 100)}%` : "-");
  labelValue(doc, "Beladingsgraad:", loadTxt, 120, y);
  y += 6;

  // Locatie keuze + opties (als tekst)
  const locTxt = opt.load_unload_external
    ? "Externe locatie"
    : opt.load_unload_internal
    ? "Interne locatie"
    : "-";
  const optionsShown = [
    locTxt,
    opt.autolaad_kraan ? "Autolaadkraan" : null,
    opt.km_levy ? "Kilometerheffing" : null
  ]
    .filter(Boolean)
    .join(" · ");
  labelValue(doc, "Opties:", optionsShown || "-", margin, y);
  y += 8;

  // Resultaatkop
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Resultaat", margin, y);
  y += 5;

  // Afstand + uren
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const d = quote?.derived || {};
  labelValue(doc, "Afstand:", `${d.distance_km ?? 0} km`, margin, y);
  y += 6;
  // Uren in 2 kolommen
  const hours = [
    ["Aanrijden", d.approach_hours ?? 0],
    ["Laden", d.load_hours ?? 0],
    ["Lossen", d.unload_hours ?? 0],
    ["Afrijden", d.depart_hours ?? 0]
  ];
  const left = hours.slice(0, 2);
  const right = hours.slice(2);

  left.forEach(([lbl, v], idx) => {
    labelValue(doc, `${lbl}:`, `${Number(v).toFixed(2)} u`, margin, y + idx * 6);
  });
  right.forEach(([lbl, v], idx) => {
    labelValue(doc, `${lbl}:`, `${Number(v).toFixed(2)} u`, 120, y + idx * 6);
  });
  y += 6 * Math.max(left.length, right.length) + 2;

  // Kostenlijst (compact) – alleen zichtbare posten en ≠ 0,00
  const rows = buildVisibleRows(quote?.breakdown);
  if (rows.length) {
    line(doc, margin, y, 210 - margin, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Kosten", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    for (const [lbl, val] of rows) {
      if (y > 270) {
        doc.addPage();
        y = margin;
      }
      const isDiscount = lbl.toLowerCase().includes("korting") && Number(val) < 0;
      doc.setTextColor(isDiscount ? 20 : 0, isDiscount ? 120 : 0, isDiscount ? 90 : 0);
      doc.text(lbl, margin, y);
      doc.setFont("helvetica", "bold");
      doc.text(eur(val), 210 - margin, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
      y += 6;
    }
  }

  // Totaal
  line(doc, margin, y, 210 - margin, y);
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Totaal", margin, y);
  doc.text(eur(quote?.total ?? 0), 210 - margin, y, { align: "right" });

  // Bestandsnaam
  const safeRef = (reference || "offerte").replace(/[^\w.-]+/g, "_");
  const fileName = `Transportberekening_${safeRef}.pdf`;
  doc.save(fileName);
}
