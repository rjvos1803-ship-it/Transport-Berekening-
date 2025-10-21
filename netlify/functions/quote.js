// netlify/functions/quote.js (ESM, Runtime v2 - Web API)
import fs from "fs/promises";
import path from "path";

const DEFAULT_CFG = {
  min_fee: 75,
  eur_per_km_base: 0.75,
  per_kg_km: 0.02,
  per_m2_km: 0.40,
  fuel_pct: 0.18,
  kg_per_m2: 150,
  trailers: {
    tautliner: { volume_m2: 33.32, payload_kg: 24000, multiplier: 1.0 },
    mega:      { volume_m2: 33.73, payload_kg: 24000, multiplier: 1.05 },
    koel:      { volume_m2: 33.32, payload_kg: 22000, multiplier: 1.15 },
  },
  zones: { NL: { flat: 0 }, BE: { flat: 20 }, DE: { flat: 35 } },
  accessorials: { adr: 45, city_delivery: 25, waiting_per_hour: 40, toll_per_km: 0.08 },
};

async function loadConfig() {
  try {
    const p = path.resolve("config/pricing.json");
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return DEFAULT_CFG;
  }
}

const GEOCODER = {
  async distanceKm(from, to) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error("GOOGLE_MAPS_API_KEY ontbreekt in environment variables");
    const params = new URLSearchParams({
      origin: from,
      destination: to,
      units: "metric",
      language: "nl",
      key,
    });
    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Directions API HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "OK" || !data.routes?.[0]?.legs?.length) {
      throw new Error(`Directions API fout: ${data.status || "geen route"}`);
    }
    const meters = data.routes[0].legs.reduce((sum, l) => sum + (l.distance?.value || 0), 0);
    return Math.max(1, Math.round(meters / 1000));
  },
};

// ✅ Netlify Functions v2: default export krijgt een Request en moet een Response retourneren
export default async (request) => {
  try {
    const body = request.method === "POST"
      ? await request.json()
      : {};

    const {
      from,
      to,
      area_m2 = 0,
      weight_kg = 0,
      trailer_type = "tautliner",
      options = {},
    } = body || {};

    if (!from || !to) {
      return new Response(JSON.stringify({ error: "from en to zijn verplicht" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const cfg = await loadConfig();
    const distance_km = await GEOCODER.distanceKm(from, to);

    const trailer = cfg.trailers[trailer_type] || cfg.trailers.tautliner;
    const kg_per_m2 = cfg.kg_per_m2 || 150;
    const chargeable_weight_kg = Math.max(weight_kg, area_m2 * kg_per_m2);

    const base = cfg.min_fee || 0;
    const linehaul = distance_km * (cfg.eur_per_km_base || 0) * (trailer.multiplier || 1);
    const weight_comp = distance_km * (cfg.per_kg_km || 0) * (chargeable_weight_kg / 1000);
    const area_comp = distance_km * (cfg.per_m2_km || 0) * area_m2;

    let accessorials = 0;
    if (options.adr) accessorials += cfg.accessorials?.adr || 0;
    if (options.city_delivery) accessorials += cfg.accessorials?.city_delivery || 0;
    if (options.toll) accessorials += (cfg.accessorials?.toll_per_km || 0) * distance_km;
    if (options.waiting_hours) accessorials += (cfg.accessorials?.waiting_per_hour || 0) * options.waiting_hours;

    const subtotal = base + linehaul + weight_comp + area_comp + accessorials;
    const fuel = subtotal * (cfg.fuel_pct || 0);
    const zone_flat = (() => {
      const z = options.zone || "NL";
      return (cfg.zones?.[z]?.flat) || 0;
    })();
    const total = Math.max(cfg.min_fee || 0, subtotal + fuel + zone_flat);

    const payload = {
      inputs: { from, to, area_m2, weight_kg, trailer_type, options },
      derived: { distance_km, chargeable_weight_kg },
      breakdown: {
        base,
        linehaul: Number(linehaul.toFixed(2)),
        weight_comp: Number(weight_comp.toFixed(2)),
        area_comp: Number(area_comp.toFixed(2)),
        accessorials: Number(accessorials.toFixed(2)),
        fuel: Number(fuel.toFixed(2)),
        zone_flat: Number(zone_flat.toFixed(2)),
      },
      total: Number(total.toFixed(2)),
      currency: "EUR",
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Internal error", detail: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

