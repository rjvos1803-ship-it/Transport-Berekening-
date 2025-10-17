// netlify/functions/quote.js
import fs from "fs/promises";

const GEOCODER = {
  async distanceKm(from, to) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error("GOOGLE_MAPS_API_KEY ontbreekt in environment variables");
    const params = new URLSearchParams({ origin: from, destination: to, units: "metric", language: "nl", key });
    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Directions API HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "OK" || !data.routes?.[0]?.legs?.length) throw new Error(`Directions API fout: ${data.status || "geen route"}`);
    const meters = data.routes[0].legs.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0);
    return Math.max(1, Math.round(meters / 1000));
  },
};

export default async (req, res) => {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { from, to, volume_m3 = 0, weight_kg = 0, trailer_type = "tautliner", options = {} } = body || {};
    if (!from || !to) return res.status(400).json({ error: "from en to zijn verplicht" });

    const raw = await fs.readFile("config/pricing.json", "utf8");
    const cfg = JSON.parse(raw);

    const distance_km = await GEOCODER.distanceKm(from, to);

    const trailer = cfg.trailers[trailer_type] || cfg.trailers.tautliner;
    const density = cfg.density_kg_per_m3 || 250;
    const chargeable_weight_kg = Math.max(weight_kg, volume_m3 * density);

    const base = cfg.min_fee || 0;
    const linehaul = distance_km * (cfg.eur_per_km_base || 0) * (trailer.multiplier || 1);
    const weight_comp = distance_km * (cfg.per_kg_km || 0) * (chargeable_weight_kg / 1000);
    const volume_comp = distance_km * (cfg.per_m3_km || 0) * volume_m3;

    let accessorials = 0;
    if (options.adr) accessorials += cfg.accessorials?.adr || 0;
    if (options.city_delivery) accessorials += cfg.accessorials?.city_delivery || 0;
    if (options.toll) accessorials += (cfg.accessorials?.toll_per_km || 0) * distance_km;
    if (options.waiting_hours) accessorials += (cfg.accessorials?.waiting_per_hour || 0) * options.waiting_hours;

    const subtotal = base + linehaul + weight_comp + volume_comp + accessorials;
    const fuel = subtotal * (cfg.fuel_pct || 0);
    const zone_flat = (() => { const z = options.zone || "NL"; return (cfg.zones?.[z]?.flat) || 0; })();
    const total = Math.max(cfg.min_fee || 0, subtotal + fuel + zone_flat);

    return res.status(200).json({
      inputs: { from, to, volume_m3, weight_kg, trailer_type, options },
      derived: { distance_km, chargeable_weight_kg },
      breakdown: {
        base,
        linehaul: Number(linehaul.toFixed(2)),
        weight_comp: Number(weight_comp.toFixed(2)),
        volume_comp: Number(volume_comp.toFixed(2)),
        accessorials: Number(accessorials.toFixed(2)),
        fuel: Number(fuel.toFixed(2)),
        zone_flat: Number(zone_flat.toFixed(2))
      },
      total: Number(total.toFixed(2)),
      currency: "EUR"
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal error", detail: String(e) });
  }
}
