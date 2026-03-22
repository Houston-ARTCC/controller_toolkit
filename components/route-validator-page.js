"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const ATIS_URLS = {
  KIAH: "https://atis.info/api/KIAH",
  KHOU: "https://atis.info/api/KHOU",
  KDFW: "https://atis.info/api/KDFW",
  KDAL: "https://atis.info/api/KDAL",
  KATL: "https://atis.info/api/KATL",
};
const VATSIM_DATA_URL = "https://data.vatsim.net/v3/vatsim-data.json";
const TRAFFIC_REFRESH_MS = 60_000;
const ATIS_REFRESH_MS = 30 * 60_000;
const FEED_STALE_MS = 60 * 60_000;
const STATUS_SORT_ORDER = {
  "CHECK ROUTE": 0,
  FLOW: 1,
  ALTITUDE: 2,
  REVISION: 3,
  VALID: 4,
  "NO RULE": 6,
};

const KIAH_FLOW_SID_RULES = [
  { prefix: "BNDTO", flow: "West" },
  { prefix: "PITZZ", flow: "East" },
  { prefix: "MMUGS", flow: "West" },
  { prefix: "GUMBY", flow: "East" },
];

const STATIC_CONNECTED_PILOTS = [
  {
    cid: 900001,
    callsign: "UAL1423",
    altitude: 0,
    groundspeed: 0,
    flight_plan: {
      departure: "KIAH",
      arrival: "KAUS",
      altitude: "FL240",
      aircraft_short: "B738",
      aircraft_faa: "B738/L",
      route: "BNDTO5 MNURE WLEEE7",
    },
  },
  {
    cid: 900002,
    callsign: "SWA2176",
    altitude: 0,
    groundspeed: 0,
    flight_plan: {
      departure: "KIAH",
      arrival: "KDFW",
      altitude: "FL290",
      aircraft_short: "B737",
      aircraft_faa: "B737/L",
      route: "BLTWY7 CRIED WHINY",
    },
  },
  {
    cid: 900003,
    callsign: "AAL309",
    altitude: 0,
    groundspeed: 0,
    flight_plan: {
      departure: "KIAH",
      arrival: "KMSY",
      altitude: "FL210",
      aircraft_short: "A320",
      aircraft_faa: "A320/L",
      route: "MMUGS4 GUSTI AWDAD AWDAD1",
    },
  },
  {
    cid: 900004,
    callsign: "DAL1884",
    altitude: 0,
    groundspeed: 0,
    flight_plan: {
      departure: "KIAH",
      arrival: "KDEN",
      altitude: "FL340",
      aircraft_short: "B739",
      aircraft_faa: "B739/L",
      route: "TRIOS4 CRIED J64 LAA",
    },
  },
  {
    cid: 900005,
    callsign: "FFT921",
    altitude: 0,
    groundspeed: 0,
    flight_plan: {
      departure: "KIAH",
      arrival: "KMIA",
      altitude: "FL370",
      aircraft_short: "A321",
      aircraft_faa: "A321/L",
      route: "DCT MIA",
    },
  },
  {
    cid: 900006,
    callsign: "N84JS",
    altitude: 0,
    groundspeed: 0,
    flight_plan: {
      departure: "KHOU",
      arrival: "KIAH",
      altitude: "050",
      aircraft_short: "C56X",
      route: "DCT",
    },
  },
  {
    cid: 900007,
    callsign: "N732TX",
    altitude: 0,
    groundspeed: 0,
    flight_plan: {
      departure: "KIAH",
      arrival: "KBPT",
      altitude: "120",
      aircraft_short: "BE58",
      aircraft_faa: "BE58/G",
      route: "DIRECT",
    },
  },
  {
    cid: 900008,
    callsign: "N52PC",
    altitude: 0,
    groundspeed: 0,
    flight_plan: {
      departure: "KIAH",
      arrival: "KSAT",
      altitude: "090",
      aircraft_short: "C208",
      aircraft_faa: "C208/L",
      route: "LCH5 LCH V20 RQR",
    },
  },
];

const STATIC_PREFILES = [
  {
    cid: 910001,
    callsign: "UAL1809",
    flight_plan: {
      departure: "KIAH",
      arrival: "KATL",
      altitude: "FL330",
      aircraft_short: "B739",
      aircraft_faa: "B739/A",
      route: "LCH5 LCH J2 SJI MVC V222 TIROE",
    },
  },
  {
    cid: 910002,
    callsign: "JBU1552",
    flight_plan: {
      departure: "KIAH",
      arrival: "KBOS",
      altitude: "FL340",
      aircraft_short: "A220",
      aircraft_faa: "A220/L",
      route: "BLTWY6 HUMPS J29 SPA",
    },
  },
  {
    cid: 910003,
    callsign: "SWA440",
    flight_plan: {
      departure: "KAUS",
      arrival: "KIAH",
      altitude: "FL200",
      aircraft_short: "B737",
      aircraft_faa: "B737/L",
      route: "CWK CLUTCH4",
    },
  },
];

function buildStaticPilotList() {
  const connectedPilots = STATIC_CONNECTED_PILOTS.filter((pilot) => pilot?.flight_plan?.departure).map(
    (pilot) => ({
      ...pilot,
      __isPrefile: false,
    }),
  );

  const prefilePilots = STATIC_PREFILES.filter((prefile) => prefile?.flight_plan?.departure).map(
    (prefile) => ({
      ...prefile,
      altitude: 0,
      groundspeed: 0,
      __isPrefile: true,
    }),
  );

  const connectedKeys = new Set(
    connectedPilots.map((pilot) => {
      const flightPlan = pilot.flight_plan || {};
      return `${(pilot.callsign || "").toUpperCase()}|${normalizeAirport(flightPlan.departure)}|${normalizeAirport(
        flightPlan.arrival,
      )}`;
    }),
  );

  const uniquePrefiles = prefilePilots.filter((prefile) => {
    const flightPlan = prefile.flight_plan || {};
    const key = `${(prefile.callsign || "").toUpperCase()}|${normalizeAirport(
      flightPlan.departure,
    )}|${normalizeAirport(flightPlan.arrival)}`;
    return !connectedKeys.has(key);
  });

  return [...connectedPilots, ...uniquePrefiles];
}

function normalizeAirport(code) {
  const cleaned = (code || "").trim().toUpperCase();
  if (!cleaned) {
    return "";
  }

  // Preserve full ICAO identifiers (e.g. MHPR, CYYZ). Only expand 3-letter
  // domestic-style codes (e.g. IAH -> KIAH) for alias matching convenience.
  if (cleaned.length === 4 || cleaned.length === 5) {
    return cleaned;
  }

  if (cleaned.length === 3 && /^[A-Z0-9]{3}$/.test(cleaned)) {
    return cleaned.startsWith("K") ? cleaned : `K${cleaned}`;
  }

  return cleaned;
}

function normalizeRouteString(value) {
  return (value || "").toUpperCase().replace(/[^A-Z0-9#\/\s]/g, " ").replace(/\s+/g, " ").trim();
}

function stripRouteAnnotations(value) {
  // Route notes such as ", MAX CRZ 9k" should not participate in token matching.
  return (value || "").split(",")[0].trim();
}

function parseFiledAltitudeFeet(altitudeText) {
  const raw = (altitudeText || "").toString().trim().toUpperCase();
  if (!raw) {
    return null;
  }

  const flMatch = raw.match(/^FL\s*(\d{2,3})$/);
  if (flMatch) {
    return Number.parseInt(flMatch[1], 10) * 100;
  }

  const num = Number.parseInt(raw, 10);
  if (!Number.isFinite(num)) {
    return null;
  }

  // Common VATSIM formats: 080/120 => hundreds of feet, 12000 => feet.
  return num <= 600 ? num * 100 : num;
}

function formatFiledAltitudeDisplay(altitudeText) {
  const feet = parseFiledAltitudeFeet(altitudeText);
  if (feet === null) {
    return "-";
  }

  const hundreds = Math.round(feet / 100);
  if (feet >= 18_000) {
    return `FL${String(hundreds).padStart(3, "0")}`;
  }

  return String(hundreds).padStart(3, "0");
}

function parseAltitudeTokenToFeet(token) {
  const cleaned = (token || "").toUpperCase().trim();
  if (!cleaned) {
    return null;
  }

  const flMatch = cleaned.match(/^FL\s*(\d{2,3})$/);
  if (flMatch) {
    return Number.parseInt(flMatch[1], 10) * 100;
  }

  const kMatch = cleaned.match(/^(\d{1,3})\s*K$/);
  if (kMatch) {
    return Number.parseInt(kMatch[1], 10) * 1000;
  }

  const numMatch = cleaned.match(/^(\d{2,5})$/);
  if (!numMatch) {
    return null;
  }

  const num = Number.parseInt(numMatch[1], 10);
  return num <= 600 ? num * 100 : num;
}

function extractFirstSidToken(filedTokens) {
  for (const token of filedTokens || []) {
    if (!token) {
      continue;
    }
    const cleaned = token.replace(/[^A-Z0-9]/g, "");
    if (!cleaned) {
      continue;
    }
    if (/^(DCT|DIRECT)$/.test(cleaned)) {
      continue;
    }
    return cleaned;
  }
  return "";
}

function getKiahSidFlowMismatchInfo(departure, filedTokens, kiahFlow) {
  if (departure !== "KIAH" || !kiahFlow || kiahFlow === "Unknown") {
    return { mismatch: false, reason: "" };
  }

  const firstToken = extractFirstSidToken(filedTokens);
  if (!firstToken) {
    return { mismatch: false, reason: "" };
  }

  const matchedRule = KIAH_FLOW_SID_RULES.find((rule) => new RegExp(`^${rule.prefix}\\d+$`).test(firstToken));
  if (!matchedRule) {
    return { mismatch: false, reason: "" };
  }

  if (matchedRule.flow === kiahFlow) {
    return { mismatch: false, reason: "" };
  }

  return {
    mismatch: true,
    reason: `SID ${firstToken} is ${matchedRule.flow}-flow, but KIAH is ${kiahFlow}`,
  };
}

function parseAltitudeConstraint(variant) {
  const combined = `${variant?.label || ""} ${variant?.route || ""}`.toUpperCase();
  let minFeet = null;
  let maxFeet = null;

  const maxCrzMatch = combined.match(/MAX\s*CRZ\s*(FL\s*\d{2,3}|\d{1,3}\s*K|\d{2,5})/);
  if (maxCrzMatch) {
    maxFeet = parseAltitudeTokenToFeet(maxCrzMatch[1]);
  }

  const reqFlMinMatch = combined.match(/REQ\s*FL\s*(\d{2,3})\+/);
  if (reqFlMinMatch) {
    minFeet = Number.parseInt(reqFlMinMatch[1], 10) * 100;
  }

  const reqKMinMatch = combined.match(/REQ\s*(\d{1,3})\s*K\+/);
  if (reqKMinMatch) {
    minFeet = Number.parseInt(reqKMinMatch[1], 10) * 1000;
  }

  const reqKMaxMatch = combined.match(/REQ\s*(\d{1,3})\s*K->/);
  if (reqKMaxMatch) {
    maxFeet = Number.parseInt(reqKMaxMatch[1], 10) * 1000;
  }

  if (minFeet === null && maxFeet === null) {
    return null;
  }

  return { minFeet, maxFeet };
}

function evaluateAltitudeConstraint(filedAltitudeFeet, constraint) {
  if (!constraint || filedAltitudeFeet === null) {
    return { violated: false, reason: "" };
  }

  if (constraint.maxFeet !== null && filedAltitudeFeet > constraint.maxFeet) {
    return {
      violated: true,
      reason: `Filed altitude above max ${constraint.maxFeet.toLocaleString()} ft`,
    };
  }

  if (constraint.minFeet !== null && filedAltitudeFeet < constraint.minFeet) {
    return {
      violated: true,
      reason: `Filed altitude below required ${constraint.minFeet.toLocaleString()} ft`,
    };
  }

  return { violated: false, reason: "" };
}

function tokenizeFiledRoute(value) {
  const cleaned = normalizeRouteString(value);
  return cleaned ? cleaned.split(" ") : [];
}

function parsePreferredToken(token) {
  const cleaned = token.replace(/#/g, "").trim();
  if (!cleaned) {
    return [];
  }

  if (/^(TBD|DCT|DIRECT)$/i.test(cleaned)) {
    return [];
  }

  if (/^FL?\d+$/i.test(cleaned)) {
    return [];
  }

  return cleaned.split("/").map((part) => part.trim()).filter(Boolean);
}

function stripProcedureRevision(token) {
  const match = token.match(/^([A-Z]{4,6})(\d{1,2})$/);
  if (!match) {
    return "";
  }

  return match[1];
}

function tokensMatch(filedToken, preferredOption, allowRevisionMatch) {
  const filed = filedToken.replace(/#/g, "");
  const preferred = preferredOption.replace(/#/g, "");

  if (filed === preferred) {
    return true;
  }

  if (!allowRevisionMatch) {
    return false;
  }

  const filedBase = stripProcedureRevision(filed);
  const preferredBase = stripProcedureRevision(preferred);
  return Boolean(filedBase && preferredBase && filedBase === preferredBase);
}

function matchPreferredRoute(filedTokens, preferredRoute, allowRevisionMatch = false) {
  const preferredCore = normalizeRouteString(stripRouteAnnotations(preferredRoute));
  if (preferredCore === "DIRECT" || preferredCore === "DCT") {
    const hasDirect = filedTokens.some((token) => token === "DIRECT" || token === "DCT");
    return {
      matched: hasDirect,
      ratio: hasDirect ? 1 : 0,
    };
  }

  const preferredTokens = preferredCore
    .split(" ")
    .map(parsePreferredToken)
    .filter((options) => options.length > 0);

  if (preferredTokens.length === 0) {
    return { matched: false, ratio: 0 };
  }

  let searchStart = 0;
  let matchedCount = 0;

  for (const options of preferredTokens) {
    let foundIndex = -1;
    for (let index = searchStart; index < filedTokens.length; index += 1) {
      if (options.some((option) => tokensMatch(filedTokens[index], option, allowRevisionMatch))) {
        foundIndex = index;
        break;
      }
    }

    if (foundIndex >= 0) {
      matchedCount += 1;
      searchStart = foundIndex + 1;
    }
  }

  const ratio = matchedCount / preferredTokens.length;
  return {
    matched: ratio === 1,
    ratio,
  };
}

function getFirstRouteTokenOptions(routeText) {
  const tokens = normalizeRouteString(stripRouteAnnotations(routeText)).split(" ");
  for (const token of tokens) {
    const options = parsePreferredToken(token);
    if (options.length > 0) {
      return options.map((option) => option.replace(/#/g, ""));
    }
  }
  return [];
}

function classifyMatch(
  hasExact,
  hasRevisionMatch,
  hasRule,
  hasFlowMismatch = false,
  hasAltitudeMismatch = false,
  hasNoRuleFlowMismatch = false,
) {
  if (!hasRule && hasNoRuleFlowMismatch) {
    return { label: "FLOW", tone: "bad" };
  }

  if (!hasRule) {
    return { label: "NO RULE", tone: "neutral" };
  }

  if (hasAltitudeMismatch) {
    return { label: "ALTITUDE", tone: "bad" };
  }

  if (hasFlowMismatch) {
    return { label: "FLOW", tone: "bad" };
  }

  if (hasExact) {
    return { label: "VALID", tone: "good" };
  }

  if (hasRevisionMatch) {
    return { label: "REVISION", tone: "revision" };
  }

  return { label: "CHECK ROUTE", tone: "bad" };
}

function parseArrivalRunwayNumbersFromAtis(datisText) {
  const upper = (datisText || "").toUpperCase();
  if (!upper) {
    return [];
  }

  const arrivalsSlice = upper.includes("ARRIVALS EXPECT")
    ? upper.split("ARRIVALS EXPECT")[1]?.split("DEPG")[0] || ""
    : upper;

  const runwayMatches = arrivalsSlice.match(/\b(?:RY|RWY|RUNWAY)\s*(\d{1,2})(?:[LRC])?\b/g) || [];
  const runwayNumbers = runwayMatches
    .map((item) => {
      const match = item.match(/(\d{1,2})/);
      return match ? Number.parseInt(match[1], 10) : NaN;
    })
    .filter((value) => Number.isFinite(value));

  return runwayNumbers;
}

function parseDepartureRunwayNumbersFromAtis(datisText) {
  const upper = (datisText || "").toUpperCase();
  if (!upper) {
    return [];
  }

  const departureSlice = upper.includes("DEPG")
    ? upper.split("DEPG")[1]?.split("NOTICE")[0] || ""
    : upper.includes("DEPARTURES EXPECT")
      ? upper.split("DEPARTURES EXPECT")[1]?.split("NOTICE")[0] || ""
      : "";

  const runwayMatches =
    departureSlice.match(/\b(?:RY|RWY|RUNWAY)\s*(\d{1,2})(?:[LRC])?\b/g) || [];

  return runwayMatches
    .map((item) => {
      const match = item.match(/(\d{1,2})/);
      return match ? Number.parseInt(match[1], 10) : NaN;
    })
    .filter((value) => Number.isFinite(value));
}

function parseRunwayNumbersFromPhrase(text = "") {
  const matches = text.match(/\b(\d{1,2})(?:[LRC])?\b/g) || [];
  return matches
    .map((token) => Number.parseInt(token, 10))
    .filter((value) => Number.isFinite(value));
}

function detectFlowFromAtis(airport, datisText) {
  const runwayNumbers = parseArrivalRunwayNumbersFromAtis(datisText);
  if (runwayNumbers.length === 0) {
    return "Unknown";
  }

  if (airport === "KIAH") {
    const hasWest = runwayNumbers.some((value) => value === 26 || value === 27);
    const hasEast = runwayNumbers.some((value) => value === 8 || value === 9);

    if (hasWest && !hasEast) {
      return "West";
    }
    if (hasEast && !hasWest) {
      return "East";
    }
    return "Unknown";
  }

  if (airport === "KDFW") {
    const hasNorth = runwayNumbers.some((value) => value === 35 || value === 36);
    const hasSouth = runwayNumbers.some((value) => value === 17 || value === 18);

    if (hasNorth && !hasSouth) {
      return "North";
    }
    if (hasSouth && !hasNorth) {
      return "South";
    }
    return "Unknown";
  }

  if (airport === "KDAL") {
    const hasNorth = runwayNumbers.some((value) => value === 31);
    const hasSouth = runwayNumbers.some((value) => value === 13);

    if (hasNorth && !hasSouth) {
      return "North";
    }
    if (hasSouth && !hasNorth) {
      return "South";
    }
    return "Unknown";
  }

  if (airport === "KHOU") {
    const upper = (datisText || "").toUpperCase();
    let arrivalRunwayNumbers = [];
    let departureRunwayNumbers = [];

    const combinedMatch = upper.match(/LNDG\s+AND\s+DEPG\s+RWY(?:S)?\s+([^.]*)/);
    if (combinedMatch?.[1]) {
      const shared = parseRunwayNumbersFromPhrase(combinedMatch[1]);
      arrivalRunwayNumbers = shared;
      departureRunwayNumbers = shared;
    } else {
      const landingMatch = upper.match(/(?:LANDING|LNDG)\s+RWY(?:S)?\s+([^.]*)/);
      const departingMatch = upper.match(/(?:DEPARTING|DEPG)\s+RWY(?:S)?\s+([^.]*)/);
      if (landingMatch?.[1]) {
        arrivalRunwayNumbers = parseRunwayNumbersFromPhrase(landingMatch[1]);
      }
      if (departingMatch?.[1]) {
        departureRunwayNumbers = parseRunwayNumbersFromPhrase(departingMatch[1]);
      }
    }

    // Final fallback for unusual phrasing.
    if (arrivalRunwayNumbers.length === 0) {
      arrivalRunwayNumbers = runwayNumbers;
    }
    if (departureRunwayNumbers.length === 0) {
      departureRunwayNumbers = parseDepartureRunwayNumbersFromAtis(datisText);
    }

    const hasArrival = (runway) => arrivalRunwayNumbers.includes(runway);
    const hasDeparture = (runway) => departureRunwayNumbers.includes(runway);

    if (hasArrival(4) && hasDeparture(13)) {
      return "Church";
    }
    if (hasArrival(4) && hasDeparture(31)) {
      return "East";
    }
    if (hasArrival(22) && hasDeparture(22)) {
      return "West";
    }
    if (hasArrival(31) && hasDeparture(31)) {
      return "North";
    }
    if (hasArrival(13) && hasDeparture(13)) {
      return "South";
    }
    return "Unknown";
  }

  if (airport === "KATL") {
    const hasWest = runwayNumbers.some((value) => value === 26 || value === 27 || value === 28);
    const hasEast = runwayNumbers.some((value) => value === 8 || value === 9 || value === 10);

    if (hasWest && !hasEast) {
      return "West";
    }
    if (hasEast && !hasWest) {
      return "East";
    }
    return "Unknown";
  }

  return "Unknown";
}

function flowFromDirectionLetter(letter) {
  if (letter === "N") return "North";
  if (letter === "S") return "South";
  if (letter === "E") return "East";
  if (letter === "W") return "West";
  return "Unknown";
}

function extractFlowTagsFromVariantLabel(label) {
  const upper = (label || "").toUpperCase();
  const tags = [];
  const pattern = /\b(IAH|DFW|DAL|ATL)([NSEW])\b/g;
  let match = pattern.exec(upper);
  while (match) {
    tags.push({
      airport: `K${match[1]}`,
      flow: flowFromDirectionLetter(match[2]),
    });
    match = pattern.exec(upper);
  }
  return tags;
}

function isVariantFlowCompatible(label, flowsByAirport) {
  const tags = extractFlowTagsFromVariantLabel(label);
  if (tags.length === 0) {
    return true;
  }

  return tags.every((tag) => {
    const observed = flowsByAirport[tag.airport]?.flow || "Unknown";
    return observed === "Unknown" || observed === tag.flow;
  });
}

function variantHasFlowConflict(label, flowsByAirport) {
  const tags = extractFlowTagsFromVariantLabel(label);
  if (tags.length === 0) {
    return false;
  }

  return tags.some((tag) => {
    const observed = flowsByAirport[tag.airport]?.flow || "Unknown";
    return observed !== "Unknown" && observed !== tag.flow;
  });
}

function isLikelyDeparted(pilot) {
  const altitude = Number.parseInt(pilot?.altitude ?? "0", 10) || 0;
  const groundspeed = Number.parseInt(pilot?.groundspeed ?? "0", 10) || 0;

  // Heuristic: filter aircraft that are likely airborne, while keeping aircraft
  // taxiing or waiting for departure at the field.
  if (altitude >= 1500) {
    return true;
  }

  if (altitude >= 400 && groundspeed >= 100) {
    return true;
  }

  if (groundspeed >= 260) {
    return true;
  }

  return false;
}

function getAircraftTypeAndSuffix(flightPlan = {}) {
  const faaRaw = (flightPlan.aircraft_faa || "").toUpperCase().trim();
  const icao = (flightPlan.aircraft_short || flightPlan.aircraft || "").toUpperCase().trim();
  const faa = faaRaw;

  if (faa.includes("/")) {
    const parts = faa.split("/").filter(Boolean);

    const hasWakePrefix =
      parts.length >= 2 && (parts[0] === "H" || parts[0] === "J" || parts[0] === "S");

    if (hasWakePrefix) {
      const typeCore = parts[1] || "";
      const suffix = parts.length > 2 ? parts[parts.length - 1] : "";
      return {
        type: typeCore ? `${parts[0]}/${typeCore}` : icao || "Unknown",
        suffix,
      };
    }

    const type = parts[0] || "";
    const suffix = parts.length > 1 ? parts[parts.length - 1] : "";
    return {
      type: type || icao || "Unknown",
      suffix,
    };
  }

  if (faa) {
    return { type: faa, suffix: "" };
  }

  if (icao.includes("/")) {
    const [type, suffix] = icao.split("/");
    return {
      type: type || "Unknown",
      suffix: suffix || "",
    };
  }

  return { type: icao || "Unknown", suffix: "" };
}

function formatRefreshCountdown(targetMs, nowMs) {
  if (!targetMs) {
    return "--:--";
  }

  const remaining = Math.max(0, targetMs - nowMs);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getFeedStatusTone({ mode, hasError, lastUpdatedMs, nowMs }) {
  if (hasError) {
    return "red";
  }
  if (!lastUpdatedMs || nowMs - lastUpdatedMs > FEED_STALE_MS) {
    return "red";
  }
  if (mode === "static") {
    return "yellow";
  }
  return "green";
}

function AirportInput({ id, label, value, onChange, airports, compact = false }) {
  return (
    <label className={compact ? "w-[9rem] shrink-0 space-y-1" : "min-w-[16rem] flex-1 space-y-1"} htmlFor={id}>
      <span className="text-muted text-xs uppercase tracking-[0.16em]">{label}</span>
      <input
        className="search w-full"
        id={id}
        list="route-validator-airports"
        onChange={(event) => onChange(event.target.value)}
        placeholder="KIAH"
        type="search"
        value={value}
      />
      <datalist id="route-validator-airports">
        {airports.map((airport) => (
          <option key={airport} value={airport} />
        ))}
      </datalist>
    </label>
  );
}

export default function RouteValidatorPage({ routeData }) {
  const [controlledAirportInput, setControlledAirportInput] = useState("KIAH");
  const [arrivalFilterInput, setArrivalFilterInput] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [showDeparted, setShowDeparted] = useState(false);
  const [showPrefiles, setShowPrefiles] = useState(true);
  const [callsignSortDir, setCallsignSortDir] = useState("asc");
  const [statusSortDir, setStatusSortDir] = useState("asc");
  const [pilots, setPilots] = useState([]);
  const [fetchError, setFetchError] = useState("");
  const [atisError, setAtisError] = useState("");
  const [trafficLastUpdated, setTrafficLastUpdated] = useState(() => Date.now());
  const [atisLastUpdated, setAtisLastUpdated] = useState(0);
  const [nextTrafficRefreshAt, setNextTrafficRefreshAt] = useState(() => Date.now() + TRAFFIC_REFRESH_MS);
  const [nextAtisRefreshAt, setNextAtisRefreshAt] = useState(() => Date.now() + ATIS_REFRESH_MS);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [flowsByAirport, setFlowsByAirport] = useState({
    KIAH: { flow: "Unknown", code: "" },
    KHOU: { flow: "Unknown", code: "" },
    KDFW: { flow: "Unknown", code: "" },
    KDAL: { flow: "Unknown", code: "" },
    KATL: { flow: "Unknown", code: "" },
  });
  const [copiedRouteKey, setCopiedRouteKey] = useState("");

  const controlledAirport = normalizeAirport(controlledAirportInput);
  const arrivalFilter = normalizeAirport(arrivalFilterInput);
  const search = searchInput.trim().toUpperCase();
  const nextTrafficRefreshLabel = formatRefreshCountdown(nextTrafficRefreshAt, nowMs);
  const nextAtisRefreshLabel = formatRefreshCountdown(nextAtisRefreshAt, nowMs);
  const trafficTone = getFeedStatusTone({
    mode: "live",
    hasError: Boolean(fetchError),
    lastUpdatedMs: trafficLastUpdated,
    nowMs,
  });
  const atisTone = getFeedStatusTone({
    mode: "live",
    hasError: Boolean(atisError),
    lastUpdatedMs: atisLastUpdated,
    nowMs,
  });

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;

    const fetchTrafficData = async () => {
      try {
        const response = await fetch(VATSIM_DATA_URL, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Traffic feed failed (${response.status})`);
        }

        const data = await response.json();
        if (!active) {
          return;
        }

        const connectedPilots = (data?.pilots || [])
          .filter((pilot) => pilot?.flight_plan?.departure)
          .map((pilot) => ({
            ...pilot,
            __isPrefile: false,
          }));

        const prefilePilots = (data?.prefiles || [])
          .filter((prefile) => prefile?.flight_plan?.departure)
          .map((prefile) => ({
            ...prefile,
            altitude: 0,
            groundspeed: 0,
            __isPrefile: true,
          }));

        const connectedKeys = new Set(
          connectedPilots.map((pilot) => {
            const flightPlan = pilot.flight_plan || {};
            return `${(pilot.callsign || "").toUpperCase()}|${normalizeAirport(
              flightPlan.departure,
            )}|${normalizeAirport(flightPlan.arrival)}`;
          }),
        );

        const uniquePrefiles = prefilePilots.filter((prefile) => {
          const flightPlan = prefile.flight_plan || {};
          const key = `${(prefile.callsign || "").toUpperCase()}|${normalizeAirport(
            flightPlan.departure,
          )}|${normalizeAirport(flightPlan.arrival)}`;
          return !connectedKeys.has(key);
        });

        setPilots([...connectedPilots, ...uniquePrefiles]);
        setFetchError("");
        setTrafficLastUpdated(Date.now());
      } catch (error) {
        if (!active) {
          return;
        }
        setFetchError(error?.message || "Failed to load VATSIM traffic feed.");
        setPilots(buildStaticPilotList());
        setTrafficLastUpdated(Date.now());
      } finally {
        if (active) {
          setNextTrafficRefreshAt(Date.now() + TRAFFIC_REFRESH_MS);
        }
      }
    };

    fetchTrafficData();
    const timer = setInterval(fetchTrafficData, TRAFFIC_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const fetchAtisFeeds = async () => {
      try {
        const entries = await Promise.all(
          Object.entries(ATIS_URLS).map(async ([airport, url]) => {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) {
              throw new Error(`${airport} ATIS fetch failed (${response.status})`);
            }

            const data = await response.json();
            const first = Array.isArray(data) ? data[0] : null;
            const datis = first?.datis || "";
            return [
              airport,
              {
                flow: detectFlowFromAtis(airport, datis),
                code: first?.code || "",
              },
            ];
          }),
        );

        if (!active) {
          return;
        }

        setFlowsByAirport(Object.fromEntries(entries));
        setAtisError("");
        setAtisLastUpdated(Date.now());
        setNextAtisRefreshAt(Date.now() + ATIS_REFRESH_MS);
      } catch (error) {
        if (!active) {
          return;
        }
        setAtisError(error?.message || "Failed to load one or more D-ATIS feeds.");
        setNextAtisRefreshAt(Date.now() + ATIS_REFRESH_MS);
      }
    };

    fetchAtisFeeds();
    const timer = setInterval(fetchAtisFeeds, ATIS_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const routeMap = useMemo(() => {
    const map = new Map();

    for (const route of routeData.routes || []) {
      const key = `${route.departure}-${route.arrival}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(route);
    }

    return map;
  }, [routeData.routes]);

  const validations = useMemo(() => {
    if (!controlledAirport) {
      return [];
    }

    const filteredPilots = pilots.filter((pilot) => {
      const flightPlan = pilot.flight_plan;
      const departure = normalizeAirport(flightPlan?.departure);
      const arrival = normalizeAirport(flightPlan?.arrival);
      const route = flightPlan?.route || "";
      const callsign = (pilot?.callsign || "").toUpperCase();
      const isPrefile = Boolean(pilot?.__isPrefile);

      if (departure !== controlledAirport) {
        return false;
      }

      if (isPrefile && !showPrefiles) {
        return false;
      }

      if (arrivalFilter && arrival !== arrivalFilter) {
        return false;
      }

      if (!search) {
        return showDeparted ? true : !isLikelyDeparted(pilot);
      }

      const combined = `${callsign} ${arrival} ${route}`.toUpperCase();
      if (!combined.includes(search)) {
        return false;
      }

      return showDeparted ? true : !isLikelyDeparted(pilot);
    });

    const rows = filteredPilots.map((pilot) => {
      const flightPlan = pilot.flight_plan;
      const departure = normalizeAirport(flightPlan.departure);
      const arrival = normalizeAirport(flightPlan.arrival);
      const filedRoute = flightPlan.route || "";
      const filedTokens = tokenizeFiledRoute(filedRoute);
      const rules = routeMap.get(`${departure}-${arrival}`) || [];

      let bestRule = null;
      let bestVariant = null;
      let bestRatio = 0;
      let bestRevisionRatio = 0;
      let hasExact = false;
      let hasRevisionMatch = false;
      let bestRevisionRule = null;
      let bestRevisionVariant = null;
      let bestFlowConflict = false;
      let opposingFlowMatched = false;
      let opposingFlowDepartureToken = false;

      for (const rule of rules) {
        const variants = rule.variants || [];

        const preferredVariants = variants.filter((variant) =>
          isVariantFlowCompatible(variant.label, flowsByAirport),
        );

        const variantsToEvaluate = preferredVariants.length > 0 ? preferredVariants : variants;

        for (const variant of variantsToEvaluate) {
          const exactResult = matchPreferredRoute(filedTokens, variant.route, false);
          const revisionResult = matchPreferredRoute(filedTokens, variant.route, true);
          const flowConflict = variantHasFlowConflict(variant.label, flowsByAirport);
          const hasFlowTag = extractFlowTagsFromVariantLabel(variant.label).length > 0;
          const flowBonus = flowConflict ? -0.2 : hasFlowTag ? 0.05 : 0;
          const scoredExact = Math.max(0, Math.min(1, exactResult.ratio + flowBonus));
          const scoredRevision = Math.max(0, Math.min(1, revisionResult.ratio + flowBonus));

          if (scoredExact > bestRatio) {
            bestRatio = scoredExact;
            bestRule = rule;
            bestVariant = variant;
            bestFlowConflict = flowConflict;
          }

          if (scoredRevision > bestRevisionRatio) {
            bestRevisionRatio = scoredRevision;
            bestRevisionRule = rule;
            bestRevisionVariant = variant;
          }

          if (exactResult.matched) {
            hasExact = true;
            bestRule = rule;
            bestVariant = variant;
            bestRatio = 1;
            bestFlowConflict = flowConflict;
            break;
          }

          if (!exactResult.matched && revisionResult.matched) {
            hasRevisionMatch = true;
          }
        }

        // Track cases where filed route matches a known opposite-flow variant.
        if (Object.values(flowsByAirport).some((item) => item.flow !== "Unknown")) {
          const filedFirstToken = (filedTokens[0] || "").replace(/#/g, "");
          const sameFlowFirstTokens = new Set();
          const oppositeFlowFirstTokens = new Set();

          for (const variant of variants) {
            const flowTags = extractFlowTagsFromVariantLabel(variant.label);
            const firstOptions = getFirstRouteTokenOptions(variant.route);

            if (flowTags.length === 0) {
              for (const token of firstOptions) {
                sameFlowFirstTokens.add(token);
              }
              continue;
            }

            if (isVariantFlowCompatible(variant.label, flowsByAirport)) {
              for (const token of firstOptions) {
                sameFlowFirstTokens.add(token);
              }
            } else {
              for (const token of firstOptions) {
                oppositeFlowFirstTokens.add(token);
              }
            }
          }

          if (
            filedFirstToken &&
            oppositeFlowFirstTokens.has(filedFirstToken) &&
            !sameFlowFirstTokens.has(filedFirstToken)
          ) {
            opposingFlowDepartureToken = true;
          }

          for (const variant of variants) {
            if (isVariantFlowCompatible(variant.label, flowsByAirport)) {
              continue;
            }

            const exactResult = matchPreferredRoute(filedTokens, variant.route, false);
            const revisionResult = matchPreferredRoute(filedTokens, variant.route, true);
            if (exactResult.matched || revisionResult.matched) {
              opposingFlowMatched = true;
              break;
            }
          }
        }

        if (hasExact) {
          break;
        }
      }

      if (!hasExact && hasRevisionMatch && bestRevisionVariant) {
        bestRule = bestRevisionRule;
        bestVariant = bestRevisionVariant;
        bestFlowConflict = variantHasFlowConflict(bestVariant.label, flowsByAirport);
      }

      // Keep a suggested preferred route visible even when token overlap is zero.
      if (!bestVariant && rules.length > 0) {
        bestRule = rules[0];
        bestVariant =
          (bestRule.variants || []).find((variant) =>
            isVariantFlowCompatible(variant.label, flowsByAirport),
          ) ||
          (bestRule.variants || [])[0] ||
          null;
      }

      const filedAltitudeFeet = parseFiledAltitudeFeet(flightPlan.altitude);
      const altitudeConstraint = bestVariant ? parseAltitudeConstraint(bestVariant) : null;
      const altitudeCheck = evaluateAltitudeConstraint(filedAltitudeFeet, altitudeConstraint);
      const noRuleFlowCheck = getKiahSidFlowMismatchInfo(
        departure,
        filedTokens,
        flowsByAirport.KIAH?.flow || "Unknown",
      );

      const status = classifyMatch(
        hasExact,
        hasRevisionMatch,
        rules.length > 0,
        opposingFlowMatched || bestFlowConflict || opposingFlowDepartureToken,
        altitudeCheck.violated,
        noRuleFlowCheck.mismatch,
      );
      const aircraftInfo = getAircraftTypeAndSuffix(flightPlan);

      return {
        cid: pilot.cid,
        callsign: pilot.callsign,
        isPrefile: Boolean(pilot?.__isPrefile),
        departure,
        arrival,
        altitude: flightPlan.altitude,
        aircraft: aircraftInfo.type,
        equipmentSuffix: aircraftInfo.suffix,
        rules,
        filedRoute,
        status,
        bestRule,
        bestVariant,
        flowConflict: bestFlowConflict,
        altitudeConflict: altitudeCheck.violated,
        altitudeConflictReason: altitudeCheck.reason,
        noRuleFlowConflict: noRuleFlowCheck.mismatch,
        noRuleFlowConflictReason: noRuleFlowCheck.reason,
      };
    });

    rows.sort((a, b) => {
      if (statusSortDir !== "off") {
        const aRank = STATUS_SORT_ORDER[a.status?.label] ?? 99;
        const bRank = STATUS_SORT_ORDER[b.status?.label] ?? 99;
        const statusOrder = aRank - bRank;
        if (statusOrder !== 0) {
          return statusSortDir === "asc" ? statusOrder : -statusOrder;
        }
      }

      const order = a.callsign.localeCompare(b.callsign, undefined, { sensitivity: "base" });
      return callsignSortDir === "asc" ? order : -order;
    });

    return rows;
  }, [
    arrivalFilter,
    callsignSortDir,
    controlledAirport,
    flowsByAirport,
    pilots,
    routeMap,
    search,
    statusSortDir,
    showDeparted,
    showPrefiles,
  ]);

  const copyRoute = async (key, route) => {
    if (!route || !navigator?.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(route);
      setCopiedRouteKey(key);
      setTimeout(() => setCopiedRouteKey(""), 1500);
    } catch {
      setCopiedRouteKey("");
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-8 pb-28 md:px-10">
      <div className="route-validator-bg" />
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="panel">
            <div className="flex items-start justify-between gap-3">
              <p className="text-accent text-sm font-semibold uppercase tracking-[0.24em]">Traffic</p>
              <Link className="button-secondary text-sm" href="/">
                Back to Toolkit
              </Link>
            </div>
            <h1 className="font-heading text-main mt-1 text-4xl font-bold tracking-wide md:text-5xl">
              Route Validator
            </h1>
            <p className="text-muted mt-2 max-w-4xl">
              Checks VATSIM filed routes for departures at your field against ZHU preferred routes from
              the alias ROUTING section.
            </p>

            <div className="mt-5 flex flex-wrap items-end gap-3">
              <AirportInput
                airports={routeData.airports || []}
                compact
                id="controlled-airport"
                label="Controlled Field"
                onChange={setControlledAirportInput}
                value={controlledAirportInput}
              />
              <AirportInput
                airports={routeData.airports || []}
                compact
                id="arrival-filter"
                label="Arrival Filter"
                onChange={setArrivalFilterInput}
                value={arrivalFilterInput}
              />
              <label className="min-w-[16rem] flex-1 space-y-1" htmlFor="route-search">
                <span className="text-muted text-xs uppercase tracking-[0.16em]">Search</span>
                <input
                  className="search w-full"
                  id="route-search"
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Callsign, route token, or airport"
                  type="search"
                  value={searchInput}
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <label className="toggle-chip border-default bg-surface-soft text-muted inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
                <input
                  className="sr-only peer"
                  checked={showDeparted}
                  onChange={(event) => setShowDeparted(event.target.checked)}
                  type="checkbox"
                />
                <span className="toggle-chip-dot" aria-hidden="true" />
                <span>Show already departed aircraft</span>
              </label>
              <label className="toggle-chip border-default bg-surface-soft text-muted inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
                <input
                  className="sr-only peer"
                  checked={showPrefiles}
                  onChange={(event) => setShowPrefiles(event.target.checked)}
                  type="checkbox"
                />
                <span className="toggle-chip-dot" aria-hidden="true" />
                <span>Show prefiles</span>
              </label>
            </div>

            <div className="mt-4">
              <p className="text-muted text-xs uppercase tracking-[0.16em]">Arrival Flows (D-ATIS)</p>
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {Object.entries(flowsByAirport).map(([airport, info]) => (
                  <a
                    className="border-default bg-surface-soft rounded-lg border px-2 py-1.5 text-center transition hover:bg-[color-mix(in_srgb,var(--surface-soft)_72%,white)]"
                    href={`https://atis.info/${airport}`}
                    key={airport}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <div className="text-muted text-[12px] font-semibold uppercase tracking-[0.14em]">
                      {airport}
                    </div>
                    <div
                      className={
                        info.flow === "Unknown"
                          ? "mt-0.5 text-base font-bold text-amber-600"
                          : "text-main mt-0.5 text-base font-bold"
                      }
                    >
                      {info.flow}
                    </div>
                    <div className="text-muted mt-0.5 text-[12px] font-semibold uppercase tracking-[0.14em]">
                      {info.code || "--"}
                    </div>
                  </a>
                ))}
              </div>
            </div>
        </header>

        <section className="panel">
          <div className="overflow-x-auto">
            <table className="route-validator-table min-w-full text-sm">
              <thead className="bg-surface-soft">
                <tr>
                  <th aria-sort={callsignSortDir === "asc" ? "ascending" : "descending"}>
                    <button
                      className="inline-flex items-center gap-1"
                      onClick={() =>
                        setCallsignSortDir((current) => (current === "asc" ? "desc" : "asc"))
                      }
                      type="button"
                    >
                      CALLSIGN
                      <span aria-hidden="true" className="text-[10px]">
                        {callsignSortDir === "asc" ? "↑" : "↓"}
                      </span>
                    </button>
                  </th>
                  <th>DEP</th>
                  <th>ARR</th>
                  <th>Filed Alt</th>
                  <th
                    aria-sort={
                      statusSortDir === "asc"
                        ? "ascending"
                        : statusSortDir === "desc"
                          ? "descending"
                          : "none"
                    }
                  >
                    <button
                      className="inline-flex items-center gap-1"
                      onClick={() =>
                        setStatusSortDir((current) => {
                          if (current === "off") return "asc";
                          if (current === "asc") return "desc";
                          return "off";
                        })
                      }
                      type="button"
                    >
                      STATUS
                      <span aria-hidden="true" className="text-[10px]">
                        {statusSortDir === "off" ? "↕" : statusSortDir === "asc" ? "↑" : "↓"}
                      </span>
                    </button>
                  </th>
                  <th>Filed Route</th>
                  <th>Preferred Route</th>
                  <th aria-label="Actions">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {validations.length === 0 ? (
                  <tr>
                    <td className="text-muted" colSpan={8}>
                      No departures match the current filters.
                    </td>
                  </tr>
                ) : (
                  validations.map((row) => (
                    <tr key={`${row.callsign}-${row.cid}`}>
                      <td>
                        <div className="font-mono font-semibold">
                          {row.callsign}
                          {row.isPrefile ? (
                            <span className="border-default bg-surface-soft text-muted ml-2 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                              PREFILE
                            </span>
                          ) : null}
                        </div>
                        <div className="text-muted text-xs">
                          {row.equipmentSuffix
                            ? `${row.aircraft || "Unknown"}/${row.equipmentSuffix}`
                            : row.aircraft || "Unknown"}
                        </div>
                      </td>
                      <td>{row.departure}</td>
                      <td>{row.arrival}</td>
                      <td className="font-mono">{formatFiledAltitudeDisplay(row.altitude)}</td>
                      <td>
                        <span className={`rv-chip rv-chip-${row.status.tone}`}>{row.status.label}</span>
                      </td>
                      <td className="font-mono">{row.filedRoute || "(empty)"}</td>
                      <td className="rv-col-preferred">
                        {row.bestVariant ? (
                          <div>
                            <div className="font-mono text-sm">{row.bestVariant.route}</div>
                            <div className="text-muted text-xs font-normal">
                              {(row.bestRule?.alias || "").toUpperCase()}
                              {row.bestVariant?.label ? `: ${row.bestVariant.label}` : ""}
                            </div>
                            {row.flowConflict ? (
                              <div className="text-amber-600 text-[11px]">
                                Flow warning: preferred variant does not match current destination flow.
                              </div>
                            ) : null}
                            {row.altitudeConflict ? (
                              <div className="text-rose-600 text-[11px]">
                                Altitude warning: {row.altitudeConflictReason}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div>
                            <span className="text-muted text-xs">No preferred route found for pair</span>
                            {row.noRuleFlowConflict ? (
                              <div className="text-rose-600 mt-1 text-[11px]">
                                Flow warning: {row.noRuleFlowConflictReason}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="rv-col-actions text-right">
                        {row.status.label === "CHECK ROUTE" ||
                        row.status.label === "FLOW" ||
                        row.status.label === "REVISION" ? (
                          <button
                            className="button-secondary px-2 py-1 text-[10px] uppercase tracking-[0.12em]"
                            onClick={() =>
                              copyRoute(`${row.callsign}-${row.cid}`, row.bestVariant?.route || "")
                            }
                            type="button"
                          >
                            {copiedRouteKey === `${row.callsign}-${row.cid}` ? "COPIED" : "COPY ROUTE"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="fixed bottom-3 left-1/2 z-40 flex w-[min(96vw,64rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 px-1">
          <div className="border-default bg-surface-soft text-muted flex min-w-[21rem] items-center justify-center gap-2 rounded-lg border px-3 py-1 text-[11px]">
            <span className={`feed-indicator feed-indicator-${trafficTone}`} aria-hidden="true" />
            <span className="uppercase tracking-[0.12em]">Traffic</span>
            <span className="text-main font-semibold">{fetchError ? "Error" : "Live"}</span>
            <span>{trafficLastUpdated ? new Date(trafficLastUpdated).toLocaleTimeString() : "Waiting..."}</span>
            <span>Next {nextTrafficRefreshLabel}</span>
            {fetchError ? <span className="text-rose-600">{fetchError}</span> : null}
          </div>

          <div className="border-default bg-surface-soft text-muted flex min-w-[21rem] items-center justify-center gap-2 rounded-lg border px-3 py-1 text-[11px]">
            <span className={`feed-indicator feed-indicator-${atisTone}`} aria-hidden="true" />
            <span className="uppercase tracking-[0.12em]">D-ATIS</span>
            <span className="text-main font-semibold">{atisError ? "Error" : "Live"}</span>
            <span>{atisLastUpdated ? new Date(atisLastUpdated).toLocaleTimeString() : "Waiting..."}</span>
            <span>Next {nextAtisRefreshLabel}</span>
            {atisError ? <span className="text-amber-600">{atisError}</span> : null}
          </div>
        </aside>
      </div>
    </main>
  );
}


