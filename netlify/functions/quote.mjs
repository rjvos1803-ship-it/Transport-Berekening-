// netlify/functions/quote.mjs
// - Aanrijtijd = Google Directions duur (uren) vanaf depot -> VAN (min. ondergrens)
// - Afrijden: extern 0.5u / intern 0.0u
// - Beladingsgraad schaalt linehaul + laad/lostijden
// - 1× pallet vaste prijzen 110/150/225
// - base/linehaul/fuel worden berekend maar UI/PDF verbergen ze

import fs from "fs/promises";
import path from "path";

const DEFAULT_CFG = {
  min_fee: 0.0,
  eur_per_km_base: 0.8,
  fuel_pct: 0.18,
  depot_address: "Coatinc Alblasserdam",
  handling: {
    approach_min_hours: 0.5,          // min. aanrijden
    depart_min_hours: 0.5,            // wordt 0.5u extern / 0.0u intern
    full_trailer_load_unload_hours: 1.5,
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
    include_km_levy: true
  },
  beladingsgraad: {
    one_pallet: 0.05, quarter: 0.25, half: 0.5, three_quarter: 0.75, full: 1.0
  },
  trailers: {
    vlakke:    { label: "Vlakke trailer",    multiplier: 1.0 },
    uitschuif: { label: "Uitschuif trailer", multiplier: 1.1 },
    dieplader: { label: "Dieplader",         multiplier: 1.2 },
    tautliner: { label: "Tautliner",         multiplier: 1.05 }
  },
  zones: { NL: { flat: 0 } }
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
  async _directions(from, to) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error("GOOGLE_MAPS_API_KEY ontbreekt in environment variables");
    const params = new URLSearchParams({
      origin: from, destination: to, units: "metric", language: "nl", key
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`);
    if (!res.ok) throw new Error(`Directions API HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "OK" || !data.routes?.[0]?.legs?.length) {
      throw new Error(`Directions API fout: ${data.status || "geen route"}`);
    }
    return data.routes[0].legs;
  },

  async distanceKm(from, to) {
    const legs = await this._directions(from, to);
    const meters = legs.reduce((s, l) => s + (l.distance?.value || 0), 0);
    return Math.max(1, Math.round(meters / 1000));
  },

  async durationHours(from, to) {
    const legs = await this._directions(from, to);
    const seconds = legs.reduce((s, l) => s + (l.duration?.value || 0), 0);
    return seconds / 3600; // uren
  }
};

// Handling-uren/-kosten met beladingsgraad op laad/lostijd (ook bij interne/externe)
// approach_override_hours: indien meegegeven, gebruik dat i.p.v. min (maar nooit lager dan min)
function calcHandlingSplit(cfg, options, ratio, approach_override_hours = null) {
  const h = cfg.handling || {};
  const approach_min = h.approach_min_hours ?? 0.5;
  const depart_min   = h.depart_min_hours   ?? 0.5;
  const per_op_full  = h.full_trailer_load_unload_hours ?? 1.5;

  const baseRate  = h.rate_per_hour ?? 92.5;
  const craneMult = options.autolaad_kraan ? (cfg.auto_crane?.handling_rate_multiplier ?? 1.28) : 1;
  const rate = baseRate * craneMult;

  // Exclusieve keuze, extern > intern
  const external = !!options.load_unload_external;
  const internal = !external && !!options.load_unload_internal;

  // Aanrijden op basis van depot -> VAN
  const approach_h_raw = approach_override_hours != null ? Number(approach_override_hours) : approach_min;
  const approach_h = Math.max(approach_min, isFinite(approach_h_raw) ? approach_h_raw : approach_min);

  // Afrijden
  const depart_h = external ? depart_min : (internal ? 0 : depart_min);

  // Laden/Lossen max per scenario × beladingsgraad
  let max_load, max_unload;
  if (internal) {
    max_load = 1.0; max_unload = 1.0;
  } else if (external) {
    max_load = 1.5; max_unload = 1.5;
  } else {
    max_load = per_op_full; max_unload = per_op_full;
  }
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  const load_h   = (max_load   * r) || 0;
  const unload_h = (max_unload * r) || 0;

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

  // standaard geen handling/fuel, wel km_levy (indien aangevinkt)
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

  const subtotal = price + handlingSplit.costs.handling_total_internal + km_levy;
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
    const trailer = cfg.trailers[trailer_type] || cfg.trailers.vlakke;

    const distance_km = await GEOCODER.distanceKm(from, to);

    // Exclusiviteit server-side (extern > intern)
    const optionsSafe = {
      ...options,
      load_unload_external: !!options.load_unload_external,
      load_unload_internal: !!options.load_unload_external ? false : !!options.load_unload_internal
    };

    // Aanrijtijd vanaf depot -> VAN-adres
    const depot = cfg.depot_address || "Coatinc Alblasserdam";
    const approach_hours_from_depot = await GEOCODER.durationHours(depot, from);

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

    // beladingsgraad ratio
    let ratio = 0;
    if (typeof optionsSafe.load_fraction === "number") ratio = optionsSafe.load_fraction;
    else if (typeof optionsSafe.load_grade === "string") ratio = cfg.beladingsgraad?.[optionsSafe.load_grade] ?? 0;
    ratio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));

    // Handling met override voor aanrijtijd vanaf depot
    const handlingSplit = calcHandlingSplit(cfg, optionsSafe, ratio, approach_hours_from_depot);

    // Linehaul lineair met beladingsgraad
    const linehaul = distance_km * (cfg.eur_per_km_base || 0) * (trailer.multiplier || 1) * ratio;

    // km-heffing (niet met ratio)
    const km_levy = optionsSafe.km_levy ? (cfg.km_levy?.eur_per_km ?? 0.12) * distance_km : 0;

    // subtotalen
    const base = cfg.min_fee || 0;
    const handlingTotalInternal = handlingSplit.costs.handling_total_internal;
    const subtotal = base + linehaul + handlingTotalInternal + km_levy;
    const fuel = subtotal * (cfg.fuel_pct || 0); // wel rekenen
    const zone_flat = (cfg.zones?.NL?.flat || 0);

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
        base: Number(base.toFixed(2)),              // verborgen in UI/PDF
        linehaul: Number(linehaul.toFixed(2)),      // verborgen in UI/PDF
        handling_approach: handlingSplit.costs.handling_approach,
        handling_depart:   handlingSplit.costs.handling_depart,
        handling_load:     handlingSplit.costs.handling_load,
        handling_unload:   handlingSplit.costs.handling_unload,
        km_levy: Number(km_levy.toFixed(2)),
        fuel: Number(fuel.toFixed(2)),              // verborgen in UI/PDF
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
