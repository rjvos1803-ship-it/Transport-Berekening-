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
  weight_comp: 'Gewichtstoeslag',
  area_comp: 'Oppervlaktetoeslag',
  combi_discount: 'Combi-korting',
  fuel: 'Brandstoftoeslag',
  zone_flat: 'Zonetoeslag',
}

export default function App() {
  const [form, setForm] = useState({
    from: '',
    to: '',
    area_m2: '',
    weight_kg: '',
    trailer_type: 'tautliner',
    adr: false,
    city_delivery: false,
    load: false,
    unload: false,
    combi: false,
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
      area_m2: '',
      weight_kg: '',
      trailer_type: 'tautliner',
      adr: false,
      city_delivery: false,
      load: false,
      unload: false,
      combi: false,
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
      const res = await fetch('/.netlify/functions/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: form.from,
          to: form.to,
          area_m2: Number(form.area_m2 || 0),
          weight_kg: Number(form.weight_kg || 0),
          trailer_type: form.trailer_type,
          options: {
            adr: form.adr,
            city_delivery: form.city_delivery,
            load: form.load,
            unload: form.unload,
            combi: form.combi,
            km_levy: form.km_levy,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Mislukt')
      data.inputs.trailer_type_label =
        TRAILER_LABELS[data.inputs.trailer_type] || data.inputs.trailer_type
      setQuote(data)
    } catch (err) {
      setError(String(err.message || err))
    } finally {
      setLoading(false)
    }
  }

  const exportPDF = async () => {
    if (quote) await exportQuoteToPDF(quote)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: '24px',
        maxWidth: '900px',
        margin: '0 auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '12px' }}>
        Transporttarief berekening
      </h1>

      <form onSubmit={submit} style={{ display: 'grid', gap: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <input
            name="from"
            placeholder="Van (adres/postcode)"
            value={form.from}
            onChange={onChange}
            required
            style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '8px' }}
          />
          <input
            name="to"
            placeholder="Naar (adres/postcode)"
            value={form.to}
            onChange={onChange}
            required
            style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '8px' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <input
            name="area_m2"
            type="number"
            step="0.01"
            placeholder="Vloeroppervlakte (m²)"
            value={form.area_m2}
            onChange={onChange}
            style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '8px' }}
          />
          <input
            name="weight_kg"
            type="number"
            step="1"
            placeholder="Gewicht (kg)"
            value={form.weight_kg}
            onChange={onChange}
            style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '8px' }}
          />
          <select
            name="trailer_type"
            value={form.trailer_type}
            onChange={onChange}
            style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '8px' }}
          >
            <option value="tautliner">Tautliner</option>
            <option value="mega">Open oplegger</option>
            <option value="koel">Dieplader</option>
          </select>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '8px',
            alignItems: 'center',
          }}
        >
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="checkbox" name="adr" checked={form.adr} onChange={onChange} /> ADR
          </label>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              type="checkbox"
              name="city_delivery"
              checked={form.city_delivery}
              onChange={onChange}
            />{' '}
            Binnenstad
          </label>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="checkbox" name="load" checked={form.load} onChange={onChange} /> Laden
          </label>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="checkbox" name="unload" checked={form.unload} onChange={onChange} /> Lossen
          </label>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="checkbox" name="combi" checked={form.combi} onChange={onChange} /> Combi-transport
            (10% korting)
          </label>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="checkbox" name="km_levy" checked={form.km_levy} onChange={onChange} /> Kilometerheffing
            toepassen (€ 0,12/km)
          </label>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={loading}
            style={{
              background: '#000',
              color: '#fff',
              padding: '10px 16px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {loading ? 'Berekenen…' : 'Bereken tarief'}
          </button>
          <button
            type="button"
            onClick={clearAll}
            style={{
              background: '#666',
              color: '#fff',
              padding: '10px 16px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Leegmaken
          </button>
          <button
            type="button"
            onClick={exportPDF}
            disabled={!quote}
            style={{
              background: '#0b5',
              color: '#fff',
              padding: '10px 16px',
              borderRadius: '8px',
              border: 'none',
              cursor: !quote ? 'not-allowed' : 'pointer',
            }}
          >
            Exporteer naar PDF
          </button>
        </div>
      </form>

      {error && <p style={{ color: '#b00020', marginTop: '12px' }}>Fout: {error}</p>}

      {quote && (
        <div
          style={{
            marginTop: '16px',
            border: '1px solid #e5e5e5',
            borderRadius: '12px',
            padding: '16px',
          }}
        >
          <h2 style={{ fontWeight: 600, marginBottom: '8px' }}>Resultaat</h2>
          <p><strong>Afstand:</strong> {quote.derived.distance_km} km</p>
          <p>
            <strong>Vulling:</strong>{' '}
            {quote.derived.usage_ratio ? `${(quote.derived.usage_ratio * 100).toFixed(0)}%` : '—'}
          </p>
          <p>
            <strong>Tijd aan-/afrijden + laden/lossen:</strong>{' '}
            {quote.derived.handling_total_hours} uur
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              columnGap: '24px',
              rowGap: '4px',
              marginTop: '8px',
            }}
          >
            {Object.entries(quote.breakdown).map(([k, v]) => {
              const label = BREAKDOWN_NL[k] ?? k
              return (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{label}</span>
                  <span>€ {Number(v).toFixed(2)}</span>
                </div>
              )
            })}
          </div>

          <hr style={{ margin: '12px 0' }} />
          <p style={{ fontSize: '20px' }}>
            <strong>Totaal:</strong> € {Number(quote.total).toFixed(2)}
          </p>
        </div>
      )}
    </div>
  )
}

