// netlify/functions/quote.mjs
// Beladingsgraad-tuning via config: load_factor (per beladingsgraad) en load_shares (welke posten meeschalen).
// Behoudt eerdere wensen: autolaadkraan, gecombineerd, interne/externe vaste handling, linehaul & fuel verbergen (maar wel rekenen).

import fs from "fs/promises";
import path from "path";

const DEFAULT_CFG = {
  min_fee: 110.0,
  eur_per_km_base: 0.8,
  fuel_pct: 0.18,
  load_factor: {
    one_pallet: 0.60, quarter: 0.50, half: 0.75, three_quarter: 0.90, full: 1.00,
    fallback_0_25: 0.50, fallback_0_50: 0.75, fallback_0_75: 0.90, fallback_1_00: 1.00
  },
  load_shares: { linehaul: 1.0, km_levy: 1.0, zone_flat: 0.5, base_fee_share: 0.0 },
  handling: {
    approach_min_hours: 0.5, depart_min_hours: 0.5,
    full_trailer_load_unload_hours: 1.5, rate_per_hour: 92.5
  },
  km_levy: { eur_per_km: 0.12 },
  auto_crane: { handling_rate_multiplier: 1.28 },
  combined_discount_pct: 0.20,
  one_pallet_pricing: {
    mode: "flat_per_distance",
    tiers: [ { max_km: 50, price: 110 }, { max_km: 100, price: 150 } ],
    price_above: 225,
    include_min_fee: false, include_handling: false, include_fuel: false,
    include_km_levy: true, include_city_delivery: true
  },
  beladingsgraad: { one_pallet: 0.05, quarter: 0.25, half: 0.5, three_quarter: 0.75, full: 1.0 },
  trailers: {
    vlakke: { label: "Vlakke trailer", multiplier: 1.00 },
    uitschuif: { label: "Uitschuif trailer", multiplier: 1.10 },
    dieplader: { label: "Dieplader", multiplier: 1.20 },
    tautliner: { label: "Tautliner", multiplier: 1.05 }
  },
  zones: { NL: { flat: 0 } },
  accessorials: { city_delivery: 0 }
};

async function loadConfig() {
  try {
    const p = path.resolve("config/pricing.json");
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch { return DEFAULT_CFG; }
}

const GEOCODER = {
  async distanceKm(from, to) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error("GOOGLE_MAPS_API_KEY ontbreekt in environment variables");
    const params = new URLSearchParams({ origin: from, destination: to, units: "metric", language: "nl", key });
    const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`);
    if (!res.ok) throw new Error(`Directions API HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "OK" || !data.routes?.[0]?.legs?.length) throw new Error(`Directions API fout: ${data.status || "geen route"}`);
    const meters = data.routes[0].legs.reduce((s, l) => s + (l.distance?.value || 0), 0);
    return Math.max(1, Math.round(meters / 1000));
  }
};

// Handling logica (intern: geen afrijden; extern: vaste 1.5+1.5; anders: schaal met ratio)
function calcHandlingSplit(cfg, options, ratio) {
  const h = cfg.handling;
  const approach_min = h.approach_min_hours ?? 0.5;
  const depart_min   = h.depart_min_hours   ?? 0.5;
  const per_op_full  = h.full_trailer_load_unload_hours ?? 1.5;
  const baseRate     = h.rate_per_hour ?? 92.5;
  const rate = baseRate * (options.autolaad_kraan ? (cfg.auto_crane?.handling_rate_multiplier ?? 1.28) : 1);

  const external = !!options.load_unload_external;
  const internal = !external && !!options.load_unload_internal;

  let approach_h = approach_min;
  let depart_h   = external ? depart_min : (internal ? 0 : depart_min);

  let load_h, unload_h;
  if (internal) { load_h = 1.0; unload_h = 1.0; }
  else if (external) { load_h = 1.5; unload_h = 1.5; }
  else { load_h = per_op_full * ratio; unload_h = per_op_full * ratio; }

  const c = {
    approach: approach_h * rate,
    depart:   depart_h   * rate,
    load:     load_h     * rate,
    unload:   unload_h   * rate
  };

  return {
    hours: {
      approach_hours: approach_h, depart_hours: depart_h,
      load_hours: load_h, unload_hours: unload_h,
      total_hours: approach_h + depart_h + load_h + unload_h,
      rate_used: rate
    },
    costs: {
      handling_approach: c.approach,
      handling_depart: c.depart,
      handling_load: c.load,
      handling_unload: c.unload,
      handling_total_internal: c.approach + c.depart + c.load + c.unload
    }
  };
}

// Factor op km-kosten uit config o.b.v. load_grade of “vrije” ratio
function kmFactorFromConfig(cfg, load_grade, ratio) {
  const lf = cfg.load_factor || {};
  if (load_grade && lf[load_grade] != null) return Number(lf[load_grade]);
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  if (r <= 0.25) return Number(lf.fallback_0_25 ?? 0.6);
  if (r <= 0.5)  return Number(lf.fallback_0_50 ?? 0.8);
  if (r <= 0.75) return Number(lf.fallback_0_75 ?? 0.9);
  return Number(lf.fallback_1_00 ?? 1.0);
}

// Helper: mix vaste + variabele componenten met load-factor
function applyLoadShare(amount, factor, share) {
  // share 0..1: 0 = volledig vast, 1 = volledig variabel met factor
  const s = Math.max(0, Math.min(1, Number(share) || 0));
  return amount * (s * factor + (1 - s));
}

export default async (req) => {
  try {
    const body = await req.json();
    const { from, to, trailer_type = "vlakke", options = {} } = body || {};
    if (!from || !to) {
      return new Response(JSON.stringify({ error: "from en to zijn verplicht" }), {
        status: 400, headers: { "content-type": "application/json" }
      });
    }

    const cfg = await loadConfig();
    const distance_km = await GEOCODER.distanceKm(from, to);
    const trailer = cfg.trailers[trailer_type] || cfg.trailers.vlakke;

    const opts = {
      ...options,
      load_unload_external: !!options.load_unload_external,
      load_unload_internal: !!options.load_unload_external ? false : !!options.load_unload_internal
    };

    // beladingsgraad
    let ratio = 0;
    if (typeof opts.load_fraction === "number") ratio = opts.load_fraction;
    else if (typeof opts.load_grade === "string") ratio = cfg.beladingsgraad?.[opts.load_grade] ?? 0;
    ratio = Math.max(0, Math.min(1, ratio || 0));

    const handling = calcHandlingSplit(cfg, opts, ratio);

    const kmFactor = kmFactorFromConfig(cfg, opts.load_grade, ratio);
    const shares = cfg.load_shares || {};
    const perKm = (cfg.eur_per_km_base || 0) * (trailer.multiplier || 1);

    // Basisbedrag (min_fee) deels variabel maken indien gewenst
    const base_fixed_part  = (cfg.min_fee || 0) * (1 - (shares.base_fee_share || 0));
    const base_var_part    = (cfg.min_fee || 0) * (shares.base_fee_share || 0);
    const base_scaled      = base_fixed_part + base_var_part * kmFactor;

    // km-kosten & heffing
    const linehaul_full = distance_km * perKm;
    const linehaul      = applyLoadShare(linehaul_full, kmFactor, shares.linehaul ?? 1.0);

    const km_levy_rate = cfg.km_levy?.eur_per_km ?? 0.12;
    const km_levy_full = opts.km_levy ? km_levy_rate * distance_km : 0;
    const km_levy      = applyLoadShare(km_levy_full, kmFactor, shares.km_levy ?? 1.0);

    // zone & bijkosten
    const zone_full       = (cfg.zones?.NL?.flat || 0);
    const zone_flat       = applyLoadShare(zone_full, kmFactor, shares.zone_flat ?? 0.0);
    const accessorials    = opts.city_delivery ? (cfg.accessorials?.city_delivery || 0) : 0; // meestal vast

    // Subtotalen
    const subtotal_wo_fuel = base_scaled + linehaul + handling.costs.handling_total_internal + km_levy + accessorials + zone_flat;
    const fuel = subtotal_wo_fuel * (cfg.fuel_pct || 0); // wel rekenen, niet tonen

    const preTotal = subtotal_wo_fuel + fuel;
    const discount = opts.combined ? -(preTotal * (cfg.combined_discount_pct ?? 0.2)) : 0;
    const totalRaw = preTotal + discount;

    const total = Math.max(cfg.min_fee || 0, totalRaw);

    const payload = {
      inputs: { from, to, trailer_type, trailer_type_label: trailer.label, options: opts },
      derived: {
        distance_km,
        approach_hours: Number(handling.hours.approach_hours.toFixed(2)),
        depart_hours:   Number(handling.hours.depart_hours.toFixed(2)),
        load_hours:     Number(handling.hours.load_hours.toFixed(2)),
        unload_hours:   Number(handling.hours.unload_hours.toFixed(2)),
        total_hours:    Number(handling.hours.total_hours.toFixed(2)),
        rate_used:      Number(handling.hours.rate_used.toFixed(2))
      },
      breakdown: {
        base: Number(base_scaled.toFixed(2)),
        linehaul: Number(linehaul.toFixed(2)),                // verbergen in UI/PDF
        handling_approach: Number(handling.costs.handling_approach.toFixed(2)),
        handling_depart:   Number(handling.costs.handling_depart.toFixed(2)),
        handling_load:     Number(handling.costs.handling_load.toFixed(2)),
        handling_unload:   Number(handling.costs.handling_unload.toFixed(2)),
        km_levy: Number(km_levy.toFixed(2)),
        accessorials: Number(accessorials.toFixed(2)),
        fuel: Number(fuel.toFixed(2)),                        // wel rekenen, niet tonen
        zone_flat: Number(zone_flat.toFixed(2)),
        discount: Number(discount.toFixed(2))
      },
      total: Number(total.toFixed(2)),
      currency: "EUR"
    };

    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
