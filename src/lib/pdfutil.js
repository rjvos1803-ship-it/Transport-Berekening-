// src/lib/pdfutil.js
function eur(n) {
  return `€ ${Number(n ?? 0).toFixed(2)}`;
}
function line(doc, x1, y1, x2, y2, gray = 0.85) {
  doc.setDrawColor(gray * 255);
  doc.line(x1, y1, x2, y2);
}
function addLabelValue(doc, label, value, x, y, labelW = 45) {
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

export async function exportQuoteToPDF(quote, meta = {}) {
  const { default: jspdfNS } = await import("jspdf");
  const jsPDF = jspdfNS.jsPDF || jspdfNS;

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

  const {
    reference = "",
    logoUrl = "/logo.jpg",
    company = "The Coatinc Company",
    title = "Coatinc Transport berekening",
  } = meta;

  const margin = 15;
  let y = margin;

  // Header
  if (logoUrl) {
    const dataURL = await loadImageAsDataURL(logoUrl);
    if (dataURL) doc.addImage(dataURL, "JPEG", margin, y - 2, 30, 0);
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

  // Meta
  addLabelValue(doc, "Referentie:", quote?.inputs?.reference || reference || "-", margin, y);
  addLabelValue(doc, "Datum:", new Date().toLocaleDateString("nl-NL"), 120, y);
  y += 8;

  // Invoer
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Invoer", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  addLabelValue(doc, "Vertrekpunt:", quote?.inputs?.depot_label || "-", margin, y);
  addLabelValue(doc, "Trailertype:", quote?.inputs?.trailer_type_label || "-", 120, y);
  y += 6;

  addLabelValue(doc, "Van:", quote?.inputs?.from || "-", margin, y);
  addLabelValue(doc, "Naar:", quote?.inputs?.to || "-", 120, y);
  y += 6;

  addLabelValue(doc, "Beladingsgraad:", quote?.inputs?.load_grade_label || "-", margin, y);
  y += 8;

  // Resultaat
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Resultaat", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  addLabelValue(doc, "Afstand:", `${quote?.derived?.distance_km ?? 0} km`, margin, y);
  addLabelValue(doc, "Uurtarief handling:", `${eur(quote?.derived?.rate_used ?? 0)}/u`, 120, y);
  y += 6;

  // uren tonen (zoals jij wil)
  const ah = Number(quote?.derived?.approach_hours ?? 0);
  const dh = Number(quote?.derived?.depart_hours ?? 0);
  const luh = Number(quote?.derived?.load_unload_hours_total ?? 0);

  addLabelValue(doc, "Aanrijtijd:", `${ah.toFixed(2)} u`, margin, y);
  addLabelValue(doc, "Afrijtijd:", `${dh.toFixed(2)} u`, 120, y);
  y += 6;

  addLabelValue(doc, "Laden/Lossen:", `${luh.toFixed(2)} u`, margin, y);
  y += 8;

  // Kosten (alleen niet-0, en we verbergen linehaul+fuel+base in PDF)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Kosten", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const rows = [
    ["Aanrijden", quote?.breakdown?.handling_approach],
    ["Afrijden", quote?.breakdown?.handling_depart],
    ["Laden/Lossen", quote?.breakdown?.handling_load_unload],
    ["Kilometerheffing", quote?.breakdown?.km_levy],
  ].filter(([, v]) => v != null && Math.abs(Number(v)) >= 0.005);

  for (const [label, v] of rows) {
    doc.text(label, margin, y);
    doc.setFont("helvetica", "bold");
    doc.text(eur(v), 210 - margin, y, { align: "right" });
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

  const safeRef = (quote?.inputs?.reference || reference || "offerte").replace(/[^\w.-]+/g, "_");
  doc.save(`Transportberekening_${safeRef}.pdf`);
}
