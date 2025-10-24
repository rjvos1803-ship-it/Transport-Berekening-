// src/App.jsx
import { useState } from 'react'
import { exportQuoteToPDF } from './lib/pdfutil.js'

const TRAILER_LABELS = {
  vlakke: 'Vlakke trailer',
  uitschuif: 'Uitschuif trailer',
  dieplader: 'Dieplader',
  tautliner: 'Tautliner',
}

const LABELS = {
  base: 'Basistarief',
  handling_approach: 'Aanrijden',
  handling_combined: 'Laden/lossen',  // NIEUWE samengevoegde regel (UI)
  handling_depart: 'Afrijden',
  km_levy: 'Kilometerheffing',
  accessorials: 'Bijkosten',
  zone_flat: 'Zonetoeslag',
  discount: 'Korting gecombineerd transport',
}

const LOAD_OPTIONS = [
  { key: 'one_pallet', label: '1× pallet', value: 0.05 },
  { key: 'quarter', label: '¼ trailer', value: 0.25 },
  { key: 'half', label: '½ trailer', value: 0.5 },
  { key: 'three_quarter', label: '¾ trailer', value: 0.75 },
  { key: 'full', label: 'Volle trailer', value: 1.0 },
]

// Volgorde (linehaul & fuel NIET tonen)
const ORDER = [
  'base',
  'handling_approach',
  'handling_combined', // synthese van load + unload
  'handling_depart',
  'km_levy',
  'accessorials',
  'zone_flat',
  'discount',
]

export default function App() {
  const [form, setForm] = useState({
    reference: '',
    from: '',
    to: '',
    trailer_type: 'vlakke',
    load_grade: 'half',
    city_delivery: false,
    autolaad_kraan: false,
    combined: false,
    km_levy: false,
    load_unload_internal: false,
    load_unload_external: false,
  })
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const onChange = (e) => {
    const { name, value, type, checked } = e.target
    // exclusief
    if (name === 'load_unload_internal' && checked) {
      setForm((f) => ({ ...f, load_unload_internal: true, load_unload_external: false }))
      return
    }
    if (name === 'load_unload_external' && checked) {
      setForm((f) => ({ ...f, load_unload_internal: false, load_unload_external: true }))
      return
    }
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  const clearAll = () => {
    setForm({
      reference: '',
      from: '',
      to: '',
      trailer_type: 'vlakke',
      load_grade: 'half',
      city_delivery: false,
      autolaad_kraan: false,
      combined: false,
      km_levy: false,
      load_unload_internal: false,
      load_unload_external: false,
    })
    setQuote(null)
    setError('')
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.reference.trim()) {
      setError('Vul een referentie in.')
      return
    }
    setLoading(true)
    setError('')
    setQuote(null)
    try {
      const loadObj = LOAD_OPTIONS.find(o => o.key === form.load_grade) || LOAD_OPTIONS[0]
      const res = await fetch('/.netlify/functions/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: form.from,
          to: form.to,
          trailer_type: form.trailer_type,
          options: {
            city_delivery: form.city_delivery,
            autolaad_kraan: form.autolaad_kraan,
            combined: form.combined,
            km_levy: form.km_levy,
            load_unload_internal: form.load_unload_internal,
            load_unload_external: form.load_unload_external,
            load_grade: form.load_grade,
            load_fraction: loadObj.value
          }
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || data.error || 'Berekening mislukt')

      data.inputs.trailer_type_label =
        TRAILER_LABELS[data.inputs.trailer_type] || data.inputs.trailer_type
      data.inputs.load_label = loadObj.label

      setQuote(data)
    } catch (err) {
      setError(String(err.message || err))
    } finally {
      setLoading(false)
    }
  }

  const downloadPDF = async () => {
    if (!quote) return
    await exportQuoteToPDF(quote, {
      reference: form.reference,
      logoUrl: '/logo.jpg',
      company: 'The Coatinc Company',
      title: 'Coatinc Transport berekening'
    })
  }

  // Maak een synthese voor weergave (laden + lossen)
  const combineHandling = (q) => {
    if (!q?.breakdown) return {}
    const combined = (Number(q.breakdown.handling_load || 0) + Number(q.breakdown.handling_unload || 0))
    return {
      ...q.breakdown,
      handling_combined: Number(combined.toFixed(2))
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <img src="/logo.jpg" alt="Logo" className="h-8 w-auto"
               onError={(e)=>{e.currentTarget.style.display='none'}} />
          <h1 className="text-xl font-semibold">Transporttarief berekening</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white border rounded-2xl p-4 shadow-sm">
              <label className="block text-sm font-medium mb-1">
                Referentie <span className="text-red-600">*</span>
              </label>
              <input
                name="reference"
                value={form.reference}
                onChange={onChange}
                required
                placeholder="Bijv. ORD-2025-001"
                className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>

            <div className="bg-white border rounded-2xl p-4 shadow-sm">
              <label className="block text-sm font-medium mb-1">Van (adres / postcode)</label>
              <input
                name="from"
                value={form.from}
                onChange={onChange}
                required
                placeholder="Bijv. Harderwijkerweg 31 3888LP"
                className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>

            <div className="bg-white border rounded-2xl p-4 shadow-sm">
              <label className="block text-sm font-medium mb-1">Naar (adres / postcode)</label>
              <input
                name="to"
                value={form.to}
                onChange={onChange}
                required
                placeholder="Bijv. Edisonweg 5 2952AD"
                className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white border rounded-2xl p-4 shadow-sm">
              <label className="block text-sm font-medium mb-1">Trailertype</label>
              <select
                name="trailer_type"
                value={form.trailer_type}
                onChange={onChange}
                className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"
              >
                <option value="vlakke">Vlakke trailer</option>
                <option value="uitschuif">Uitschuif trailer</option>
                <option value="dieplader">Dieplader</option>
                <option value="tautliner">Tautliner</option>
              </select>
            </div>

            <div className="bg-white border rounded-2xl p-4 shadow-sm">
              <label className="block text-sm font-medium mb-1">Beladingsgraad</label>
              <select
                name="load_grade"
                value={form.load_grade}
                onChange={onChange}
                className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"
              >
                {LOAD_OPTIONS.map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="bg-white border rounded-2xl p-4 shadow-sm">
              <span className="block text-sm font-medium mb-2">Opties</span>

              <label className="flex items-center gap-2 mb-1">
                <input
                  type="checkbox"
                  name="load_unload_internal"
                  checked={form.load_unload_internal}
                  onChange={onChange}
                />
                <span>Laden/lossen interne locatie (+0,5 u extra)</span>
              </label>

              <label className="flex items-center gap-2 mb-1">
                <input
                  type="checkbox"
                  name="load_unload_external"
                  checked={form.load_unload_external}
                  onChange={onChange}
                />
                <span>Laden/lossen externe locatie (+1,5 u extra)</span>
              </label>

              <label className="flex items-center gap-2 mb-1">
                <input type="checkbox" name="autolaad_kraan" checked={form.autolaad_kraan} onChange={onChange} />
                <span>Autolaadkraan</span>
              </label>

              <label className="flex items-center gap-2 mb-1">
                <input type="checkbox" name="combined" checked={form.combined} onChange={onChange} />
                <span>Gecombineerd transport (20% korting)</span>
              </label>

              <label className="flex items-center gap-2">
                <input type="checkbox" name="km_levy" checked={form.km_levy} onChange={onChange} />
                <span>Kilometerheffing toepassen</span>
              </label>

              <label className="flex items-center gap-2 mt-1">
                <input type="checkbox" name="city_delivery" checked={form.city_delivery} onChange={onChange} />
                <span>Binnenstad</span>
              </label>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 text-red-800 border border-red-200 rounded-2xl p-3">
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={loading}
              className="inline-flex items-center gap-2 bg-black text-white px-4 py-2 rounded-lg disabled:opacity-60">
              {loading ? 'Berekenen…' : 'Bereken tarief'}
            </button>
            <button type="button" onClick={clearAll}
              className="inline-flex items-center gap-2 bg-gray-700 text-white px-4 py-2 rounded-lg">
              Leegmaken
            </button>
            <button type="button" onClick={downloadPDF} disabled={!quote}
              className="inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg disabled:opacity-60">
              Download PDF
            </button>
          </div>
        </form>

        {/* RESULTAAT */}
        {quote && (
          <section className="mt-6">
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">

              {/* Stats */}
              <div className="grid sm:grid-cols-3 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-gray-200 bg-gray-50/60">
                <div className="p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Afstand</div>
                  <div className="mt-1 text-lg font-semibold">{quote.derived.distance_km} km</div>
                </div>
                <div className="p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Beladingsgraad</div>
                  <div className="mt-1 text-lg font-semibold">
                    {quote.inputs?.options?.load_fraction
                      ? `${(quote.inputs.options.load_fraction * 100).toFixed(0)}%`
                      : '—'}
                    {quote.inputs?.load_label ? (
                      <span className="ml-2 text-sm font-normal text-gray-500">
                        {quote.inputs.load_label}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Uurtarief handling</div>
                  <div className="mt-1 text-lg font-semibold">
                    € {(quote.derived.rate_used ?? 0).toFixed(2)}<span className="text-sm font-normal text-gray-500"> /u</span>
                  </div>
                </div>
              </div>

              {/* Breakdown tabel */}
              <div className="p-4">
                <div className="text-sm font-semibold mb-2">Resultaat</div>

                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="divide-y divide-gray-200">
                    {(() => {
                      const b = combineHandling(quote)
                      return ORDER.map((k) => {
                        // skip fuel & linehaul (we tonen ze sowieso niet in ORDER)
                        const v = b?.[k]
                        if (v == null || Math.abs(Number(v)) < 0.005) return null

                        return (
                          <div key={k} className="grid grid-cols-[1fr_auto] items-center px-4 py-2 bg-white">
                            <div className="text-sm text-gray-600">
                              {LABELS[k] ?? k}
                            </div>
                            <div className={`text-sm font-medium tabular-nums ${k === 'discount' && Number(v) < 0 ? 'text-emerald-600' : ''}`}>
                              € {Number(v).toFixed(2)}
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between rounded-xl bg-gray-900 text-white px-4 py-3">
                  <span className="text-base font-semibold">Totaal</span>
                  <span className="text-lg font-bold tabular-nums">€ {Number(quote.total).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
