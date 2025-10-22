export async function exportQuoteToPDF(data){
  const w = window.open('', '_blank', 'width=800,height=1000')
  const style = `
    <style>
      body { font-family: system-ui, sans-serif; padding: 24px; }
      h1 { font-size: 20px; margin: 0 0 8px; }
      h2 { font-size: 16px; margin: 16px 0 8px; }
      table { width: 100%; border-collapse: collapse; }
      td, th { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; }
      .total { font-size: 18px; font-weight: 700; }
      .muted { color: #666; font-size: 12px; }
    </style>`
  const rows = Object.entries(data.breakdown || {})
    .map(([k,v]) => `<tr><td>${k}</td><td>€ ${Number(v).toFixed(2)}</td></tr>`).join('')
  const html = `
    <!doctype html><html><head><meta charset="utf-8"><title>Coatinc Transport berekening</title>${style}</head>
    <body>
      <h1>Coatinc Transport berekening</h1>
      <div class="muted">${new Date().toLocaleString()}</div>
      <h2>Invoer</h2>
      <table>
        <tr><td>Van</td><td>${data.inputs.from}</td></tr>
        <tr><td>Naar</td><td>${data.inputs.to}</td></tr>
        <tr><td>Vloeroppervlakte</td><td>${data.inputs.area_m2} m²</td></tr>
        <tr><td>Gewicht</td><td>${data.inputs.weight_kg} kg</td></tr>
        <tr><td>Trailer</td><td>${data.inputs.trailer_type_label}</td></tr>
        <tr><td>Afstand</td><td>${data.derived.distance_km} km</td></tr>
      </table>
      <h2>Berekening</h2>
      <table>${rows}</table>
      <p class="total">Totaal: € ${Number(data.total).toFixed(2)} ${data.currency||'EUR'}</p>
      <p class="muted">Formule: max(min_fee, som + brandstoftoeslag). Chargeable: max(kg, m² × kg_per_m2).</p>
      <script>window.onload = () => setTimeout(()=>window.print(), 300);</script>
    </body></html>`
  w.document.open(); w.document.write(html); w.document.close();
}
