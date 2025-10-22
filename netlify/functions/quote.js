// netlify/functions/quote.js (ESM, Runtime v2 - Web API)
import fs from "fs/promises";
import path from "path";

const DEFAULT_CFG = {
  min_fee: 75,
  eur_per_km_base: 0.75,
  per_kg_km: 0,
  per_m2_km: 0,
  fuel_pct: 0.18,
  kg_per_m2: 150,
  handling: {
    approach_min_hours: 0.5,
    depart_min_hours: 0.5,
    full_trailer_load_unload_hours: 1.5,
    rate_per_hour: 40
  },
  discounts: { combi_pct: 0.10 },
  km_levy: { enabled_default: false, eur_per_km: 0.12 },
  trailers: {
    tautliner: { volume_m2: 33.32, payload_kg: 24000, multiplier: 1.0 },
    mega:      { volume_m2: 33.73, payload_kg: 24000, multiplier: 1.05 },
    koel:      { volume_m2: 33.32, payload_kg: 22000, multiplier: 1.15 }
  },
  zones: { NL: { flat: 0 }, BE: { flat: 20 }, DE: { flat: 35 } },
  accessorials: { adr: 45, city_delivery: 25 }
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
      key
    });
    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Directions API HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "OK" || !data.routes?.[0]?.legs?.length) {
      throw new Error(`Directions API fout: ${data.status || "geen route"}`);
    }
    const meters = data.routes[0].legs.reduce((s, l) => s + (l.distance?.value || 0), 0);
    return Math.max(1, Math.round(meters / 1000));
  }
};

export default async (request) => {
  try {
    const body = request.method === "POST" ? await request.json() : {};
    const {
      from, to,
      area_m2 = 0,
      weight_kg = 0,
      trailer_type = "tautliner",
      options = {}
    } = body || {};

    if (!from || !to) {
      return new Response(JSON.stringify({ error: "from en to zijn verplicht" }), {
        status: 400, headers: { "content-type": "application/json" }
      });
    }

    const cfg = await loadConfig();
    const distance_km = await GEOCODER.distanceKm(from, to);
    const trailer = cfg.trailers[trailer_type] || cfg.trailers.tautliner;

    // Gebruiksgraad (0..1) op basis van m²/gewicht
    const usage_ratio = Math.max(
      (area_m2 || 0) / (trailer.volume_m2 || 1),
      (weight_kg || 0) / (trailer.payload_kg || 1)
    );
    const ratio = Math.max(0, Math.min(1, usage_ratio));

    // Handling-tijden en kosten
    const h = cfg.handling || {};
    const approach = h.approach_min_hours ?? 0.5;
    const depart   = h.depart_min_hours   ?? 0.5;
    const per_op_full = h.full_trailer_load_unload_hours ?? 1.5;
    const handling_rate = h.rate_per_hour ?? 40;

    const load_hours   = options.load   ? per_op_full * ratio : 0;
    const unload_hours = options.unload ? per_op_full * ratio : 0;
    const handling_total_hours = approach + depart + load_hours + unload_hours;
    const handling_cost = handling_total_hours * handling_rate;

    // Afstandskosten
    const linehaul = distance_km * (cfg.eur_per_km_base || 0) * (trailer.multiplier || 1);

    // Kilometerheffing (vinkje)
    const kmlevy_rate = (cfg.km_levy?.eur_per_km) ?? 0.12;
    const km_levy = options.km_levy ? kmlevy_rate * distance_km : 0;

    // Vaste bijkosten
    let accessorials_fixed = 0;
    if (options.adr) accessorials_fixed += cfg.accessorials?.adr || 0;
    if (options.city_delivery) accessorials_fixed += cfg.accessorials?.city_delivery || 0;

    // Oud gewicht-/oppervlaktecomponent uit
    const weight_comp = 0;
    const area_comp = 0;

    const base = cfg.min_fee || 0;

    const subtotal_pre_discount =
      base + linehaul + handling_cost + km_levy + accessorials_fixed;

    // Combi-korting
    const combi_pct = cfg.discounts?.combi_pct || 0;
    const combi_discount = options.combi ? subtotal_pre_discount * combi_pct : 0;

    const subtotal = subtotal_pre_discount - combi_discount;
    const fuel = subtotal * (cfg.fuel_pct || 0);

    const zone_flat = (() => {
      const z = options.zone || "NL";
      return (cfg.zones?.[z]?.flat) || 0;
    })();

    const total = Math.max(cfg.min_fee || 0, subtotal + fuel + zone_flat);

    const payload = {
      inputs: { from, to, area_m2, weight_kg, trailer_type, options },
      derived: {
        distance_km,
        usage_ratio: Number(ratio.toFixed(3)),
        handling_total_hours: Number(handling_total_hours.toFixed(2))
      },
      breakdown: {
        base,
        linehaul: Number(linehaul.toFixed(2)),
        handling: Number(handling_cost.toFixed(2)),
        km_levy: Number(km_levy.toFixed(2)),
        accessorials: Number(accessorials_fixed.toFixed(2)),
        weight_comp,
        area_comp,
        combi_discount: -Number(combi_discount.toFixed(2)),
        fuel: Number(fuel.toFixed(2)),
        zone_flat: Number(zone_flat.toFixed(2))
      },
      total: Number(total.toFixed(2)),
      currency: "EUR"
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Internal error", detail: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
};
