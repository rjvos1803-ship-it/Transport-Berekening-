// netlify/functions/quote.mjs
// Netlify Function (ESM) - rekent transporttarief + depot-keuze voor aanrij/afrij
import pricing from "../../config/pricing.json" assert { type: "json" };

const DEPOTS = {
  alblasserdam: "Coatinc Alblasserdam, NL",
  demeern: "Coatinc De Meern, NL",
  groningen: "Coatinc Groningen, NL",
  mook: "Coatinc Mook, NL",
};

const DEPOT_LABELS = {
  alblasserdam: "Alblasserdam",
  demeern: "De Meern",
  groningen: "Groningen",
  mook: "Mook",
};

const TRAILER_LABELS = {
  vlakke: "Vlakke trailer",
  uitschuif: "Uitschuif trailer",
  diepladen: "Diepladen",
  tautliner: "Tautliner",
};

const LOAD_GRADE_LABELS = {
  pallet_1x: "1× pallet",
  quarter: "¼ trailer",
  half: "½ trailer",
  three_quarter: "¾ trailer",
  full: "Volle trailer",
};

// Beladingsgraad factoren (makkelijk aan te passen)
// -> Hiermee schaal je handling en/of “vaste” delen (niet de km kosten, die houden we verborgen maar rekenen wel)
const LOAD_GRADE_FACTOR = {
  pallet_1x: 0.05,
  quarter: 0.25,
  half: 0.5,
  three_quarter: 0.75,
  full: 1.0,
};

// 1× pallet vaste prijs per afstandsband (zoals afgesproken)
function palletFixedPrice(distanceKm) {
  if (distanceKm <= 50) return 110;
  if (distanceKm <= 100) return 150;
  return 225;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requireStr(v, name) {
  if (!v || typeof v !== "string" || !v.trim()) throw new Error(`${name} ontbreekt`);
  return v.trim();
}

function n(v, def = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : def;
}

async function directions(origin, destination, key) {
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (!data || data.status !== "OK") {
    throw new Error(`Directions API fout: ${data?.status || "UNKNOWN"}`);
  }
  const leg = data.routes?.[0]?.legs?.[0];
  const distanceMeters = leg?.distance?.value ?? 0;
  const durationSeconds = leg?.duration?.value ?? 0;

  return {
    distance_km: Math.round((distanceMeters / 1000) * 10) / 10,
    duration_h: durationSeconds / 3600,
  };
}

export default async function handler(req) {
  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error("GOOGLE_MAPS_API_KEY ontbreekt in environment variables");

    const body = await req.json().catch(() => ({}));

    const reference = (body.reference || "").toString();
    const from = requireStr(body.from, "from");
    const to = requireStr(body.to, "to");

    const trailer_type = (body.trailer_type || "vlakke").toString();
    const load_grade = (body.load_grade || "full").toString();

    const depot = (body.depot || "alblasserdam").toString();
    const depotAddress = DEPOTS[depot] || DEPOTS.alblasserdam;

    const options = body.options || {};
    const autolaad_kraan = !!options.autolaad_kraan;
    const km_levy = !!options.km_levy;

    // internal/external: verplicht één (UI dwingt dit af)
    const load_unload_location = (options.load_unload_location || "external").toString(); // "internal" | "external"

    // ROUTES:
    // - main route: from -> to
    // - approach route: depot -> from
    // - depart route: to -> depot  (maar: bij interne locatie géén afrijtijd gebruiken)
    const main = await directions(from, to, key);
    const approach = await directions(depotAddress, from, key);
    const depart = load_unload_location === "internal" ? { distance_km: 0, duration_h: 0 } : await directions(to, depotAddress, key);

    // MINIMA
    const approach_hours = Math.max(0.5, approach.duration_h || 0.0);
    const depart_hours = load_unload_location === "internal" ? 0.0 : Math.max(0.5, depart.duration_h || 0.0);

    // Laden/Lossen uren (zoals afgesproken):
    // - Interne locatie: totaal 1.5 + 0.5 = 2.0 uur
    // - Externe locatie: totaal 1.5 + 1.5 = 3.0 uur
    const load_unload_hours_total = load_unload_location === "internal" ? 2.0 : 3.0;

    // Beladingsfactor
    const lf = LOAD_GRADE_FACTOR[load_grade] ?? 1.0;

    // Pricing
    const min_fee = n(pricing.min_fee, 110);
    const eur_per_km_base = n(pricing.eur_per_km_base, 0.8);
    const rate_per_hour = n(pricing.rate_per_hour, 92.5);
    const km_levy_per_km = n(pricing.km_levy_per_km, 0.12);

    const multiplier = n(pricing.multipliers?.[trailer_type], 1.0);

    // Autolaadkraan: +28% op uurtarief
    const rate_used = rate_per_hour * (autolaad_kraan ? 1.28 : 1.0) * multiplier;

    // Kilometerkosten (we rekenen dit mee maar UI/PDF verbergt deze)
    const linehaul = (main.distance_km * eur_per_km_base) * multiplier;

    // Brandstof (we rekenen mee maar UI/PDF verbergt deze)
    const fuel = n(pricing.fuel_pct, 0.0) > 0 ? linehaul * n(pricing.fuel_pct, 0.0) : 0;

    // Basistarief (op achtergrond, door jou aanpasbaar in pricing.json)
    const base = n(pricing.base_fee, 0.0);

    // Handling: aanrij/afrij en laden/lossen — schaalbaar met beladingsgraad
    // (hier zit je "beladingsgraad werkt niet" meestal: zorg dat lf toegepast wordt)
    const handling_approach = approach_hours * rate_used * lf;
    const handling_depart = depart_hours * rate_used * lf;
    const handling_load_unload = load_unload_hours_total * rate_used * lf;

    // Pallet 1x: vaste prijs override (zoals afgesproken)
    // -> als load_grade == pallet_1x zetten we handling + base/linehaul etc nog steeds aan? (meestal wil je “all-in”)
    // Hier doen we: pallet prijs = minimum tarief + km levy optie (indien aangevinkt) (simpel en duidelijk)
    let pallet_override = 0;
    if (load_grade === "pallet_1x") {
      pallet_override = palletFixedPrice(main.distance_km);
    }

    // Kilometerheffing
    const km_levy_cost = km_levy ? (main.distance_km * km_levy_per_km) : 0;

    // Totaal berekenen
    let subtotal =
      base +
      linehaul +
      fuel +
      handling_approach +
      handling_depart +
      handling_load_unload +
      km_levy_cost;

    // Als pallet override actief is, gebruiken we dat als “hoofdbedrag”
    // (en tellen alleen km levy erbij als die aangevinkt is)
    if (pallet_override > 0) {
      subtotal = pallet_override + km_levy_cost;
    }

    // Min fee
    const total = Math.max(min_fee, subtotal);

    return json({
      inputs: {
        reference,
        from,
        to,
        depot,
        depot_label: DEPOT_LABELS[depot] || "Alblasserdam",
        trailer_type,
        trailer_type_label: TRAILER_LABELS[trailer_type] || trailer_type,
        load_grade,
        load_grade_label: LOAD_GRADE_LABELS[load_grade] || load_grade,
        options: {
          autolaad_kraan,
          km_levy,
          load_unload_location,
        },
      },
      derived: {
        distance_km: main.distance_km,
        approach_km: approach.distance_km,
        depart_km: depart.distance_km,
        approach_hours,
        depart_hours,
        load_unload_hours_total,
        load_factor: lf,
        rate_used,
      },
      breakdown: {
        // UI/PDF mag dit verbergen, maar we geven het wel terug
        base,
        linehaul,
        fuel,

        handling_approach,
        handling_depart,
        handling_load_unload,

        km_levy: km_levy_cost,

        // voor debugging/controle (mag je later weghalen)
        pallet_override,
      },
      total,
    });
  } catch (e) {
    return json(
      { error: "Internal error", detail: String(e?.message || e) },
      500
    );
  }
}
