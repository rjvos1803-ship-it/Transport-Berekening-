# Transporttarief calculator (Netlify + Google Directions)
- Frontend: Vite + React
- Backend: Netlify Function (`/.netlify/functions/quote`)
- Afstand: Google Maps Directions API (server-side)

## Deploy opties
### A) Volwaardig project (aanbevolen)
1. Repo in Git zetten en **Netlify → Import from Git**.
2. Environment var: `GOOGLE_MAPS_API_KEY=...`.
3. Build command: `npm run build` ; Publish directory: `dist`.

### B) Netlify Drop (drag & drop)
- Run lokaal: `npm install && npm run build` en sleep **de inhoud van `dist/`** naar app.netlify.com/drop.
- Of sleep de map **`static-simple/`** (bevat `index.html`) voor een snelle demo. *Let op:* Functions werken dan niet; voor `/quote` is een project-deploy nodig.

## Lokale dev
```bash
npm install
npm run dev
```

## Config
Pas tarieven in `config/pricing.json` aan.
