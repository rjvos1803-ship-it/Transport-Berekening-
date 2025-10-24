// netlify/functions/quote.mjs
// Berekening met: linehaul verbergen (wel rekenen), brandstof verbergen (wel rekenen),
// laden/lossen als één regel in UI/PDF, en interne locatie -> géén afrijtijd.

import fs from "fs/promises";
import path from "path";

const DEFAULT_CFG = {
  min_fee: 110.0,
  eur_per_km_base: 0.8,
  fuel_pct: 0.18,
  handling: {
    approach_min_hours: 0.5,
    depart_min_hours: 0.5,
    full_trailer_load_unload_hours: 1.5, // per bewerking (laden OF lossen) bij volle trailer
    rate_per_hour: 92.5
  },
  km_levy: { eur_per_km: 0.12 },
  auto_crane: { handling_rate_multiplier: 1.28 },
  combined_discount_pct: 0.20,
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

/**
 * Handling-uren/-kosten:
 * - Altijd aanrijden (min 0,5 u)
 * - Interne locatie: géén afrijden (0 u), laden+lossen totaal 2,0 u (1,0 + 1,0)
 * - Externe locatie: afrijden 0,5 u, laden+lossen totaal 3,0 u (1,5 + 1,5)
 * - Anders: schaal per beladingsgraad (1,5 u per handeling * ratio)
 * - Autolaadkraan: +28% op uurtarief
 * - Extern > Intern als beide tegelijk binnenkomen
 */
function calcHandlingSplit(cfg, options, ratio) {
  const h = cfg.handling || {};
  const approach_min = h.approach_min_hours ?? 0.5;
  const depart_min   = h.depart_min_hours   ?? 0.5;
  const per_op_full  = h.full_trailer_load_unload_hours ?? 1.5;

  const baseRate  = h.rate_per_hour ?? 92.5;
  const craneMult = options.autolaad_kraan ? (cfg.auto_crane?.handling_rate_multiplier ?? 1.28) : 1;
  const rate = baseRate * craneMult;

  const external = !!options.load_unload_external;
  const internal = !external && !!options.load_unload_internal;

  let approach_h = approach_min;
  let depart_h   = external ? depart_min : (internal ? 0 : depart_min); // intern: géén afrijden

  let load_h, unload_h;
  if (internal) {
    load_h = 1.0; unload_h = 1.0;            // totaal 2,0 u
  } else if (external) {
    load_h = 1.5; unload_h = 1.5;            // totaal 3,0 u
  } else {
    load_h = per_op_full * ratio;
    unload_h = per_op_full * ratio;
  }

  const handling_approach = approach_h * rate;
  const handling_depart   = depart_h   * rate;
  const handling_load     = load_h     * rate;
  const handling_unload   = unload_h   * rate;

  return {
    hours: {
      approach_hours: Number(approach_h.toFixed(2)),
      depart_hours:   Number(depart_h.toFixed(2)),
      load_hours:     Number(load_h.toFixed(2)),
      unload_hours:   Number(unload_h.toFixed(2)),
      total_hours:    Number((approach_h + depart_h + load_h + unload_h).toFixed(2)),
      rate_used:      Number(rate.toFixed(2))
    },
    costs: {
      handling_approach: Number(handling_approach.toFixed(2)),
      handling_depart:   Number(handling_depart.toFixed(2)),
      handling_load:     Number(handling_load.toFixed(2)),
      handling_unload:   Number(handling_unload.toFixed(2)),
      handling_total_internal: Number((handling_approach + handling_depart + handling_load + handling_unload).toFixed(2))
    }
  };
}

function calcOnePalletFlat(cfg, distance_km, options) {
  const op = cfg.one_pallet_pricing || {};
  if (op.mode !== "flat_per_distance") return null;

  let price = op.price_above ?? 0;
  for (const t of op.tiers || []) {
    if (distance_km <= t.max_km) { price = t.price; break; }
  }

  // 1× pallet: standaard géén handling/fuel, wel km_levy en binnenstad (volgens config)
  let handlingSplit = {
    hours: { approach_hours:0, depart_hours:0, load_hours:0, unload_hours:0, total_hours:0, rate_used: (cfg.handling?.rate_per_hour ?? 92.5) },
    costs: { handling_approach:0, handling_depart:0, handling_load:0, handling_unload:0, handling_total_internal:0 }
  };
  if (op.include_handling) {
    const ratio = cfg.beladingsgraad?.one_pallet ?? 0.05;
    handlingSplit = calcHandlingSplit(cfg, options, ratio);
  }

  let km_levy = 0;
  if (op.include_km_levy && options.km_levy) {
    km_levy = (cfg.km_levy?.eur_per_km ?? 0.12) * distance_km;
  }

  let accessorials_fixed = 0;
  if (op.include_city_delivery && options.city_delivery) {
    accessorials_fixed += cfg.accessorials?.city_delivery || 0;
  }

  let subtotal = price + handlingSplit.costs.handling_total_internal + km_levy + accessorials_fixed;
  if (op.include_min_fee) subtotal = Math.max(subtotal, cfg.min_fee || 0);
  const fuel = op.include_fuel ? subtotal * (cfg.fuel_pct || 0) : 0;

  const preTotal = subtotal + fuel;
  const discount = options.combined ? -(preTotal * (cfg.combined_discount_pct ?? 0.2)) : 0;
  const total = preTotal + discount;

  return {
    breakdown: {
      base: Number(price.toFixed(2)),
      linehaul: 0,
      handling_approach: handlingSplit.costs.handling_approach,
      handling_depart:   handlingSplit.costs.handling_depart,
      handling_load:     handlingSplit.costs.handling_load,
      handling_unload:   handlingSplit.costs.handling_unload,
      km_levy: Number(km_levy.toFixed(2)),
      accessorials: Number(accessorials_fixed.toFixed(2)),
      fuel: Number(fuel.toFixed(2)),
      discount: Number(discount.toFixed(2)),
      zone_flat: 0
    },
    derived: { distance_km, ...handlingSplit.hours },
    total: Number(total.toFixed(2))
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

    // exclusiviteit (server): extern > intern
    const optionsSafe = {
      ...options,
      load_unload_external: !!options.load_unload_external,
      load_unload_internal: !!options.load_unload_external ? false : !!options.load_unload_internal
    };

    // 1× pallet?
    const isOnePallet =
      optionsSafe.load_grade === "one_pallet" ||
      (typeof optionsSafe.load_fraction === "number" && optionsSafe.load_fraction <= 0.06);

    if (isOnePallet) {
      const flat = calcOnePalletFlat(cfg, distance_km, optionsSafe);
      if (flat) {
        const payload = {
          inputs: { from, to, trailer_type, trailer_type_label: trailer.label || trailer_type, options: optionsSafe },
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

    // beladingsgraad
    let ratio = 0;
    if (typeof optionsSafe.load_fraction === "number") ratio = optionsSafe.load_fraction;
    else if (typeof optionsSafe.load_grade === "string") ratio = cfg.beladingsgraad?.[optionsSafe.load_grade] ?? 0;
    ratio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));

    const handlingSplit = calcHandlingSplit(cfg, optionsSafe, ratio);

    // kilometers (rekenen, niet tonen)
    const linehaul = distance_km * (cfg.eur_per_km_base || 0) * (trailer.multiplier || 1);

    // km-heffing
    const km_levy = optionsSafe.km_levy ? (cfg.km_levy?.eur_per_km ?? 0.12) * distance_km : 0;

    // binnenstad
    let accessorials_fixed = 0;
    if (optionsSafe.city_delivery) accessorials_fixed += cfg.accessorials?.city_delivery || 0;

    // subtotalen
    const base = cfg.min_fee || 0;
    const handlingTotalInternal = handlingSplit.costs.handling_total_internal;
    const subtotal = base + linehaul + handlingTotalInternal + km_levy + accessorials_fixed;
    const fuel = subtotal * (cfg.fuel_pct || 0); // WEL rekenen
    const zone_flat = (() => {
      const z = optionsSafe.zone || "NL";
      return (cfg.zones?.[z]?.flat) || 0;
    })();

    const preTotal = subtotal + fuel + zone_flat;
    const discount = optionsSafe.combined ? -(preTotal * (cfg.combined_discount_pct ?? 0.2)) : 0;
    const total = Math.max(cfg.min_fee || 0, preTotal + discount);

    const payload = {
      inputs: {
        from, to, trailer_type,
        trailer_type_label: trailer.label || trailer_type,
        options: optionsSafe
      },
      derived: {
        distance_km,
        ...handlingSplit.hours
      },
      breakdown: {
        base: Number(base.toFixed(2)),
        linehaul: Number(linehaul.toFixed(2)), // blijft verborgen in UI/PDF
        handling_approach: handlingSplit.costs.handling_approach,
        handling_depart:   handlingSplit.costs.handling_depart,
        handling_load:     handlingSplit.costs.handling_load,
        handling_unload:   handlingSplit.costs.handling_unload,
        km_levy: Number(km_levy.toFixed(2)),
        accessorials: Number(accessorials_fixed.toFixed(2)),
        fuel: Number(fuel.toFixed(2)), // WEL rekenen, straks niet tonen
        zone_flat: Number(zone_flat.toFixed(2)),
        discount: Number(discount.toFixed(2))
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
};
