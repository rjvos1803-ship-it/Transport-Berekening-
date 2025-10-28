import { useState } from "react";
import { exportQuoteToPDF } from "./lib/pdfutil";

const API_URL = "/.netlify/functions/quote";

// Verberg deze posten in UI (wel meegerekend server-side)
const HIDDEN_KEYS = new Set(["base", "linehaul", "fuel"]);

// Labels voor de breakdown-keys (wat je wél toont)
const LABELS = {
  handling_approach: "Aanrijden",
  handling_depart: "Afrijden",
  handling_load_unload: "Laden/Lossen",
  km_levy: "Kilometerheffing",
  zone_flat: "Zonetoeslag",
  discount: "Korting gecombineerd transport"
};

function eur(n) {
  const v = Number(n ?? 0);
  return `€ ${v.toFixed(2)}`;
}

export default function App() {
  const [form, setForm] = useState({
    reference: "",
    from: "",
    to: "",
    trailer_type: "vlakke",
    load_grade: "full",
    // exclusieve keuze: geen / intern / extern
    load_choice: "none",
    options: {
      autolaad_kraan: false,
      combined: false,
      km_levy: false
    }
  });

  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState("");

  const trailers = [
    { value: "vlakke", label: "Vlakke trailer" },
    { value: "uitschuif", label: "Uitschuif trailer" },
    { value: "dieplader", label: "Dieplader" },
    { value: "tautliner", label: "Tautliner" }
  ];

  const loads = [
    { value: "one_pallet", label: "1× pallet" },
    { value: "quarter", label: "¼ trailer" },
    { value: "half", label: "½ trailer" },
    { value: "three_quarter", label: "¾ trailer" },
    { value: "full", label: "Volle trailer" }
  ];

  function onChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  function onToggleOption(key) {
    setForm((f) => ({ ...f, options: { ...f.options, [key]: !f.options[key] } }));
  }

  function onLoadChoice(e) {
    const v = e.target.value; // "none" | "internal" | "external"
    setForm((f) => ({ ...f, load_choice: v }));
  }

  async function onQuote(e) {
    e?.preventDefault?.();
    setError("");
    if (!form.reference.trim()) return setError("Vul een referentie in (verplicht).");
    if (!form.from.trim() || !form.to.trim()) return setError("Vul zowel Van als Naar in.");

    try {
      setBusy(true);
      const opts = {
        ...form.options,
        load_grade: form.load_grade,
        load_unload_internal: form.load_choice === "internal",
        load_unload_external: form.load_choice === "external"
      };
      const payload = {
        from: form.from,
        to: form.to,
        trailer_type: form.trailer_type,
        options: opts
      };
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Onbekende fout");
      setQuote({ ...data, reference: form.reference });
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  function onReset() {
    setQuote(null);
    setError("");
    setForm({
      reference: "",
      from: "",
      to: "",
      trailer_type: "vlakke",
      load_grade: "full",
      load_choice: "none",
      options: { autolaad_kraan: false, combined: false, km_levy: false }
    });
  }

  async function onPDF() {
    if (!quote) return;
    await exportQuoteToPDF(quote, {
      reference: quote.reference,
      logoUrl: "/logo.jpg",
      company: "The Coatinc Company",
      title: "Coatinc Transport berekening"
    });
  }

  // Bouw tabelregels voor weergave (UI)
  function buildVisibleRows(breakdown = {}) {
    const rows = [];

    // Laden/Lossen combineren als één regel (kosten)
    const loadUnload = Number(breakdown.handling_load || 0) + Number(breakdown.handling_unload || 0);
    if (Math.abs(loadUnload) >= 0.005) rows.push(["handling_load_unload", loadUnload]);

    // Aanrijden / Afrijden
    if (Math.abs(Number(breakdown.handling_approach || 0)) >= 0.005) {
      rows.push(["handling_approach", breakdown.handling_approach]);
    }
    if (Math.abs(Number(breakdown.handling_depart || 0)) >= 0.005) {
      rows.push(["handling_depart", breakdown.handling_depart]);
    }

    // Overige posten (filter base/linehaul/fuel + 0,00)
    for (const [k, v] of Object.entries(breakdown)) {
      if (HIDDEN_KEYS.has(k)) continue;
      if (k.startsWith("handling_")) continue;
      if (Math.abs(Number(v || 0)) < 0.005) continue;
      rows.push([k, v]);
    }

    return rows.map(([k, v]) => [LABELS[k] || k, Number(v)]);
  }

  const visibleRows = buildVisibleRows(quote?.breakdown);

  return (
    <div className="min-h-screen w-full bg-neutral-50 text-neutral-900">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <h1 className="text-2xl font-bold mb-4">Transportberekening</h1>

        <form onSubmit={onQuote} className="grid gap-4 bg-white p-4 rounded-xl shadow">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Referentie <span className="text-rose-600">*</span>
              </label>
              <input
                className="w-full border rounded px-3 py-2"
                name="reference"
                value={form.reference}
                onChange={onChange}
                placeholder="Offerte / orderreferentie"
                required
              />
            </div>
            <div />
            <div>
              <label className="block text-sm font-medium mb-1">Van</label>
              <input
                className="w-full border rounded px-3 py-2"
                name="from"
                value={form.from}
                onChange={onChange}
                placeholder="Adres of plaats (herkomst)"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Naar</label>
              <input
                className="w-full border rounded px-3 py-2"
                name="to"
                value={form.to}
                onChange={onChange}
                placeholder="Adres of plaats (bestemming)"
                required
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Trailertype</label>
              <select
                className="w-full border rounded px-3 py-2"
                name="trailer_type"
                value={form.trailer_type}
                onChange={onChange}
              >
                {trailers.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Beladingsgraad</label>
              <select
                className="w-full border rounded px-3 py-2"
                name="load_grade"
                value={form.load_grade}
                onChange={onChange}
              >
                {loads.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy ? "Berekenen…" : "Bereken tarief"}
              </button>
              <button
                type="button"
                onClick={onReset}
                className="inline-flex items-center justify-center px-4 py-2 rounded border hover:bg-neutral-100"
              >
                Leegmaken
              </button>
            </div>
          </div>

          {/* Exclusieve keuze intern/extern */}
          <fieldset className="grid sm:grid-cols-3 gap-2">
            <legend className="text-sm font-medium mb-1">Laden/lossen locatie (kies één)</legend>

            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="load_choice"
                value="none"
                checked={form.load_choice === "none"}
                onChange={onLoadChoice}
              />
              <span>Geen specifieke optie</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="load_choice"
                value="internal"
                checked={form.load_choice === "internal"}
                onChange={onLoadChoice}
              />
              <span>Interne locatie</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="load_choice"
                value="external"
                checked={form.load_choice === "external"}
                onChange={onLoadChoice}
              />
              <span>Externe locatie</span>
            </label>
          </fieldset>

          <fieldset className="grid sm:grid-cols-3 gap-2">
            <legend className="text-sm font-medium mb-1">Opties</legend>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.options.autolaad_kraan}
                onChange={() => onToggleOption("autolaad_kraan")}
              />
              <span>Autolaadkraan</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.options.combined}
                onChange={() => onToggleOption("combined")}
              />
              <span>Gecombineerd transport</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.options.km_levy}
                onChange={() => onToggleOption("km_levy")}
              />
              <span>Kilometerheffing</span>
            </label>
          </fieldset>

          {!!error && (
            <div className="text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">
              {error}
            </div>
          )}
        </form>

        {/* RESULTAAT */}
        {quote && (
          <div className="mt-6 bg-white rounded-xl shadow">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Resultaat</h2>
                <div className="text-sm text-neutral-600">
                  Afstand: <strong>{quote?.derived?.distance_km ?? 0} km</strong>
                </div>
              </div>
              <div className="text-sm text-neutral-600 mt-1">
                Referentie: <strong>{quote.reference || "-"}</strong>
              </div>
            </div>

            <div className="p-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {buildVisibleRows(quote?.breakdown).map(([label, value]) => (
                      <tr key={label} className="border-b last:border-b-0">
                        <td className="py-2 pr-3">{label}</td>
                        <td className="py-2 pl-3 text-right font-semibold">{eur(value)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-2 pr-3 font-semibold">Totaal</td>
                      <td className="py-2 pl-3 text-right text-emerald-700 font-bold">
                        {eur(quote.total)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Urenoverzicht tonen (zoals gevraagd) */}
              <div className="mt-4 text-sm text-neutral-700">
                <div className="font-medium mb-1">Urenoverzicht</div>
                <ul className="grid sm:grid-cols-4 gap-2">
                  <li>Aanrijden: <strong>{quote?.derived?.approach_hours ?? 0} u</strong></li>
                  <li>Laden: <strong>{quote?.derived?.load_hours ?? 0} u</strong></li>
                  <li>Lossen: <strong>{quote?.derived?.unload_hours ?? 0} u</strong></li>
                  <li>Afrijden: <strong>{quote?.derived?.depart_hours ?? 0} u</strong></li>
                </ul>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={onPDF}
                  className="inline-flex items-center justify-center px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  PDF downloaden
                </button>
                <button
                  onClick={onReset}
                  className="inline-flex items-center justify-center px-4 py-2 rounded border hover:bg-neutral-100"
                >
                  Leegmaken
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
