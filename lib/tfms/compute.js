import internalAirportList from "../../data/tfms-internal-airports.json";

const GROUNDSPEED_MIN_KTS = 20;
const TRACON_ALTITUDE_FT = 10_000;
const NEAR_PERIMETER_DISTANCE_NM = 50;
const PROJECT_TO_PERIMETER_NM = 25;
const INBOUND_HEADING_TOLERANCE_DEG = 45;
const ENHANCED_MODEL_MARGIN_NM = 80;
const MOTION_MIN_DT_SEC = 5;
const MOTION_MAX_DT_SEC = 5 * 60;
const TURN_RATE_MAX_DEG_PER_SEC = 3;
const GS_RATE_MAX_KTS_PER_SEC = 1.5;
const VS_RATE_MAX_FPM = 6000;
const DEFAULT_CLIMB_FPM = 1200;
const DEFAULT_DESCENT_FPM = 1500;
const PROJECTION_STEP_SEC = 30;
const INTERNAL_ZHU_AIRPORTS = new Set(
  (internalAirportList || [])
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean),
);

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function haversineNM(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusNm = 3440.065;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return earthRadiusNm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function toLocalNm(lat, lon, refLat) {
  const latNm = lat * 60;
  const lonNm = lon * 60 * Math.cos((refLat * Math.PI) / 180);
  return { x: lonNm, y: latNm };
}

function pointToSegmentDistanceNm(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const segmentLengthSq = dx * dx + dy * dy;
  if (segmentLengthSq <= 1e-9) {
    const distX = point.x - start.x;
    const distY = point.y - start.y;
    return Math.hypot(distX, distY);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / segmentLengthSq),
  );
  const projX = start.x + t * dx;
  const projY = start.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHeading(heading) {
  return ((heading % 360) + 360) % 360;
}

function headingDeltaDeg(fromHeading, toHeading) {
  return ((toHeading - fromHeading + 540) % 360) - 180;
}

function parseTimestampMs(value) {
  if (!value) {
    return NaN;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseFiledAltitudeFt(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) {
      return null;
    }
    return value <= 600 ? value * 100 : value;
  }

  const text = String(value).trim().toUpperCase();
  if (!text) {
    return null;
  }
  const flMatch = text.match(/^FL?\s*(\d{2,3})$/);
  if (flMatch) {
    return Number(flMatch[1]) * 100;
  }
  const digitsMatch = text.match(/(\d{2,5})/);
  if (!digitsMatch) {
    return null;
  }
  const numeric = Number(digitsMatch[1]);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric <= 600 ? numeric * 100 : numeric;
}

function normalizeAirportCode(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) {
    return "";
  }
  if (/^[A-Z]{3}$/.test(text)) {
    return `K${text}`;
  }
  if (/^[A-Z0-9]{3,5}$/.test(text)) {
    return text;
  }
  return "";
}

function isPilotNearZhuBoundingBox(pilot, zhuBbox, marginNm = ENHANCED_MODEL_MARGIN_NM) {
  if (!zhuBbox || !Number.isFinite(pilot?.latitude) || !Number.isFinite(pilot?.longitude)) {
    return true;
  }
  const marginLatDeg = marginNm / 60;
  const cosLat = Math.max(0.2, Math.cos((Number(pilot.latitude) * Math.PI) / 180));
  const marginLonDeg = marginNm / (60 * cosLat);

  return (
    pilot.longitude >= zhuBbox.minLon - marginLonDeg &&
    pilot.longitude <= zhuBbox.maxLon + marginLonDeg &&
    pilot.latitude >= zhuBbox.minLat - marginLatDeg &&
    pilot.latitude <= zhuBbox.maxLat + marginLatDeg
  );
}

function bearingTo(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const toDeg = (value) => (value * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const sourceLat = toRad(lat1);
  const targetLat = toRad(lat2);
  const y = Math.sin(dLon) * Math.cos(targetLat);
  const x =
    Math.cos(sourceLat) * Math.sin(targetLat) -
    Math.sin(sourceLat) * Math.cos(targetLat) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function minDistanceToPolygon(lat, lon, polygon) {
  let minDist = Infinity;
  const referenceLat = lat;
  const pointLocal = toLocalNm(lat, lon, referenceLat);

  for (let i = 0; i < polygon.length; i += 1) {
    const [lon1, lat1] = polygon[i];
    const [lon2, lat2] = polygon[(i + 1) % polygon.length];
    const startLocal = toLocalNm(lat1, lon1, referenceLat);
    const endLocal = toLocalNm(lat2, lon2, referenceLat);
    minDist = Math.min(minDist, pointToSegmentDistanceNm(pointLocal, startLocal, endLocal));
  }

  return minDist;
}

export function projectPosition(lat, lon, heading, groundspeed, minutes) {
  const earthRadiusKm = 6371;
  const distanceKm = groundspeed * 1.852 * (minutes / 60);
  const bearing = (heading * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceKm / earthRadiusKm) +
      Math.cos(lat1) * Math.sin(distanceKm / earthRadiusKm) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distanceKm / earthRadiusKm) * Math.cos(lat1),
      Math.cos(distanceKm / earthRadiusKm) - Math.sin(lat1) * Math.sin(lat2),
    );

  return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI];
}

export function buildSectorIndex(sectors) {
  const features = [];
  const specialtySet = new Set();
  let zhuPerimeter = null;
  let zhuBbox = null;

  for (const feature of sectors.features || []) {
    const properties = feature.properties || {};
    const sector = properties.sector;
    const isZhu = typeof sector === "string" && sector.toLowerCase() === "zhu";
    const polygon = feature.geometry?.coordinates?.[0] || null;
    const bbox = polygon
      ? polygon.reduce(
          (acc, [lon, lat]) => ({
            minLon: Math.min(acc.minLon, lon),
            maxLon: Math.max(acc.maxLon, lon),
            minLat: Math.min(acc.minLat, lat),
            maxLat: Math.max(acc.maxLat, lat),
          }),
          {
            minLon: Infinity,
            maxLon: -Infinity,
            minLat: Infinity,
            maxLat: -Infinity,
          },
        )
      : null;
    const floor =
      properties.floor !== undefined && properties.floor !== null
        ? Number(properties.floor)
        : -99_999;
    const ceiling =
      properties.ceiling !== undefined && properties.ceiling !== null
        ? Number(properties.ceiling)
        : 99_999;

    if (properties.specialty) {
      specialtySet.add(properties.specialty);
    }
    if (isZhu) {
      zhuPerimeter = polygon;
      zhuBbox = bbox;
    }

    features.push({ properties, polygon, bbox, floor, ceiling, isZhu });
  }

  return {
    features,
    zhuPerimeter,
    zhuBbox,
    specialties: [...specialtySet].sort(),
  };
}

export function buildPilotMotionModel(vatsim, previousByCallsign = {}, sectorIndex = null) {
  const pilots = vatsim?.pilots || [];
  const nextByCallsign = {};
  const zhuBbox = sectorIndex?.zhuBbox || null;

  for (const pilot of pilots) {
    const arrival = normalizeAirportCode(pilot?.flight_plan?.arrival);
    const inboundInternal = arrival && INTERNAL_ZHU_AIRPORTS.has(arrival);
    if (!isPilotNearZhuBoundingBox(pilot, zhuBbox) && !inboundInternal) {
      continue;
    }
    const callsign = String(pilot.callsign || "").toUpperCase();
    if (!callsign) {
      continue;
    }

    const timestampMs = parseTimestampMs(pilot.last_updated);
    const latitude = Number(pilot.latitude);
    const longitude = Number(pilot.longitude);
    const heading = normalizeHeading(Number(pilot.heading || 0));
    const groundspeed = Math.max(0, Number(pilot.groundspeed || 0));
    const altitudeFt = coerceAltitude(pilot.altitude);
    const targetAltitudeFt = parseFiledAltitudeFt(pilot?.flight_plan?.altitude);
    const previous = previousByCallsign[callsign];

    let turnRateDegPerSec = 0;
    let gsRateKtsPerSec = 0;
    let verticalRateFpm = 0;

    if (
      previous &&
      Number.isFinite(timestampMs) &&
      Number.isFinite(previous.timestampMs) &&
      Number.isFinite(previous.heading) &&
      Number.isFinite(previous.groundspeed) &&
      Number.isFinite(previous.altitudeFt)
    ) {
      const dtSec = (timestampMs - previous.timestampMs) / 1000;
      if (dtSec >= MOTION_MIN_DT_SEC && dtSec <= MOTION_MAX_DT_SEC) {
        const measuredTurn = clamp(
          headingDeltaDeg(previous.heading, heading) / dtSec,
          -TURN_RATE_MAX_DEG_PER_SEC,
          TURN_RATE_MAX_DEG_PER_SEC,
        );
        const measuredGsRate = clamp(
          (groundspeed - previous.groundspeed) / dtSec,
          -GS_RATE_MAX_KTS_PER_SEC,
          GS_RATE_MAX_KTS_PER_SEC,
        );
        const measuredVerticalFpm = clamp(
          ((altitudeFt - previous.altitudeFt) / dtSec) * 60,
          -VS_RATE_MAX_FPM,
          VS_RATE_MAX_FPM,
        );

        turnRateDegPerSec = Number.isFinite(previous.turnRateDegPerSec)
          ? previous.turnRateDegPerSec * 0.5 + measuredTurn * 0.5
          : measuredTurn;
        gsRateKtsPerSec = Number.isFinite(previous.gsRateKtsPerSec)
          ? previous.gsRateKtsPerSec * 0.5 + measuredGsRate * 0.5
          : measuredGsRate;
        verticalRateFpm = Number.isFinite(previous.verticalRateFpm)
          ? previous.verticalRateFpm * 0.5 + measuredVerticalFpm * 0.5
          : measuredVerticalFpm;
      }
    }

    if (
      Math.abs(verticalRateFpm) < 100 &&
      Number.isFinite(targetAltitudeFt) &&
      Math.abs(targetAltitudeFt - altitudeFt) >= 500
    ) {
      verticalRateFpm = targetAltitudeFt > altitudeFt ? DEFAULT_CLIMB_FPM : -DEFAULT_DESCENT_FPM;
    }

    nextByCallsign[callsign] = {
      callsign,
      timestampMs,
      latitude,
      longitude,
      heading,
      groundspeed,
      altitudeFt,
      targetAltitudeFt,
      turnRateDegPerSec: clamp(turnRateDegPerSec, -TURN_RATE_MAX_DEG_PER_SEC, TURN_RATE_MAX_DEG_PER_SEC),
      gsRateKtsPerSec: clamp(gsRateKtsPerSec, -GS_RATE_MAX_KTS_PER_SEC, GS_RATE_MAX_KTS_PER_SEC),
      verticalRateFpm: clamp(verticalRateFpm, -VS_RATE_MAX_FPM, VS_RATE_MAX_FPM),
    };
  }

  return nextByCallsign;
}

export function classifyPosition(lat, lon, altitude, sectorIndex, excludeZhu = true) {
  for (const feature of sectorIndex.features) {
    if (excludeZhu && feature.isZhu) {
      continue;
    }
    if (!feature.polygon) {
      continue;
    }
    if (
      feature.bbox &&
      (lon < feature.bbox.minLon ||
        lon > feature.bbox.maxLon ||
        lat < feature.bbox.minLat ||
        lat > feature.bbox.maxLat)
    ) {
      continue;
    }
    if (
      pointInPolygon([lon, lat], feature.polygon) &&
      altitude >= feature.floor &&
      altitude < feature.ceiling
    ) {
      return feature.properties;
    }
  }
  return null;
}

export function getZhuEnrouteControllers(vatsim) {
  return (vatsim.controllers || []).filter((controller) =>
    /^HOU_\d{2}\d?_CTR$/i.test(controller.callsign || ""),
  );
}

const TRACON_STATUS_PATTERNS = [
  { id: "I90", pattern: /^I90_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "AUS", pattern: /^AUS_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "SAT", pattern: /^SAT_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "CRP", pattern: /^CRP_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "VLY", pattern: /^VLY_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "LFT", pattern: /^LFT_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "LCH", pattern: /^LCH_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "MSY", pattern: /^MSY_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "NQI", pattern: /^NQI_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "DLF", pattern: /^DLF_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "POE", pattern: /^POE_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "BTR", pattern: /^BTR_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "GPT", pattern: /^GPT_[A-Z0-9]+_(APP|DEP)$/i },
  { id: "MOB", pattern: /^MOB_[A-Z0-9]+_(APP|DEP)$/i },
];

export function buildTraconStaffing(vatsim) {
  const controllers = vatsim?.controllers || [];
  return TRACON_STATUS_PATTERNS.map((tracon) => {
    const matched = controllers.filter((controller) =>
      tracon.pattern.test(controller.callsign || ""),
    );
    return {
      id: tracon.id,
      staffed: matched.length > 0,
      callsigns: matched.map((controller) => controller.callsign),
    };
  });
}

function coerceAltitude(altitude) {
  return Number(altitude || 0);
}

function projectPilotState(pilot, motionState, minutes) {
  let lat = Number(pilot.latitude);
  let lon = Number(pilot.longitude);
  let heading = normalizeHeading(Number(pilot.heading || 0));
  let groundspeed = Math.max(0, Number(pilot.groundspeed || 0));
  let altitudeFt = coerceAltitude(pilot.altitude);
  let turnRateDegPerSec = Number(motionState?.turnRateDegPerSec || 0);
  const gsRateKtsPerSec = Number(motionState?.gsRateKtsPerSec || 0);
  let verticalRateFpm = Number(motionState?.verticalRateFpm || 0);
  const targetAltitudeFt = Number.isFinite(motionState?.targetAltitudeFt)
    ? Number(motionState.targetAltitudeFt)
    : parseFiledAltitudeFt(pilot?.flight_plan?.altitude);

  if (
    Math.abs(verticalRateFpm) < 100 &&
    Number.isFinite(targetAltitudeFt) &&
    Math.abs(targetAltitudeFt - altitudeFt) >= 500
  ) {
    verticalRateFpm = targetAltitudeFt > altitudeFt ? DEFAULT_CLIMB_FPM : -DEFAULT_DESCENT_FPM;
  }

  let remainingSec = Math.max(0, Math.round(minutes * 60));
  while (remainingSec > 0) {
    const stepSec = Math.min(PROJECTION_STEP_SEC, remainingSec);
    const avgHeading = normalizeHeading(heading + turnRateDegPerSec * (stepSec / 2));
    const avgGroundspeed = Math.max(0, groundspeed + gsRateKtsPerSec * (stepSec / 2));
    const [nextLat, nextLon] = projectPosition(lat, lon, avgHeading, avgGroundspeed, stepSec / 60);
    lat = nextLat;
    lon = nextLon;

    heading = normalizeHeading(heading + turnRateDegPerSec * stepSec);
    groundspeed = Math.max(0, groundspeed + gsRateKtsPerSec * stepSec);

    let nextAltitude = altitudeFt + (verticalRateFpm * stepSec) / 60;
    if (Number.isFinite(targetAltitudeFt)) {
      if (verticalRateFpm > 0) {
        nextAltitude = Math.min(nextAltitude, targetAltitudeFt);
      } else if (verticalRateFpm < 0) {
        nextAltitude = Math.max(nextAltitude, targetAltitudeFt);
      }
      if (nextAltitude === targetAltitudeFt) {
        verticalRateFpm = 0;
      }
    }
    altitudeFt = nextAltitude;
    remainingSec -= stepSec;
  }

  return { latitude: lat, longitude: lon, altitudeFt };
}

function isNearPerimeterInboundPilot(pilot, sectorIndex, altitude) {
  if (!sectorIndex.zhuPerimeter) {
    return null;
  }

  const dist = minDistanceToPolygon(pilot.latitude, pilot.longitude, sectorIndex.zhuPerimeter);
  if (dist > NEAR_PERIMETER_DISTANCE_NM) {
    return null;
  }

  let closest = null;
  let minDist = Infinity;
  for (const [lon, lat] of sectorIndex.zhuPerimeter) {
    const pointDist = haversineNM(pilot.latitude, pilot.longitude, lat, lon);
    if (pointDist < minDist) {
      minDist = pointDist;
      closest = { lat, lon };
    }
  }

  if (!closest || !Number.isFinite(pilot.heading)) {
    return null;
  }

  const inboundBearing = bearingTo(pilot.latitude, pilot.longitude, closest.lat, closest.lon);
  const headingDiff = Math.abs(((pilot.heading - inboundBearing + 540) % 360) - 180);
  if (headingDiff > INBOUND_HEADING_TOLERANCE_DEG) {
    return null;
  }

  let projectedSector = null;
  if (Number.isFinite(pilot.groundspeed) && pilot.groundspeed > 0) {
    const minsToBoundary = (PROJECT_TO_PERIMETER_NM / pilot.groundspeed) * 60;
    const [projectedLat, projectedLon] = projectPosition(
      pilot.latitude,
      pilot.longitude,
      pilot.heading,
      pilot.groundspeed,
      minsToBoundary,
    );
    projectedSector = classifyPosition(projectedLat, projectedLon, altitude, sectorIndex, true);
  }

  return {
    ...pilot,
    sector: projectedSector?.sector || "",
    specialty: projectedSector?.specialty || "",
  };
}

function classifyPilotForZhuTraffic(pilot, sectorIndex) {
  if (!Number.isFinite(pilot.latitude) || !Number.isFinite(pilot.longitude)) {
    return null;
  }

  const altitude = coerceAltitude(pilot.altitude);
  const inSector = classifyPosition(pilot.latitude, pilot.longitude, altitude, sectorIndex, true);
  if (inSector) {
    return {
      ...pilot,
      sector: inSector.sector,
      specialty: inSector.specialty,
    };
  }

  return isNearPerimeterInboundPilot(pilot, sectorIndex, altitude);
}

export function computeProjectedFlights(vatsim, sectorIndex, motionByCallsign = null) {
  const flights = (vatsim.pilots || [])
    .map((pilot) => classifyPilotForZhuTraffic(pilot, sectorIndex))
    .filter(Boolean)
    .filter((flight) => Number(flight.groundspeed || 0) >= GROUNDSPEED_MIN_KTS);

  return flights.map((flight) => {
    const altitude = coerceAltitude(flight.altitude);
    const callsign = String(flight.callsign || "").toUpperCase();
    const motionState = callsign && motionByCallsign ? motionByCallsign[callsign] : null;

    const p5 = projectPilotState(flight, motionState, 5);
    const p10 = projectPilotState(flight, motionState, 10);
    const p20 = projectPilotState(flight, motionState, 20);

    const s5 = classifyPosition(p5.latitude, p5.longitude, p5.altitudeFt, sectorIndex, false);
    const s10 = classifyPosition(p10.latitude, p10.longitude, p10.altitudeFt, sectorIndex, false);
    const s20 = classifyPosition(p20.latitude, p20.longitude, p20.altitudeFt, sectorIndex, false);

    return {
      altitude,
      proj5Altitude: p5.altitudeFt,
      proj10Altitude: p10.altitudeFt,
      proj20Altitude: p20.altitudeFt,
      sector: flight.sector || null,
      specialty: flight.specialty || null,
      proj5Specialty: s5?.specialty || null,
      proj10Specialty: s10?.specialty || null,
      proj20Specialty: s20?.specialty || null,
      proj5Sector: s5?.sector || null,
      proj10Sector: s10?.sector || null,
      proj20Sector: s20?.sector || null,
    };
  });
}

export function buildSpecialtySummary(projections, specialties) {
  const now = Object.fromEntries((specialties || []).map((name) => [name, 0]));
  const p5 = Object.fromEntries((specialties || []).map((name) => [name, 0]));
  const p10 = Object.fromEntries((specialties || []).map((name) => [name, 0]));
  const p20 = Object.fromEntries((specialties || []).map((name) => [name, 0]));

  for (const flight of projections || []) {
    const nowAlt = coerceAltitude(flight.altitude);
    const p5Alt = coerceAltitude(
      flight.proj5Altitude !== undefined ? flight.proj5Altitude : flight.altitude,
    );
    const p10Alt = coerceAltitude(
      flight.proj10Altitude !== undefined ? flight.proj10Altitude : flight.altitude,
    );
    const p20Alt = coerceAltitude(
      flight.proj20Altitude !== undefined ? flight.proj20Altitude : flight.altitude,
    );

    if (nowAlt >= TRACON_ALTITUDE_FT && flight.specialty) {
      now[flight.specialty] = (now[flight.specialty] || 0) + 1;
    }
    if (p5Alt >= TRACON_ALTITUDE_FT && flight.proj5Specialty) {
      p5[flight.proj5Specialty] = (p5[flight.proj5Specialty] || 0) + 1;
    }
    if (p10Alt >= TRACON_ALTITUDE_FT && flight.proj10Specialty) {
      p10[flight.proj10Specialty] = (p10[flight.proj10Specialty] || 0) + 1;
    }
    if (p20Alt >= TRACON_ALTITUDE_FT && flight.proj20Specialty) {
      p20[flight.proj20Specialty] = (p20[flight.proj20Specialty] || 0) + 1;
    }
  }

  return (specialties || []).map((specialty) => ({
    specialty,
    now: now[specialty] || 0,
    p5: p5[specialty] || 0,
    p10: p10[specialty] || 0,
    p20: p20[specialty] || 0,
  }));
}

export function buildSplitIndex(customSplits) {
  const splitNames = Object.keys(customSplits || {});
  if (splitNames.length === 0) {
    return [];
  }

  return splitNames.map((name) => ({
    name,
    sectors: new Set(customSplits[name] || []),
  }));
}

export function buildSplitSummaryFromIndex(projections, splitIndex) {
  if (!Array.isArray(splitIndex) || splitIndex.length === 0) {
    return [];
  }

  return splitIndex.map((split) => {
    let now = 0;
    let p5 = 0;
    let p10 = 0;
    let p20 = 0;
    const sectors = split.sectors;

    for (const flight of projections || []) {
      const nowAlt = coerceAltitude(flight.altitude);
      const p5Alt = coerceAltitude(
        flight.proj5Altitude !== undefined ? flight.proj5Altitude : flight.altitude,
      );
      const p10Alt = coerceAltitude(
        flight.proj10Altitude !== undefined ? flight.proj10Altitude : flight.altitude,
      );
      const p20Alt = coerceAltitude(
        flight.proj20Altitude !== undefined ? flight.proj20Altitude : flight.altitude,
      );

      if (nowAlt >= TRACON_ALTITUDE_FT && flight.sector && sectors.has(flight.sector)) now += 1;
      if (p5Alt >= TRACON_ALTITUDE_FT && flight.proj5Sector && sectors.has(flight.proj5Sector)) p5 += 1;
      if (p10Alt >= TRACON_ALTITUDE_FT && flight.proj10Sector && sectors.has(flight.proj10Sector)) p10 += 1;
      if (p20Alt >= TRACON_ALTITUDE_FT && flight.proj20Sector && sectors.has(flight.proj20Sector)) p20 += 1;
    }

    return { name: split.name, now, p5, p10, p20 };
  });
}

export function buildSplitSummary(projections, customSplits) {
  return buildSplitSummaryFromIndex(projections, buildSplitIndex(customSplits));
}

export function formatAlt(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const rounded = Math.round(value / 500) * 500;
  return rounded.toLocaleString();
}
