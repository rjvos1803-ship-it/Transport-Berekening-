// netlify/functions/quote.mjs
// Netlify Function (ESM) — MUST export `handler`
// Rekent transporttarief o.b.v. Directions API + parameters.

const DEPOTS = {
  alblasserdam: "Coatinc Alblasserdam, Nederland",
  demeern: "De Meern, Nederland",
  groningen: "Groningen, Nederland",
  mook: "Mook, Nederland",
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function getDirections(origin, destination, apiKey) {
  const url =
    "https://maps.googleapis.com/maps/api/directions/json?" +
    new URLSearchParams({
      origin,
      destination,
      key: apiKey,
      region: "nl",
      language: "nl",
    }).toString();

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK") {
    const msg = data?.error_message ? ` (${data.error_message})` : "";
    throw new Error(`Directions API fout: ${data.status}${msg}`);
  }

  const leg = data.routes[0].legs[0];
  const km = leg.distance.value / 1000;
  const hours = leg.duration.value / 3600;

  return {
    km,
    hours,
  };
}

// Beladingsgraad: 1/4, 1/2, 3/4, vol
// (Pallet is aparte route)
function loadFactor(loadGrade) {
  switch (loadGrade) {
    case "quarter":
      return 0.25;
    case "half":
      return 0.5;
    case "threequarter":
      return 0.75;
    case "full":
      return 1.0;
    default:
      return 1.0;
  }
}

function palletPrice(distanceKm) {
  if (distanceKm <= 50) return 110;
  if (distanceKm <= 100) return 150;
  return 225;
}

// Trailer multipliers — pas aan als jullie andere waarden willen
function trailerMultiplier(trailerType) {
  switch (trailerType) {
    case "vlakke":
      return 1.0;
    case "uitschuif":
      return 1.1;
    case "dieplader":
      return 1.15;
    case "tautliner":
      return 1.0;
    default:
      return 1.0;
  }
}

function trailerLabel(trailerType) {
  switch (trailerType) {
    case "vlakke":
      return "Vlakke trailer";
    case "uitschuif":
      return "Uitschuif trailer";
    case "dieplader":
      return "Dieplader";
    case "tautliner":
      return "Tautliner";
    default:
      return trailerType || "-";
  }
}

function loadLabel(loadGrade) {
  switch (loadGrade) {
    case "quarter":
      return "25% (¼ trailer)";
    case "half":
      return "50% (½ trailer)";
    case "threequarter":
      return "75% (¾ trailer)";
    case "full":
      return "Volle trailer";
    case "pallet":
      return "1× pallet";
    default:
      return loadGrade || "-";
  }
}

export const handler = async (event) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return json(500, {
        error: "Internal error",
        detail: "Error: GOOGLE_MAPS_API_KEY ontbreekt in environment variables",
      });
    }

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Gebruik POST" });
    }

    let payload = {};
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Ongeldige JSON body" });
    }

    const from = (payload.from || "").trim();
    const to = (payload.to || "").trim();
    if (!from || !to) {
      return json(400, { error: "from en to zijn verplicht" });
    }

    const reference = (payload.reference || "").trim();

    const trailer_type = payload.trailer_type || "vlakke";
    const load_grade = payload.load_grade || "full"; // quarter/half/threequarter/full/pallet
    const depot_key = (payload.depot || "alblasserdam").toLowerCase();

    const options = payload.options || {};
    const km_levy = !!options.km_levy;
    const autolaad_kraan = !!options.autolaad_kraan;

    // locatie keuze: EXACT 1 van de twee
    // internal_location / external_location (boolean)
    const internal_location = !!options.internal_location;
    const external_location = !!options.external_location;

    if (internal_location && external_location) {
      return json(400, { error: "Kies óf interne locatie óf externe locatie (niet beide)." });
    }

    const depotAddress = DEPOTS[depot_key] || DEPOTS.alblasserdam;

    // Instellingen (jullie waarden)
    const min_fee = 110.0;         // minimum totaal
    const eur_per_km_base = 0.80;  // km tarief
    const base_hour_rate = 92.5;   // uurtarief handling
    const km_levy_per_km = 0.12;   // optioneel

    // Routes
    const [approach, main, depart] = await Promise.all([
      getDirections(depotAddress, from, apiKey),
      getDirections(from, to, apiKey),
      getDirections(to, depotAddress, apiKey),
    ]);

    const distance_km = main.km;

    // Aanrij/Afrij tijd (minimaal 0,5u)
    let approach_hours = Math.max(0.5, approach.hours);
    let depart_hours = Math.max(0.5, depart.hours);

    // Bij interne locatie: GEEN afrijtijd gebruiken (zoals jij vroeg)
    if (internal_location) depart_hours = 0;

    // Laad/los uren (als “locatie optie” gekozen is)
    // Interne locatie: totaal = 1.5 + 0.5 = 2.0 uur
    // Externe locatie: totaal = 1.5 + 1.5 = 3.0 uur
    let loadunload_hours_full = 0;
    if (internal_location) loadunload_hours_full = 2.0;
    if (external_location) loadunload_hours_full = 3.0;

    // Beladingsgraad beïnvloedt uren (ratio)
    const lf = load_grade === "pallet" ? 1.0 : loadFactor(load_grade);
    const loadunload_hours = loadunload_hours_full * lf;

    // Autolaadkraan: +28% op uurtarief
    const rate_used = autolaad_kraan ? base_hour_rate * 1.28 : base_hour_rate;

    // Kilometerkosten (blijft intern/achtergrond, mag UI/PDF verbergen)
    const mult = trailerMultiplier(trailer_type);
    const linehaul = distance_km * eur_per_km_base * mult * lf;

    // Pallet vaste prijs (vervangt “transportbasis”; handling + heffing kan er nog bovenop)
    const pallet_fee = load_grade === "pallet" ? palletPrice(distance_km) : 0;

    // Kilometerheffing
    const km_levy_cost = km_levy ? distance_km * km_levy_per_km : 0;

    // Handling kosten: aanrij + afrij + laden/lossen
    const handling_cost = (approach_hours + depart_hours + loadunload_hours) * rate_used;

    // Totaal
    const subtotal = linehaul + pallet_fee + km_levy_cost + handling_cost;
    const total = Math.max(min_fee, subtotal);

    // Breakdown: stuur alles terug; UI/PDF kan bepaalde regels verbergen
    const breakdown = {
      // base op 0 gezet (zoals je wilde), min_fee blijft wel actief in total
      base: 0,
      // linehaul = kilometerkosten (jij wilt verbergen, maar wel rekenen)
      linehaul: round2(linehaul),
      pallet_fee: round2(pallet_fee),
      handling_approach: round2(approach_hours * rate_used),
      handling_depart: round2(depart_hours * rate_used),
      handling_loadunload: round2(loadunload_hours * rate_used),
      km_levy: round2(km_levy_cost),
    };

    return json(200, {
      inputs: {
        reference,
        from,
        to,
        trailer_type,
        trailer_type_label: trailerLabel(trailer_type),
        load_grade,
        load_label: loadLabel(load_grade),
        depot: depot_key,
        depot_label:
          depot_key === "alblasserdam" ? "Alblasserdam" :
          depot_key === "demeern" ? "De Meern" :
          depot_key === "groningen" ? "Groningen" :
          depot_key === "mook" ? "Mook" : depot_key,
        options: {
          internal_location,
          external_location,
          autolaad_kraan,
          km_levy,
        },
      },
      derived: {
        distance_km: round2(distance_km),
        approach_hours: round2(approach_hours),
        depart_hours: round2(depart_hours),
        loadunload_hours: round2(loadunload_hours),
        rate_used: round2(rate_used),
        min_fee: round2(min_fee),
      },
      breakdown,
      // totaal
      total: round2(total),
      subtotal: round2(subtotal),
    });
  } catch (e) {
    return json(500, { error: "Internal error", detail: String(e) });
  }
};
