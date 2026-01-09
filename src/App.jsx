import React, { useMemo, useState } from "react";
import { exportQuoteToPDF } from "./lib/pdfutil.js";

const TRAILERS = [
  { value: "vlakke", label: "Vlakke trailer" },
  { value: "uitschuif", label: "Uitschuif trailer" },
  { value: "diepladen", label: "Diepladen" },
  { value: "tautliner", label: "Tautliner" },
];

const LOAD_GRADES = [
  { value: "pallet_1x", label: "1× pallet" },
  { value: "quarter", label: "¼ trailer" },
  { value: "half", label: "½ trailer" },
  { value: "three_quarter", label: "¾ trailer" },
  { value: "full", label: "Volle trailer" },
];

const DEPOTS = [
  { value: "alblasserdam", label: "Alblasserdam" },
  { value: "demeern", label: "De Meern" },
  { value: "groningen", label: "Groningen" },
  { value: "mook", label: "Mook" },
];

export default function App() {
  const [reference, setReference] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [trailerType, setTrailerType] = useState("vlakke");
  const [loadGrade, setLoadGrade] = useState("full");

  // NEW: depotkeuze (radiobuttons)
  const [depot, setDepot] = useState("alblasserdam");

  // Laden/lossen locatie (kies één)
  // (UI: interne / externe) — geen "geen specifieke optie" meer
  const [loadUnloadLocation, setLoadUnloadLocation] = useState("external"); // default

  // Opties
  const [autolaadKraan, setAutolaadKraan] = useState(false);
  const [kmLevy, setKmLevy] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [quote, setQuote] = useState(null);

  const trailerLabel = useMemo(
    () => TRAILERS.find(t => t.value === trailerType)?.label || trailerType,
    [trailerType]
  );
  const loadGradeLabel = useMemo(
    () => LOAD_GRADES.find(l => l.value === loadGrade)?.label || loadGrade,
    [loadGrade]
  );
  const depotLabel = useMemo(
    () => DEPOTS.find(d => d.value === depot)?.label || depot,
    [depot]
  );

  async function onCalculate() {
    setErr("");
    setQuote(null);

    if (!from.trim() || !to.trim()) {
      setErr("Van en Naar zijn verplicht.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/.netlify/functions/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: reference?.trim() || "",
          from: from.trim(),
          to: to.trim(),
          trailer_type: trailerType,
          load_grade: loadGrade,
          depot, // NEW
          options: {
            autolaad_kraan: !!autolaadKraan,
            km_levy: !!kmLevy,
            load_unload_location: loadUnloadLocation, // "internal" | "external"
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || "Internal error");
      }
      setQuote(data);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  function onClear() {
    setReference("");
    setFrom("");
    setTo("");
    setTrailerType("vlakke");
    setLoadGrade("full");
    setDepot("alblasserdam");
    setLoadUnloadLocation("external");
    setAutolaadKraan(false);
    setKmLevy(false);
    setErr("");
    setQuote(null);
  }

  async function onPDF() {
    if (!quote) return;
    await exportQuoteToPDF(quote, {
      reference: quote?.inputs?.reference || reference || "",
      logoUrl: "/logo.jpg",
      company: "The Coatinc Company",
      title: "Coatinc Transport berekening",
    });
  }

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial", background: "#f7f7f8", minHeight: "100vh", padding: 24 }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 16px", fontSize: 28 }}>Transportberekening</h1>

        <div style={{ background: "#fff", borderRadius: 12, padding: 18, boxShadow: "0 1px 8px rgba(0,0,0,.06)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Referentie</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Offerte / orderreferentie"
                style={inputStyle}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Van</label>
                <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Adres / postcode" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Naar</label>
                <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Adres / postcode" style={inputStyle} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 220px", gap: 14, alignItems: "end" }}>
              <div>
                <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Trailertype</label>
                <select value={trailerType} onChange={(e) => setTrailerType(e.target.value)} style={inputStyle}>
                  {TRAILERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Beladingsgraad</label>
                <select value={loadGrade} onChange={(e) => setLoadGrade(e.target.value)} style={inputStyle}>
                  {LOAD_GRADES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>

              {/* NEW: Depotkeuze */}
              <div>
                <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Vertrekpunt depot</label>
                <select value={depot} onChange={(e) => setDepot(e.target.value)} style={inputStyle}>
                  {DEPOTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={onCalculate} disabled={loading} style={btnPrimary}>
                  {loading ? "Bezig..." : "Bereken tarief"}
                </button>
                <button onClick={onClear} style={btnGhost}>Leegmaken</button>
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Laden/lossen locatie</div>
              <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                <label style={radioLabel}>
                  <input
                    type="radio"
                    name="luloc"
                    checked={loadUnloadLocation === "internal"}
                    onChange={() => setLoadUnloadLocation("internal")}
                  />
                  <span>Interne locatie</span>
                </label>
                <label style={radioLabel}>
                  <input
                    type="radio"
                    name="luloc"
                    checked={loadUnloadLocation === "external"}
                    onChange={() => setLoadUnloadLocation("external")}
                  />
                  <span>Externe locatie</span>
                </label>
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Opties</div>
              <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                <label style={checkLabel}>
                  <input type="checkbox" checked={autolaadKraan} onChange={(e) => setAutolaadKraan(e.target.checked)} />
                  <span>Autolaadkraan</span>
                </label>

                <label style={checkLabel}>
                  <input type="checkbox" checked={kmLevy} onChange={(e) => setKmLevy(e.target.checked)} />
                  <span>Kilometerheffing</span>
                </label>
              </div>
            </div>

            {err ? (
              <div style={{ background: "#ffeaea", border: "1px solid #ffb6b6", color: "#a40000", padding: 12, borderRadius: 8 }}>
                {err}
              </div>
            ) : null}
          </div>
        </div>

        {quote ? (
          <div style={{ marginTop: 16, background: "#fff", borderRadius: 12, padding: 18, boxShadow: "0 1px 8px rgba(0,0,0,.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Resultaat</h2>
              <button onClick={onPDF} style={btnPrimary}>PDF downloaden</button>
            </div>

            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <KV label="Afstand" value={`${quote?.derived?.distance_km ?? 0} km`} />
              <KV label="Vertrekpunt" value={quote?.inputs?.depot_label || depotLabel} />
              <KV label="Trailertype" value={quote?.inputs?.trailer_type_label || trailerLabel} />
              <KV label="Beladingsgraad" value={quote?.inputs?.load_grade_label || loadGradeLabel} />
            </div>

            {/* Kosten: let op, kilometerkosten en brandstof verbergen we in UI */}
            <div style={{ marginTop: 14, borderTop: "1px solid #eee", paddingTop: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 1fr 140px", gap: 10 }}>
                <Row label="Aanrijden" value={quote?.breakdown?.handling_approach} />
                <Row label="Afrijden" value={quote?.breakdown?.handling_depart} />
                <Row label="Laden/Lossen" value={quote?.breakdown?.handling_load_unload} />
                <Row label="Kilometerheffing" value={quote?.breakdown?.km_levy} />
              </div>

              <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontWeight: 800, fontSize: 18 }}>Totaal</div>
                <div style={{ fontWeight: 900, fontSize: 20 }}>{eur(quote?.total ?? 0)}</div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function eur(n) {
  return `€ ${Number(n ?? 0).toFixed(2)}`;
}

function KV({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <div style={{ color: "#444" }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Row({ label, value }) {
  const v = Number(value ?? 0);
  if (!value || Math.abs(v) < 0.005) return null; // 0-regels verbergen
  return (
    <>
      <div style={{ color: "#333" }}>{label}</div>
      <div style={{ textAlign: "right", fontWeight: 700 }}>{eur(v)}</div>
    </>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #dcdcdc",
  outline: "none",
  background: "#fff",
};

const btnPrimary = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #0a7",
  background: "#0a7",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};

const btnGhost = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  color: "#111",
  fontWeight: 700,
  cursor: "pointer",
};

const radioLabel = { display: "flex", alignItems: "center", gap: 10 };
const checkLabel = { display: "flex", alignItems: "center", gap: 10 };
