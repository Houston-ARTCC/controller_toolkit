import traconVolumeData from "@/data/tfms-tracon-volumes.json";

const I90_TRACON_CODES = new Set(["I1D", "I1J", "I1U", "I1Z", "I90"]);
const TRACON_DISPLAY_ORDER = [
  "I90",
  "AUS",
  "SAT",
  "MSY",
  "BTR",
  "CRP",
  "DLF",
  "GPT",
  "LCH",
  "LFT",
  "MOB",
  "NQI",
  "POE",
  "VLY",
];

function normalizeTraconId(value) {
  const id = String(value || "").trim().toUpperCase();
  if (!id) {
    return "";
  }
  return I90_TRACON_CODES.has(id) ? "I90" : id;
}

function parseDms(value, degreeDigits) {
  const text = String(value || "").trim();
  if (!text) {
    return NaN;
  }
  const sign = text.startsWith("-") ? -1 : 1;
  const digits = text.replace(/^[+-]/, "");
  if (!/^\d+$/.test(digits) || digits.length < degreeDigits + 4) {
    return NaN;
  }
  const deg = Number(digits.slice(0, degreeDigits));
  const min = Number(digits.slice(degreeDigits, degreeDigits + 2));
  const sec = Number(digits.slice(degreeDigits + 2, degreeDigits + 4));
  if (![deg, min, sec].every(Number.isFinite)) {
    return NaN;
  }
  return sign * (deg + min / 60 + sec / 3600);
}

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

function parseSectorPoints(points) {
  const parsed = (Array.isArray(points) ? points : [])
    .map((pair) => {
      const lat = parseDms(pair?.[0], 2);
      const lon = parseDms(pair?.[1], 3);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
      }
      return [lat, lon];
    })
    .filter(Boolean);
  return parsed.length >= 3 ? parsed : null;
}

function toAltitudeFeet(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric * 100;
}

function traconSort(a, b) {
  const aIndex = TRACON_DISPLAY_ORDER.indexOf(a);
  const bIndex = TRACON_DISPLAY_ORDER.indexOf(b);
  const aPinned = aIndex !== -1;
  const bPinned = bIndex !== -1;
  if (aPinned && bPinned) {
    return aIndex - bIndex;
  }
  if (aPinned) {
    return -1;
  }
  if (bPinned) {
    return 1;
  }
  return a.localeCompare(b);
}

export function buildTraconVolumeIndex(raw = traconVolumeData) {
  const byId = {};
  const entries = raw?.airspace && typeof raw.airspace === "object" ? raw.airspace : {};

  for (const [rawId, volume] of Object.entries(entries)) {
    const traconId = normalizeTraconId(rawId);
    if (!traconId) {
      continue;
    }
    const sectors = Array.isArray(volume?.sectors) ? volume.sectors : [];
    for (const sector of sectors) {
      const points = parseSectorPoints(sector?.points);
      if (!points) {
        continue;
      }
      if (!byId[traconId]) {
        byId[traconId] = [];
      }
      byId[traconId].push({
        points,
        minFt: toAltitudeFeet(sector?.min, 0),
        maxFt: toAltitudeFeet(sector?.max, Infinity),
      });
    }
  }

  return {
    byId,
    ids: Object.keys(byId).sort(traconSort),
  };
}

export function isInTraconVolume(lat, lon, volumes, altitudeFt = null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Array.isArray(volumes)) {
    return false;
  }
  const point = [lon, lat];
  const normalizedAltitude = Number(altitudeFt);
  return volumes.some((volume) => {
    const polygon = Array.isArray(volume)
      ? volume
      : Array.isArray(volume?.points)
        ? volume.points
        : null;
    if (!polygon || polygon.length < 3) {
      return false;
    }
    if (Number.isFinite(normalizedAltitude) && volume && !Array.isArray(volume)) {
      const minFt = Number.isFinite(Number(volume.minFt)) ? Number(volume.minFt) : 0;
      const maxFt = Number.isFinite(Number(volume.maxFt)) ? Number(volume.maxFt) : Infinity;
      if (normalizedAltitude < minFt || normalizedAltitude >= maxFt) {
        return false;
      }
    }
    const lonLatPolygon = polygon.map((pair) => [pair[1], pair[0]]);
    return pointInPolygon(point, lonLatPolygon);
  });
}

export function flightMatchesTraconVolume(flight, volumes) {
  if (!flight || !Array.isArray(volumes) || volumes.length === 0) {
    return false;
  }
  const samples = [
    [Number(flight.latitude), Number(flight.longitude), Number(flight.altitude)],
    [Number(flight.proj10Latitude), Number(flight.proj10Longitude), Number(flight.proj10Altitude)],
    [Number(flight.proj20Latitude), Number(flight.proj20Longitude), Number(flight.proj20Altitude)],
    [Number(flight.proj30Latitude), Number(flight.proj30Longitude), Number(flight.proj30Altitude)],
  ];
  return samples.some(([lat, lon, altitude]) => isInTraconVolume(lat, lon, volumes, altitude));
}
