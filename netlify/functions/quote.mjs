// netlify/functions/quote.js (ESM, Runtime v2)
import fs from "fs/promises";
import path from "path";

const DEFAULT_CFG = {
  min_fee: 110.0,
  eur_per_km_base: 0.8,
  fuel_pct: 0.18,
  handling: {
    approach_min_hours: 0.5,
    depart_min_hours: 0.5,
    full_trailer_load_unload_hours: 1.5,
    rate_per_hour: 92.5
  },
  km_levy: { eur_per_km: 0.12 },
  beladingsgraad: {
    one_pallet: 0.05, quarter: 0.25, half: 0.5, three_quarter: 0.75, full: 1.0
  },
  trailers: {
    tautliner: { volume_m2: 33.32, payload_kg: 24000, multiplier: 1.0 },
    mega:      { volume_m2: 33.73, payload_kg: 24000, multiplier: 1.05 },
    koel:      { volume_m2: 33.32, payload_kg: 22000, multiplier: 1.15 }
  },
  zones: { NL: { flat: 0 }, BE: { flat: 0 }, DE: { flat: 0 } },
  accessorials: { city_delivery: 0 }
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
      origin: from, destination: to, units: "metric", language: "nl", key
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
    const { from, to, trailer_type = "tautliner", options = {} } = body || {};

    if (!from || !to) {
      return new Response(JSON.stringify({ error: "from en to zijn verplicht" }), {
        status: 400, headers: { "content-type": "application/json" }
      });
    }

    const cfg = await loadConfig();
    const distance_km = await GEOCODER.distanceKm(from, to);
    const trailer = cfg.trailers[trailer_type] || cfg.trailers.tautliner;

    // Beladingsgraad (0..1) via UI: key of directe fraction
    let ratio = 0;
    if (typeof options.load_fraction === "number") {
      ratio = options.load_fraction;
    } else if (typeof options.load_grade === "string") {
      ratio = cfg.beladingsgraad?.[options.load_grade] ?? 0;
    }
    ratio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));

    // Handling
    const h = cfg.handling || {};
    const approach = h.approach_min_hours ?? 0.5;
    const depart   = h.depart_min_hours   ?? 0.5;
    const per_op_full = h.full_trailer_load_unload_hours ?? 1.5;
    const rate = h.rate_per_hour ?? 92.5;

    const load_hours   = options.load   ? per_op_full * ratio : 0;
    const unload_hours = options.unload ? per_op_full * ratio : 0;
    const handling_total_hours = approach + depart + load_hours + unload_hours;
    const handling_cost = handling_total_hours * rate;

    // Afstandskosten
    const linehaul = distance_km * (cfg.eur_per_km_base || 0) * (trailer.multiplier || 1);

    // Kilometerheffing
    const kmlevy_rate = (cfg.km_levy?.eur_per_km) ?? 0.12;
    const km_levy = options.km_levy ? kmlevy_rate * distance_km : 0;

    // Vaste bijkosten
    let accessorials_fixed = 0;
    if (options.city_delivery) accessorials_fixed += cfg.accessorials?.city_delivery || 0;

    const base = cfg.min_fee || 0;

    const subtotal = base + linehaul + handling_cost + km_levy + accessorials_fixed;
    const fuel = subtotal * (cfg.fuel_pct || 0);

    const zone_flat = (() => {
      const z = options.zone || "NL";
      return (cfg.zones?.[z]?.flat) || 0;
    })();

    const total = Math.max(cfg.min_fee || 0, subtotal + fuel + zone_flat);

    const payload = {
      inputs: { from, to, trailer_type, options, load_ratio: ratio },
      derived: {
        distance_km,
        handling_total_hours: Number(handling_total_hours.toFixed(2))
      },
      breakdown: {
        base,
        linehaul: Number(linehaul.toFixed(2)),
        handling: Number(handling_cost.toFixed(2)),
        km_levy: Number(km_levy.toFixed(2)),
        accessorials: Number(accessorials_fixed.toFixed(2)),
        fuel: Number(fuel.toFixed(2)),
        zone_flat: Number(zone_flat.toFixed(2))
      },
      total: Number(total.toFixed(2)),
      currency: "EUR"
    };

    return new Response(JSON.stringify(payload), {
      status: 200, headers: { "content-type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Internal error", detail: String(e) }), {
      status: 500, headers: { "content-type": "application/json" }
    });
  }
