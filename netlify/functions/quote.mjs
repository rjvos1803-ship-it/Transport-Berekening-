// netlify/functions/quote.mjs
// Netlify Functions (ESM) - Transport berekening met gesplitste behandelingskosten

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
  auto_crane: { handling_rate_multiplier: 1.28 },
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

// helper: bereken handling (uren + kosten) los per onderdeel
function calcHandlingSplit(cfg, options, ratio, useRateOverride) {
  const h = cfg.handling || {};
  const approach_h = h.approach_min_hours ?? 0.5;
  const depart_h   = h.depart_min_hours   ?? 0.5;
  const per_op_full = h.full_trailer_load_unload_hours ?? 1.5;

  const baseRate  = h.rate_per_hour ?? 92.5;
  const craneMult = options.autolaad_kraan ? (cfg.auto_crane?.handling_rate_multiplier ?? 1.28) : 1;
  const rate = useRateOverride ?? (baseRate * craneMult);

  const load_h   = options.load   ? per_op_full * ratio : 0;
  const unload_h = options.unload ? per_op_full * ratio : 0;

  const approach_cost = approach_h * rate;
  const depart_cost   = depart_h   * rate;
  const load_cost     = load_h     * rate;
  const unload_cost   = unload_h   * rate;

  const total_h = approach_h + depart_h + load_h + unload_h;
  const total_cost = approach_cost + depart_cost + load_cost + unload_cost;

  return {
    hours: {
      approach_hours: Number(approach_h.toFixed(2)),
      depart_hours:   Number(depart_h.toFixed(2)),
      load_hours:     Number(load_h.toFixed(2)),
      unload_hours:   Number(unload_h.toFixed(2)),
      total_hours:    Number(total_h.toFixed(2)),
      rate_used:      Number(rate.toFixed(2))
    },
    costs: {
      handling_approach: Number(approach_cost.toFixed(2)),
      handling_depart:   Number(depart_cost.toFixed(2)),
      handling_load:     Number(load_cost.toFixed(2)),
      handling_unload:   Number(unload_cost.toFixed(2)),
      handling_total:    Number(total_cost.toFixed(2))
    }
  };
}

function calcOnePalletFlat(cfg, distance_km, options) {
  const op = cfg.one_pallet_pricing || {};
  if (op.mode !== "flat_per_distance") return null;

  // 1) staffelprijs
  let price = op.price_above ?? 0;
  for (const t of op.tiers || []) {
    if (distance_km <= t.max_km) { price = t.price; break; }
  }

  // 2) optioneel: handling (met crane multiplier)
  let handlingSplit = {
    hours: { approach_hours:0, depart_hours:0, load_hours:0, unload_hours:0, total_hours:0, rate_used: (cfg.handling?.rate_per_hour ?? 92.5) },
    costs: { handling_approach:0, handling_depart:0, handling_load:0, handling_unload:0, handling_total:0 }
  };
  if (op.include_handling) {
    const ratio = cfg.beladingsgraad?.one_pallet ?? 0.05;
    handlingSplit = calcHandlingSplit(cfg, options, ratio);
  }

  // 3) km-heffing
  let km_levy = 0;
  if (op.include_km_levy && options.km_levy) {
    const kmlevy_rate = (cfg.km_levy?.eur_per_km) ?? 0.12;
    km_levy = kmlevy_rate * distance_km;
  }

  // 4) binnenstad
  let accessorials_fixed = 0;
  if (op.include_city_delivery && options.city_delivery) {
    accessorials_fixed += cfg.accessorials?.city_delivery || 0;
  }

  // 5) subtotalen
  let subtotal = price + handlingSplit.costs.handling_total + km_levy + accessorials_fixed;
  if (op.include_min_fee) subtotal = Math.max(subtotal, cfg.min_fee || 0);
  const fuel = op.include_fuel ? subtotal * (cfg.fuel_pct || 0) : 0;

  return {
    breakdown: {
      base: Number(price.toFixed(2)),
      linehaul: 0,
      ...handlingSplit.costs,
      km_levy: Number(km_levy.toFixed(2)),
      accessorials: Number(accessorials_fixed.toFixed(2)),
      fuel: Number(fuel.toFixed(2)),
      zone_flat: 0
    },
    derived: {
      distance_km,
      ...handlingSplit.hours
    },
    total: Number((subtotal + fuel).toFixed(2))
  };
}

export default async (request) => {
  try {
    const body = request.method === "POST" ? await request.json() : {};
    const { from, to, trailer_type = "vlakke", options = {} } = body || {};

    if (!from || !to) {
      return new Response(JSON.stringify({ error: "from en to zijn verplicht" }), {
        status: 400, headers: { "content-type": "application/json" }
      });
    }

    const cfg = await loadConfig();
    const distance_km = await GEOCODER.distanceKm(from, to);
    const trailer = cfg.trailers[trailer_type] || cfg.trailers.vlakke;

    // 1× pallet speciale staffel
    const isOnePallet =
      options.load_grade === "one_pallet" ||
      (typeof options.load_fraction === "number" && options.load_fraction <= 0.06);

    if (isOnePallet) {
      const flat = calcOnePalletFlat(cfg, distance_km, options);
      if (flat) {
        const payload = {
          inputs: { from, to, trailer_type, trailer_type_label: trailer.label || trailer_type, options },
          derived: flat.derived,
          breakdown: flat.breakdown,
          total: flat.total,
          currency: "EUR"
        };
        return new Response(JSON.stringify(payload), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }
    }

    // Normale flow
    // beladingsgraad
    let ratio = 0;
    if (typeof options.load_fraction === "number") {
      ratio = options.load_fraction;
    } else if (typeof options.load_grade === "string") {
      ratio = cfg.beladingsgraad?.[options.load_grade] ?? 0;
    }
    ratio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));

    // handling split
    const handlingSplit = calcHandlingSplit(cfg, options, ratio);

    // kilometerkosten
    const linehaul = distance_km * (cfg.eur_per_km_base || 0) * (trailer.multiplier || 1);

    // km-heffing
    const kmlevy_rate = (cfg.km_levy?.eur_per_km) ?? 0.12;
    const km_levy = options.km_levy ? kmlevy_rate * distance_km : 0;

    // binnenstad
    let accessorials_fixed = 0;
    if (options.city_delivery) accessorials_fixed += cfg.accessorials?.city_delivery || 0;

    // subtotalen
    const base = cfg.min_fee || 0;
    const subtotal = base + linehaul + handlingSplit.costs.handling_total + km_levy + accessorials_fixed;
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
        ...handlingSplit.hours // approach_hours, depart_hours, load_hours, unload_hours, total_hours, rate_used
      },
      breakdown: {
        base: Number(base.toFixed(2)),
        linehaul: Number(linehaul.toFixed(2)),
        ...handlingSplit.costs, // handling_approach, handling_depart, handling_load, handling_unload, handling_total
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
    return new Response(JSON.stringify({ error: "Internal error", detail: String(e) }), {
      status: 500, headers: { "content-type": "application/json" }
    });
  }
};
