// src/App.jsx
import { useState } from 'react'
import { exportQuoteToPDF } from './lib/pdfutil.js'

const TRAILER_LABELS = {
  vlakke: 'Vlakke trailer',
  uitschuif: 'Uitschuif trailer',
  dieplader: 'Dieplader',
  tautliner: 'Tautliner',
}

const BREAKDOWN_NL = {
  base: 'Basistarief',
  linehaul: 'Kilometerkosten',
  handling: 'Behandelingskosten (aan-/afrijden + laden/lossen)',
  km_levy: 'Kilometerheffing',
  accessorials: 'Bijkosten',
  fuel: 'Brandstoftoeslag',
  zone_flat: 'Zonetoeslag',
}

const LOAD_OPTIONS = [
  { key: 'one_pallet', label: '1× pallet', value: 0.05 },
  { key: 'quarter', label: '¼ trailer', value: 0.25 },
  { key: 'half', label: '½ trailer', value: 0.5 },
  { key: 'three_quarter', label: '¾ trailer', value: 0.75 },
  { key: 'full', label: 'Volle trailer', value: 1.0 },
]

export default function App() {
  const [form, setForm] = useState({
    reference: '',
    from: '',
    to: '',
    trailer_type: 'vlakke',
    load_grade: 'quarter',
    city_delivery: false,
    autolaad_kraan: false,
    load: false,
    unload: false,
    km_levy: false,
  })
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const onChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  const clearAll = () => {
    setForm({
      reference: '',
      from: '',
      to: '',
      trailer_type: 'vlakke',
      load_grade: 'quarter',
      city_delivery: false,
      autolaad_kraan: false,
      load: false,
      unload: false,
      km_levy: false,
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
            load: form.load,
            unload: form.unload,
            km_levy: form.km_levy,
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <img src="/logo.jpg" alt="Logo" className="h-8 w-auto"
               onError={(e)=>{e.currentTarget.style.display='none'}} />
          <h1 className="text-xl font-semibold">Transporttarief berekening</h1>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        <form onSubmit={submit} className="grid gap-4">
          {/* Rij 1 */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white border rounded-xl p-4 shadow-sm">
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

            <div className="bg-white border rounded-xl p-4 shadow-sm">
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

            <div className="bg-white border rounded-xl p-4 shadow-sm">
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

          {/* Rij 2 */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-white border rounded-xl p-4 shadow-sm">
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

            <div className="bg-white border rounded-xl p-4 shadow-sm">
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

            <div className="bg-white border rounded-xl p-4 shadow-sm">
              <span className="block text-sm font-medium mb-2">Opties</span>
              <label className="flex items-center gap-2 mb-1">
                <input type="checkbox" name="city_delivery" checked={form.city_delivery} onChange={onChange} />
                <span>Binnenstad</span>
              </label>
              <label className="flex items-center gap-2 mb-1">
                <input type="checkbox" name="autolaad_kraan" checked={form.autolaad_kraan} onChange={onChange} />
                <span>Autolaadkraan</span>
              </label>
              <label className="flex items-center gap-2 mb-1">
                <input type="checkbox" name="load" checked={form.load} onChange={onChange} />
                <span>Laden</span>
              </label>
              <label className="flex items-center gap-2 mb-1">
                <input type="checkbox" name="unload" checked={form.unload} onChange={onChange} />
                <span>Lossen</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="km_levy" checked={form.km_levy} onChange={onChange} />
                <span>Kilometerheffing toepassen</span>
              </label>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 text-red-800 border border-red-200 rounded-xl p-3">
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 bg-black text-white px-4 py-2 rounded-lg disabled:opacity-60"
            >
              {loading ? 'Berekenen…' : 'Bereken tarief'}
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-2 bg-gray-700 text-white px-4 py-2 rounded-lg"
            >
              Leegmaken
            </button>
            <button
              type="button"
              onClick={downloadPDF}
              disabled={!quote}
              className="inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg disabled:opacity-60"
            >
              Download PDF
            </button>
          </div>
        </form>

        {quote && (
          <div className="mt-6 bg-white border rounded-xl shadow-sm p-4">
            <h2 className="font-semibold mb-3">Resultaat</h2>

            <div className="grid sm:grid-cols-2 gap-y-1 gap-x-8 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Afstand</span>
                <span className="font-medium">{quote.derived.distance_km} km</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Beladingsgraad</span>
                <span className="font-medium">
                  {quote.inputs?.options?.load_fraction ? `${(quote.inputs.options.load_fraction*100).toFixed(0)}%` : '—'}
                  {quote.inputs?.load_label ? ` (${quote.inputs.load_label})` : ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Tijd aan-/afrijden + laden/lossen</span>
                <span className="font-medium">{quote.derived.handling_total_hours} uur</span>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-2 mt-3">
              {Object.entries(quote.breakdown).map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="text-gray-600">{BREAKDOWN_NL[k] ?? k}</span>
                  <span className="font-medium">€ {Number(v).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <hr className="my-3" />
            <div className="text-lg">
              <span className="font-semibold">Totaal: </span>
              <span className="font-bold">€ {Number(quote.total).toFixed(2)}</span>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
