// netlify/functions/quote.mjs
// Netlify Functions (ESM) - Transport berekening met trailer multipliers en 1× pallet staffel

import fs from "fs/promises";
import path from "path";

// --- Default config fallback (wanneer config/pricing.json ontbreekt) --------------------------
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
  one_pallet_pricing: {
    mode: "flat_per_distance",
    tiers: [
      { max_km: 50,  price: 110 },
      { max_km: 100, price: 150 }
    ],
    price_above: 225,
    include_min_fee: false,
    include_handling: false,
    include_fuel: false,
    include_km_levy: true,
    include_city_delivery: true
  },
  beladingsgraad: {
    one_pallet: 0.05, quarter: 0.25, half: 0.5, three_quarter: 0.75, full: 1.0
  },
  trailers: {
    vlakke:    { label: "Vlakke trailer",    volume_m2: 33.0, payload_kg: 24000, multiplier: 1.00 },
    uitschuif: { label: "Uitschuif trailer", volume_m2: 33.0, payload_kg: 23000, multiplier: 1.10 },
    dieplader: { label: "Dieplader",         volume_m2: 30.0, payload_kg: 22000, multiplier: 1.20 },
    tautliner: { label: "Tautliner",         volume_m2: 33.0, payload_kg: 24000, multiplier: 1.05 }
  },
  zones: { NL: { flat: 0 }, BE: { flat: 0 }, DE: { flat: 0 } },
  accessorials: { city_delivery: 0 }
};

// --- Config laden -----------------------------------------------------------------------------
async function loadConfig() {
  try {
    const p = path.resolve("config/pricing.json");
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return DEFAULT_CFG;
  }
}

// --- Google Directions afstand (km) -----------------------------------------------------------
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
    // Altijd minstens 1 km om deling door 0 te voorkomen
    return Math.max(1, Math.round(meters / 1000));
  }
};

// --- 1× pallet staffel ------------------------------------------------------------------------
function calcOnePalletFlat(cfg, distance_km, options) {
  const op = cfg.one_pallet_pricing || {};
  if (op.mode !== "flat_per_distance") return null;

  // 1) Staffelkosten
  let price = op.price_above ?? 0;
  for (const t of op.tiers || []) {
    if (distance_km <= t.max_km) { price = t.price; break; }
  }

  // 2) Optionele aanvullers
  // Handling
  let handling_cost = 0;
  if (op.include_handling) {
    const h = cfg.handling || {};
    const approach = h.approach_min_hours ?? 0.5;
    const depart   = h.depart_min_hours   ?? 0.5;
    const per_op_full = h.full_trailer_load_unload_hours ?? 1.5;
    const rate = h.rate_per_hour ?? 92.5;
    const ratio = cfg.beladingsgraad?.one_pallet ?? 0.05;
    const load_hours   = options.load   ? per_op_full * ratio : 0;
    const unload_hours = options.unload ? per_op_full * ratio : 0;
    const handling_total_hours = approach + depart + load_hours + unload_hours;
    handling_cost = handling_total_hours * rate;
  }

  // Km-heffing
  let km_levy = 0;
  if (op.include_km_levy && options.km_levy) {
    const kmlevy_rate = (cfg.km_levy?.eur_per_km) ?? 0.12;
    km_levy = kmlevy_rate * distance_km;
  }

  // Binnenstad
  let accessorials_fixed = 0;
  if (op.include_city_delivery && options.city_delivery) {
    accessorials_fixed += cfg.accessorials?.city_delivery || 0;
  }

  // Subtotaal + min fee
  let subtotal = price + handling_cost + km_levy + accessorials_fixed;
  if (op.include_min_fee) {
    subtotal = Math.max(subtotal, cfg.min_fee || 0);
  }

  // Brandstof
  const fuel = op.include_fuel ? subtotal * (cfg.fuel_pct || 0) : 0;

  return {
    breakdown: {
      base: Number(price.toFixed(2)),
      handling: Number(handling_cost.toFixed(2)),
      km_levy: Number(km_levy.toFixed(2)),
      accessorials: Number(accessorials_fixed.toFixed(2)),
      fuel: Number(fuel.toFixed(2)),
      linehaul: 0,
      zone_flat: 0
    },
    total: Number((subtotal + fuel).toFixed(2))
  };
}

// --- Handler ----------------------------------------------------------------------------------
export default async (request) => {
  try {
    const body = request.method === "POST" ? await request.json() : {};
    const { from, to, trailer_type = "vlakke", options = {} } = body || {};

    if (!from || !to) {
      return new Response(JSON.stringify({ error: "from en to zijn verplicht" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }

    // Config + afstand
    const cfg = await loadConfig();
    const distance_km = await GEOCODER.distanceKm(from, to);
    const trailer = cfg.trailers[trailer_type] || cfg.trailers.vlakke;

    // --- Speciale logica: 1× pallet (staffel) ---
    const isOnePallet =
      options.load_grade === "one_pallet" ||
      (typeof options.load_fraction === "number" && options.load_fraction <= 0.06);

    if (isOnePallet) {
      const flat = calcOnePalletFlat(cfg, distance_km, options);
      if (flat) {
        const payload = {
          inputs: {
            from, to, trailer_type,
            trailer_type_label: trailer.label || trailer_type,
            options
          },
          derived: {
            distance_km,
            handling_total_hours: 0 // (of bereken indien include_handling=true)
          },
          breakdown: {
            base: flat.breakdown.base,
            linehaul: flat.breakdown.linehaul,
            handling: flat.breakdown.handling,
            km_levy: flat.breakdown.km_levy,
            accessorials: flat.breakdown.accessorials,
            fuel: flat.breakdown.fuel,
            zone_flat: flat.breakdown.zone_flat
          },
          total: flat.total,
          currency: "EUR"
        };

        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }
    // --- Einde 1× pallet ---

    // --- Normale berekening voor overige beladingsgraden ---
    // Beladingsgraad 0..1
    let ratio = 0;
    if (typeof options.load_fraction === "number") {
      ratio = options.load_fraction;
    } else if (typeof options.load_grade === "string") {
      ratio = cfg.beladingsgraad?.[options.load_grade] ?? 0;
    }
    ratio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));

    // Handling (aan-/afrijden + laden/lossen naar rato)
    const h = cfg.handling || {};
    const approach = h.approach_min_hours ?? 0.5;
    const depart   = h.depart_min_hours   ?? 0.5;
    const per_op_full = h.full_trailer_load_unload_hours ?? 1.5;
    const rate = h.rate_per_hour ?? 92.5;

    const load_hours   = options.load   ? per_op_full * ratio : 0;
    const unload_hours = options.unload ? per_op_full * ratio : 0;
    const handling_total_hours = approach + depart + load_hours + unload_hours;
    const handling_cost = handling_total_hours * rate;

    // Kilometerkosten (€/km * trailer multiplier)
    const linehaul = distance_km * (cfg.eur_per_km_base || 0) * (trailer.multiplier || 1);

    // Km-heffing (checkbox)
    const kmlevy_rate = (cfg.km_levy?.eur_per_km) ?? 0.12;
    const km_levy = options.km_levy ? kmlevy_rate * distance_km : 0;

    // Bijkosten (binnenstad)
    let accessorials_fixed = 0;
    if (options.city_delivery) accessorials_fixed += cfg.accessorials?.city_delivery || 0;

    // Subtotaal + brandstof + zone
    const base = cfg.min_fee || 0;
    const subtotal = base + linehaul + handling_cost + km_levy + accessorials_fixed;
    const fuel = subtotal * (cfg.fuel_pct || 0);

    const zone_flat = (() => {
      const z = options.zone || "NL";
      return (cfg.zones?.[z]?.flat) || 0;
    })();

    const total = Math.max(cfg.min_fee || 0, subtotal + fuel + zone_flat);

    const payload = {
      inputs: {
        from, to, trailer_type,
        trailer_type_label: trailer.label || trailer_type,
        options
      },
      derived: {
        distance_km,
        handling_total_hours: Number(handling_total_hours.toFixed(2))
      },
      breakdown: {
        base: Number(base.toFixed(2)),
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
      status: 200,
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    // Fallback error-response
    return new Response(JSON.stringify({ error: "Internal error", detail: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
};
