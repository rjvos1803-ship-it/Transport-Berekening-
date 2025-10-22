import { useState } from 'react'
import { exportQuoteToPDF } from './lib/pdfutil.js'

const TRAILER_LABELS = {
  tautliner: 'Tautliner',
  mega: 'Open oplegger',
  koel: 'Dieplader',
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
    from: '',
    to: '',
    trailer_type: 'tautliner',
    load_grade: 'quarter',
    city_delivery: false,
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
      from: '',
      to: '',
      trailer_type: 'tautliner',
      load_grade: 'quarter',
      city_delivery: false,
      load: false,
      unload: false,
      km_levy: false,
    })
    setQuote(null)
    setError('')
  }

  const submit = async (e) => {
    e.preventDefault()
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
            load: form.load,
            unload: form.unload,
            km_levy: form.km_levy,
            load_grade: form.load_grade,
            load_fraction: loadObj.value
          }
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Mislukt')
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

  const exportPDF = async () => { if (quote) await exportQuoteToPDF(quote) }

  return (
    <div style={{ minHeight: '100vh', padding: '24px', maxWidth: '900px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '12px' }}>Transporttarief berekening</h1>

      <form onSubmit={submit} style={{ display: 'grid', gap: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <input name="from" placeholder="Van (adres/postcode)" value={form.from} onChange={onChange} required style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '8px' }} />
          <input name="to" placeholder="Naar (adres/postcode)" value={form.to} onChange={onChange} required style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '8px' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <select name="trailer_type" value={form.trailer_type} onChange={onChange} style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '8px' }}>
            <option value="tautliner">Tautliner</option>
            <option value="mega">Open oplegger</option>
            <option value="koel">Dieplader</option>
          </select>

          <select name="load_grade" value={form.load_grade} onChange={onChange} style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '8px' }}>
            {LOAD_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>

          <div />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="checkbox" name="city_delivery" checked={form.city_delivery} onChange={onChange} /> Binnenstad
          </label>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="checkbox" name="load" checked={form.load} onChange={onChange} /> Laden
          </label>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="checkbox" name="unload" checked={form.unload} onChange={onChange} /> Lossen
          </label>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="checkbox" name="km_levy" checked={form.km_levy} onChange={onChange} /> Kilometerheffing toepassen (€ 0,12/km)
          </label>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="submit" disabled={loading} style={{ background: '#000', color: '#fff', padding: '10px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}>
            {loading ? 'Berekenen…' : 'Bereken tarief'}
          </button>
          <button type="button" onClick={clearAll} style={{ background: '#666', color: '#fff', padding: '10px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}>
            Leegmaken
          </button>
          <button type="button" onClick={exportPDF} disabled={!quote} style={{ background: '#0b5', color: '#fff', padding: '10px 16px', border: 'none', borderRadius: '8px', cursor: !quote ? 'not-allowed' : 'pointer' }}>
            Exporteer naar PDF
          </button>
        </div>
      </form>

      {error && <p style={{ color: '#b00020', marginTop: '12px' }}>Fout: {error}</p>}

      {quote && (
        <div style={{ marginTop: '16px', border: '1px solid #e5e5e5', borderRadius: '12px', padding: '16px' }}>
          <h2 style={{ fontWeight: 600, marginBottom: '8px' }}>Resultaat</h2>
          <p><strong>Afstand:</strong> {quote.derived.distance_km} km</p>
          <p><strong>Beladingsgraad:</strong> {quote.inputs?.options?.load_fraction ? `${(quote.inputs.options.load_fraction*100).toFixed(0)}%` : '—'} ({quote.inputs?.load_label || '—'})</p>
          <p><strong>Tijd aan-/afrijden + laden/lossen:</strong> {quote.derived.handling_total_hours} uur</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '24px', rowGap: '4px', marginTop: '8px' }}>
            {Object.entries(quote.breakdown).map(([k, v]) => {
              const label = BREAKDOWN_NL[k] ?? k
              return (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{label}</span><span>€ {Number(v).toFixed(2)}</span>
                </div>
              )
            })}
          </div>
          <hr style={{ margin: '12px 0' }} />
          <p style={{ fontSize: '20px' }}><strong>Totaal:</strong> € {Number(quote.total).toFixed(2)}</p>
        </div>
      )}
    </div>
  )
}


