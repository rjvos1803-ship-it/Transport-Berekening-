// src/lib/pdfutil.js
// Strakke PDF: verberg base/linehaul/fuel, sla €0,00-regels en lege secties over,
// nette header met logo en referentie.

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
    const res = await fetch(url); const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob);
    });
  } catch { return null; }
}

// verberg deze posten in PDF
const HIDDEN_KEYS = new Set(["base", "linehaul", "fuel"]);

export async function exportQuoteToPDF(quote, meta = {}) {
  const { default: jspdfNS } = await import("jspdf");
  const jsPDF = jspdfNS.jsPDF || jspdfNS;

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
    if (dataURL) doc.addImage(dataURL, "JPEG", margin, y - 2, 30, 0);
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
  const loadLabelMap = {
    one_pallet: "1× pallet",
    quarter: "¼ trailer",
    half: "½ trailer",
    three_quarter: "¾ trailer",
    full: "Volle trailer"
  };
  const loadLabel =
    loadLabelMap[quote?.inputs?.options?.load_grade] ||
    quote?.inputs?.load_label ||
    "-";

  addLabelValue(doc, "Van:", quote?.inputs?.from || "-", margin, y);
  addLabelValue(doc, "Naar:", quote?.inputs?.to || "-", 120, y); y += 6;
  addLabelValue(doc, "Trailertype:", tLabel, margin, y);
  addLabelValue(doc, "Beladingsgraad:", loadLabel, 120, y); y += 6;

  const opt = quote?.inputs?.options || {};
  const optsTxt = [
    opt.city_delivery ? "Binnenstad" : null,
    opt.autolaad_kraan ? "Autolaadkraan" : null,
    opt.combined ? "Gecombineerd transport (20% korting)" : null,
    opt.load_unload_internal ? "Laden/lossen interne locatie" : null,
    opt.load_unload_external ? "Laden/lossen externe locatie" : null,
    opt.km_levy ? "Kilometerheffing" : null
  ].filter(Boolean).join(", ") || "-";
  addLabelValue(doc, "Opties:", optsTxt, margin, y); y += 8;

  // Resultaat (kop)
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Resultaat", margin, y); y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  addLabelValue(doc, "Afstand:", `${quote?.derived?.distance_km ?? 0} km`, margin, y);
  y += 8;

  // Labels voor zichtbare posten
  const labels = {
    handling_approach: "Aanrijden",
    handling_depart: "Afrijden",
    handling_load_unload: "Laden/Lossen",
    km_levy: "Kilometerheffing",
    accessorials: "Bijkosten",
    zone_flat: "Zonetoeslag",
    discount: "Korting gecombineerd transport"
  };

  // Bouw zichtbare items (handling load+unload samenvoegen)
  const bd = quote?.breakdown || {};
  const items = [];

  const loadUnload = Number(bd.handling_load || 0) + Number(bd.handling_unload || 0);
  if (Math.abs(loadUnload) >= 0.005) items.push(["handling_load_unload", loadUnload]);

  if (Math.abs(Number(bd.handling_approach || 0)) >= 0.005) items.push(["handling_approach", bd.handling_approach]);
  if (Math.abs(Number(bd.handling_depart || 0)) >= 0.005)   items.push(["handling_depart", bd.handling_depart]);

  for (const [k, v] of Object.entries(bd)) {
    if (HIDDEN_KEYS.has(k)) continue;                // verberg base/linehaul/fuel
    if (k.startsWith("handling_")) continue;         // reeds verwerkt
    if (Math.abs(Number(v || 0)) < 0.005) continue;  // skip 0-regels
    items.push([k, v]);
  }

  // Alleen renderen als er echt regels zijn
  if (items.length) {
    for (const [k, v] of items) {
      if (y > 270) { doc.addPage(); y = margin; }
      const isDiscount = k === "discount" && Number(v) < 0;
      doc.setTextColor(0, 0, 0);
      doc.text(labels[k] || k, margin, y);
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

  // Totaal
  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("Totaal", margin, y);
  doc.text(eur(quote?.total ?? 0), 210 - margin, y, { align: "right" });

  const safeRef = (reference || "offerte").replace(/[^\w.-]+/g, "_");
  const fileName = `Transportberekening_${safeRef}.pdf`;
  doc.save(fileName);
}
