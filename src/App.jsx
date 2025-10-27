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
  accessorials: "Bijkosten",
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
    options: {
      city_delivery: false,
      autolaad_kraan: false,
      combined: false,
      km_levy: false,
      load_unload_internal: false,
      load_unload_external: false
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
    setForm((f) => {
      const opts = { ...f.options, [key]: !f.options[key] };
      // exclusiviteit: extern > intern (niet beiden tegelijk)
      if (key === "load_unload_external" && !f.options[key]) {
        opts.load_unload_internal = false;
      }
      if (key === "load_unload_internal" && !f.options[key]) {
        opts.load_unload_external = false;
      }
      return { ...f, options: opts };
    });
  }

  async function onQuote(e) {
    e?.preventDefault?.();
    setError("");
    if (!form.reference.trim()) {
      setError("Vul een referentie in (verplicht).");
      return;
    }
    if (!form.from.trim() || !form.to.trim()) {
      setError("Vul zowel Van als Naar in.");
      return;
    }
    try {
      setBusy(true);
      const payload = {
        from: form.from,
        to: form.to,
        trailer_type: form.trailer_type,
        options: {
          ...form.options,
          load_grade: form.load_grade
        }
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
      options: {
        city_delivery: false,
        autolaad_kraan: false,
        combined: false,
        km_levy: false,
        load_unload_internal: false,
        load_unload_external: false
      }
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

  // Bouw de tabelregels voor weergave (UI)
  function buildVisibleRows(breakdown = {}) {
    const rows = [];

    // Laden/Lossen combineren
    const loadUnload = Number(breakdown.handling_load || 0) + Number(breakdown.handling_unload || 0);
    if (Math.abs(loadUnload) >= 0.005) {
      rows.push(["handling_load_unload", loadUnload]);
    }

    // Aanrijden
    if (Math.abs(Number(breakdown.handling_approach || 0)) >= 0.005) {
      rows.push(["handling_approach", breakdown.handling_approach]);
    }

    // Afrijden
    if (Math.abs(Number(breakdown.handling_depart || 0)) >= 0.005) {
      rows.push(["handling_depart", breakdown.handling_depart]);
    }

    // Overige reguliere posten (filter op verborgen + 0,00)
    for (const [k, v] of Object.entries(breakdown)) {
      if (HIDDEN_KEYS.has(k)) continue; // verberg base/linehaul/fuel
      if (k.startsWith("handling_")) continue; // deze deden we al
      if (Math.abs(Number(v || 0)) < 0.005) continue;
      rows.push([k, v]);
    }

    // Label mapping
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
              <label className="block text-sm font-medium mb-1">Referentie <span className="text-rose-600">*</span></label>
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

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.options.city_delivery}
                onChange={() => onToggleOption("city_delivery")}
              />
              <span>Binnenstad</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.options.load_unload_internal}
                onChange={() => onToggleOption("load_unload_internal")}
                disabled={form.options.load_unload_external}
              />
              <span>Laden/lossen interne locatie</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.options.load_unload_external}
                onChange={() => onToggleOption("load_unload_external")}
                disabled={form.options.load_unload_internal}
              />
              <span>Laden/lossen externe locatie</span>
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
                    {visibleRows.map(([label, value]) => (
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
