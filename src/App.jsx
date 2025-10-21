import { useState } from 'react'
import { exportQuoteToPDF } from './lib/pdfutil.js'

const TRAILER_LABELS = {
  tautliner: 'Tautliner',
  mega: 'Open oplegger',
  koel: 'Dieplader'
}

export default function App() {
  const [form, setForm] = useState({
    from: '', to: '', area_m2: '', weight_kg: '',
    trailer_type: 'tautliner', adr:false, city_delivery:false, toll:false, waiting_hours:''
  })
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const onChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  const clearAll = () => {
    setForm({ from:'', to:'', area_m2:'', weight_kg:'', trailer_type:'tautliner', adr:false, city_delivery:false, toll:false, waiting_hours:'' })
    setQuote(null); setError('')
  }

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true); setError(''); setQuote(null)
    try {
      const res = await fetch('/.netlify/functions/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: form.from,
          to: form.to,
          area_m2: Number(form.area_m2 || 0),     // ← m² naar backend
          weight_kg: Number(form.weight_kg || 0),
          trailer_type: form.trailer_type,
          options: {
            adr: form.adr,
            city_delivery: form.city_delivery,
            toll: form.toll,
            waiting_hours: Number(form.waiting_hours || 0)
          }
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Mislukt')
      data.inputs.trailer_type_label = TRAILER_LABELS[data.inputs.trailer_type] || data.inputs.trailer_type
      setQuote(data)
    } catch (err) {
      setError(String(err.message || err))
    } finally {
      setLoading(false)
    }
  }

  const exportPDF = async () => { if (quote) await exportQuoteToPDF(quote) }

  return (
    <div style={{minHeight:'100vh', padding:'24px', maxWidth:'900px', margin:'0 auto', fontFamily:'system-ui, sans-serif'}}>
      <h1 style={{fontSize:'24px', fontWeight:'700', marginBottom:'12px'}}>Coatinc Transport berekening</h1>

      <form onSubmit={submit} style={{display:'grid', gap:'12px'}}>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px'}}>
          <input name="from" placeholder="Van (adres/postcode)" value={form.from} onChange={onChange} required style={{padding:'10px', border:'1px solid #ccc', borderRadius:'8px'}} />
          <input name="to" placeholder="Naar (adres/postcode)" value={form.to} onChange={onChange} required style={{padding:'10px', border:'1px solid #ccc', borderRadius:'8px'}} />
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px'}}>
          <input name="area_m2" type="number" step="0.01" placeholder="Vloeroppervlakte (m²)" value={form.area_m2} onChange={onChange} style={{padding:'10px', border:'1px solid #ccc', borderRadius:'8px'}} />
          <input name="weight_kg" type="number" step="1" placeholder="Gewicht (kg)" value={form.weight_kg} onChange={onChange} style={{padding:'10px', border:'1px solid #ccc', borderRadius:'8px'}} />
          <select name="trailer_type" value={form.trailer_type} onChange={onChange} style={{padding:'10px', border:'1px solid #ccc', borderRadius:'8px'}}>
            <option value="tautliner">Tautliner</option>
            <option value="mega">Open oplegger</option>
            <option value="koel">Dieplader</option>
          </select>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'repeat(4, minmax(0, 1fr))', gap:'8px', alignItems:'center'}}>
          <label style={{display:'flex', gap:'6px', alignItems:'center'}}><input type="checkbox" name="adr" checked={form.adr} onChange={onChange}/> ADR</label>
          <label style={{display:'flex', gap:'6px', alignItems:'center'}}><input type="checkbox" name="city_delivery" checked={form.city_delivery} onChange={onChange}/> Binnenstad</label>
          <label style={{display:'flex', gap:'6px', alignItems:'center'}}><input type="checkbox" name="toll" checked={form.toll} onChange={onChange}/> Tol</label>
          <div style={{display:'flex', gap:'6px', alignItems:'center'}}><span>Wachttijd (u)</span><input name="waiting_hours" type="number" step="0.5" value={form.waiting_hours} onChange={onChange} style={{padding:'6px', border:'1px solid #ccc', borderRadius:'8px', width:'80px'}}/></div>
        </div>

        <div style={{display:'flex', gap:'8px'}}>
          <button type="submit" disabled={loading} style={{background:'#000', color:'#fff', padding:'10px 16px', borderRadius:'8px', border:'none', cursor:'pointer'}}>{loading ? 'Berekenen…' : 'Bereken tarief'}</button>
          <button type="button" onClick={clearAll} style={{background:'#666', color:'#fff', padding:'10px 16px', borderRadius:'8px', border:'none', cursor:'pointer'}}>Leegmaken</button>
          <button type="button" onClick={exportPDF} disabled={!quote} style={{background:'#0b5', color:'#fff', padding:'10px 16px', borderRadius:'8px', border:'none', cursor: !quote? 'not-allowed':'pointer'}}>Exporteer naar PDF</button>
        </div>
      </form>

      {error && <p style={{color:'#b00020', marginTop:'12px'}}>{error}</p>}

      {quote && (
        <div style={{marginTop:'16px', border:'1px solid #e5e5e5', borderRadius:'12px', padding:'16px'}}>
          <h2 style={{fontWeight:600, marginBottom:'8px'}}>Resultaat</h2>
          <p><strong>Afstand:</strong> {quote.derived.distance_km} km</p>
          <p><strong>Chargeable weight:</strong> {quote.derived.chargeable_weight_kg} kg</p>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', columnGap:'24px', rowGap:'4px', marginTop:'8px'}}>
            {Object.entries(quote.breakdown).map(([k,v]) => (
              <div key={k} style={{display:'flex', justifyContent:'space-between'}}><span>{k}</span><span>€ {Number(v).toFixed(2)}</span></div>
            ))}
          </div>
          <hr style={{margin:'12px 0'}}/>
          <p style={{fontSize:'20px'}}><strong>Totaal:</strong> € {Number(quote.total).toFixed(2)}</p>
        </div>
      )}
    </div>
  )
}
