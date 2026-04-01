"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ThemeSwitcher from "@/components/theme-switcher";
import sectorsGeoJson from "@/data/tfms-sectors.json";
import airportQueueBoxes from "@/data/tfms-airport-queue-boxes.json";
import eventSplitsData from "@/data/tfms-event-splits.json";
import traconAirportsData from "@/data/tfms-tracon-airports.json";
import {
  buildPilotMotionModel,
  buildSplitSummary,
  buildTraconStaffing,
  buildSectorIndex,
  buildSpecialtySummary,
  computeProjectedFlights,
  getZhuEnrouteControllers,
  normalizeAirportCode,
  passesOperationalGate,
  pointInPolygon,
} from "@/lib/tfms/compute";
import { getSpecialtyColors } from "@/lib/tfms/specialty-colors";
import MapErrorBoundary from "@/components/map-error-boundary";
import { buildTraconVolumeIndex, isInTraconVolume } from "@/lib/tfms/tracon-volumes";

const TfmsProjectionMap = dynamic(() => import("@/components/tfms-projection-map"), {
  ssr: false,
});

const VATSIM_API = "https://data.vatsim.net/v3/vatsim-data.json";
const REFRESH_MS = 60_000;
const TFMS_SNAPSHOT_STORAGE_KEY = "tfms-viewer-snapshot-v2";
const SNAPSHOT_MAX_AGE_MS = 5 * 60_000;
const SPECIALTY_THRESHOLD_MAX = 30;
const SPECIALTY_BAND_STORAGE_KEY = "tfms-specialty-band-thresholds-by-specialty";
const EVENT_SPLIT_BAND_STORAGE_KEY = "tfms-event-split-band-thresholds-by-name";
const DEFAULT_SPECIALTY_BAND_THRESHOLDS = { greenMax: 10, yellowMax: 20 };
const EVENT_SPLIT_DISPLAY_ORDER = ["96", "83", "46", "24", "50"];
const CORE_TRACON_SUMMARY_ORDER = [
  { id: "I90" },
  { id: "AUS" },
  { id: "SAT" },
  { id: "MSY" },
];
const SHOW_EVENT_SPLIT_SUMMARY = false;
const MAP_ADDITIONAL_SECTOR_OUTLINES = new Set(["50", "98"]);
const MAP_FORCE_HIGH_SECTOR_OUTLINES = new Set(["72"]);
const MAP_INCLUDE_IN_BOTH_LAYER_OUTLINES = new Set(["24", "43", "72"]);
const QUEUE_ALTITUDE_MAX_FT = 5_000;
const QUEUE_GROUNDSPEED_MAX_KTS = 80;
const QUEUE_TREND_THRESHOLD = 0.25;

function normalizeSpecialtyKey(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeEventSplitConfig(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const splits = raw.splits && typeof raw.splits === "object" ? raw.splits : raw;
  const normalized = {};
  for (const [name, sectorValues] of Object.entries(splits)) {
    const splitName = String(name || "").trim();
    if (!splitName) {
      continue;
    }
    const sectors = Array.isArray(sectorValues)
      ? sectorValues.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    if (sectors.length === 0) {
      continue;
    }
    normalized[splitName] = sectors;
  }
  return normalized;
}

function normalizeBandThresholds(thresholds) {
  const greenRaw = Number(thresholds?.greenMax);
  const yellowRaw = Number(thresholds?.yellowMax);
  const greenMax = Number.isFinite(greenRaw)
    ? Math.max(0, Math.min(SPECIALTY_THRESHOLD_MAX - 1, Math.round(greenRaw)))
    : DEFAULT_SPECIALTY_BAND_THRESHOLDS.greenMax;
  const yellowFloor = greenMax + 1;
  const yellowMax = Number.isFinite(yellowRaw)
    ? Math.max(yellowFloor, Math.min(SPECIALTY_THRESHOLD_MAX, Math.round(yellowRaw)))
    : DEFAULT_SPECIALTY_BAND_THRESHOLDS.yellowMax;
  return { greenMax, yellowMax };
}

function normalizeSpecialtyThresholdMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const next = {};
  for (const [specialty, thresholds] of Object.entries(raw)) {
    const key = normalizeSpecialtyKey(specialty);
    if (!key) {
      continue;
    }
    next[key] = normalizeBandThresholds(thresholds);
  }
  return next;
}

function getThresholdsForSpecialty(map, specialty) {
  const key = normalizeSpecialtyKey(specialty);
  if (!key) {
    return DEFAULT_SPECIALTY_BAND_THRESHOLDS;
  }
  return map?.[key] || DEFAULT_SPECIALTY_BAND_THRESHOLDS;
}

function getBandClass(value, thresholds = DEFAULT_SPECIALTY_BAND_THRESHOLDS) {
  if (value <= thresholds.greenMax) return "tfms-band-green";
  if (value <= thresholds.yellowMax) return "tfms-band-yellow";
  return "tfms-band-red";
}

function CountBadge({ value, thresholds, tickerSignal, title }) {
  const flashClass =
    tickerSignal?.direction === "up"
      ? "tfms-count-tick-down"
      : tickerSignal?.direction === "down"
        ? "tfms-count-tick-up"
        : "";
  return (
    <span className={`tfms-count ${getBandClass(value, thresholds)} ${flashClass}`} title={title || undefined}>
      {value}
    </span>
  );
}

function getSpecialtyRowTone(row, thresholds) {
  const values = [
    row?.now,
    row?.p10,
    row?.p20,
    row?.p30,
  ];
  const hasRed = values.some((value) => Number(value) > thresholds.yellowMax);
  if (hasRed) {
    return "alert";
  }
  const hasYellow = values.some(
    (value) =>
      Number(value) > thresholds.greenMax && Number(value) <= thresholds.yellowMax,
  );
  if (hasYellow) {
    return "warning";
  }
  return "normal";
}

function getSpecialtyChipStyle(specialty) {
  const colors = getSpecialtyColors(specialty);
  return {
    "--chip-fill": colors.sectorFill,
    "--chip-border": colors.iconFill,
    "--chip-text": colors.chipText || colors.iconFill,
  };
}

function applyTraconExclusionToProjections(projections, allTraconPolygons) {
  if (!Array.isArray(projections) || projections.length === 0 || !Array.isArray(allTraconPolygons) || allTraconPolygons.length === 0) {
    return projections || [];
  }
  return projections.map((flight) => {
    const nowInside = isInTraconVolume(
      Number(flight.latitude),
      Number(flight.longitude),
      allTraconPolygons,
      Number(flight.altitude),
    );
    const p10Inside = isInTraconVolume(
      Number(flight.proj10Latitude),
      Number(flight.proj10Longitude),
      allTraconPolygons,
      Number(flight.proj10Altitude),
    );
    const p20Inside = isInTraconVolume(
      Number(flight.proj20Latitude),
      Number(flight.proj20Longitude),
      allTraconPolygons,
      Number(flight.proj20Altitude),
    );
    const p30Inside = isInTraconVolume(
      Number(flight.proj30Latitude),
      Number(flight.proj30Longitude),
      allTraconPolygons,
      Number(flight.proj30Altitude),
    );
    return {
      ...flight,
      specialty: nowInside ? null : flight.specialty,
      proj10Specialty: (nowInside || p10Inside) ? null : flight.proj10Specialty,
      proj20Specialty: (nowInside || p20Inside) ? null : flight.proj20Specialty,
      proj30Specialty: (nowInside || p30Inside) ? null : flight.proj30Specialty,
    };
  });
}

function buildSpecialtySummaryWithTraconToggle(
  projections,
  specialties,
  excludeTraconVolumes,
  allTraconPolygons,
) {
  if (!excludeTraconVolumes) {
    return buildSpecialtySummary(projections, specialties);
  }
  const filtered = applyTraconExclusionToProjections(projections, allTraconPolygons);
  return buildSpecialtySummary(filtered, specialties);
}

function FeedFooter({ feedTone, processingStatus, error, nextRefreshAt, perfMetrics }) {
  const [now, setNow] = useState(nextRefreshAt);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const nextRefreshLabel = `${Math.max(0, Math.round((nextRefreshAt - now) / 1000))}s`;
  const perfLabel = perfMetrics
    ? `Compute ${perfMetrics.totalMs}ms | Fetch ${perfMetrics.fetchMs} | Motion ${perfMetrics.motionMs} | Project ${perfMetrics.projectMs} | Summary ${perfMetrics.summaryMs}`
    : "Compute metrics pending...";

  return (
    <aside className="fixed bottom-3 left-1/2 z-40 flex w-[min(96vw,62rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 px-1">
      <div className="border-default bg-surface-soft text-muted flex min-w-[20rem] items-center justify-center gap-2 rounded-lg border px-3 py-1 text-[11px]">
        <span className={`feed-indicator feed-indicator-${feedTone}`} aria-hidden="true" />
        <span className="uppercase tracking-[0.12em]">Traffic</span>
        <span className="text-main font-semibold">{processingStatus || (error ? "Error" : "Live")}</span>
        <span>Next {nextRefreshLabel}</span>
        {error ? <span className="text-rose-600">{error}</span> : null}
      </div>
      <div className="border-default bg-surface-soft text-muted flex min-w-[28rem] items-center justify-center gap-2 rounded-lg border px-3 py-1 text-[11px]">
        <span>{perfLabel}</span>
      </div>
    </aside>
  );
}

function areSummaryRowsEqual(previous, next, keys) {
  if (previous === next) {
    return true;
  }
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    const prevRow = previous[index];
    const nextRow = next[index];
    for (const key of keys) {
      if (prevRow?.[key] !== nextRow?.[key]) {
        return false;
      }
    }
  }
  return true;
}

const SPECIALTY_PROJECTION_FIELDS = ["now", "p10", "p20", "p30"];
const EVENT_SPLIT_PROJECTION_FIELDS = ["now", "p10", "p20", "p30"];

function buildSpecialtyTickerSignals(previousRows, nextRows, startToken = 0) {
  if (!Array.isArray(previousRows) || previousRows.length === 0 || !Array.isArray(nextRows)) {
    return { nextToken: startToken, signals: {} };
  }

  const previousBySpecialty = new Map(
    previousRows.map((row) => [String(row?.specialty || ""), row]),
  );
  const signals = {};
  let nextToken = startToken;

  for (const row of nextRows) {
    const specialty = String(row?.specialty || "");
    if (!specialty) {
      continue;
    }
    const previousRow = previousBySpecialty.get(specialty);
    if (!previousRow) {
      continue;
    }
    for (const field of SPECIALTY_PROJECTION_FIELDS) {
      const prevValue = Number(previousRow?.[field] ?? 0);
      const nextValue = Number(row?.[field] ?? 0);
      if (!Number.isFinite(prevValue) || !Number.isFinite(nextValue) || prevValue === nextValue) {
        continue;
      }
      nextToken += 1;
      signals[`${specialty}:${field}`] = {
        direction: nextValue > prevValue ? "up" : "down",
        token: nextToken,
      };
    }
  }

  return { nextToken, signals };
}

function buildRowTickerSignals(previousRows, nextRows, idField, fields, startToken = 0) {
  if (!Array.isArray(previousRows) || previousRows.length === 0 || !Array.isArray(nextRows)) {
    return { nextToken: startToken, signals: {} };
  }

  const previousById = new Map(
    previousRows.map((row) => [String(row?.[idField] || ""), row]),
  );
  const signals = {};
  let nextToken = startToken;

  for (const row of nextRows) {
    const id = String(row?.[idField] || "");
    if (!id) {
      continue;
    }
    const previousRow = previousById.get(id);
    if (!previousRow) {
      continue;
    }
    for (const field of fields || []) {
      const prevValue = Number(previousRow?.[field] ?? 0);
      const nextValue = Number(row?.[field] ?? 0);
      if (!Number.isFinite(prevValue) || !Number.isFinite(nextValue) || prevValue === nextValue) {
        continue;
      }
      nextToken += 1;
      signals[`${id}:${field}`] = {
        direction: nextValue > prevValue ? "up" : "down",
        token: nextToken,
      };
    }
  }

  return { nextToken, signals };
}

function areControllersEqual(previous, next) {
  if (previous === next) {
    return true;
  }
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    const prev = previous[index];
    const curr = next[index];
    if (
      prev?.callsign !== curr?.callsign ||
      prev?.name !== curr?.name ||
      prev?.cid !== curr?.cid
    ) {
      return false;
    }
  }
  return true;
}

function formatEnroutePosition(callsign) {
  const value = String(callsign || "");
  const match = value.match(/^HOU_(\d{2})\d?_CTR$/i);
  return match ? match[1] : value;
}

function isReliefSignOn(callsign) {
  return /^HOU_\d{3}_CTR$/i.test(String(callsign || ""));
}

function formatOnlineDuration(logonTime) {
  const timestampMs = Date.parse(String(logonTime || ""));
  if (!Number.isFinite(timestampMs)) {
    return "-";
  }
  const deltaMs = Date.now() - timestampMs;
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return "-";
  }
  const totalMinutes = Math.floor(deltaMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function getOnlineDurationMs(logonTime) {
  const timestampMs = Date.parse(String(logonTime || ""));
  if (!Number.isFinite(timestampMs)) {
    return -1;
  }
  const deltaMs = Date.now() - timestampMs;
  return Number.isFinite(deltaMs) && deltaMs >= 0 ? deltaMs : -1;
}


function pointInPolygonCoordinates(point, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return false;
  }
  if (!pointInPolygon(point, coordinates[0])) {
    return false;
  }
  for (let i = 1; i < coordinates.length; i += 1) {
    if (pointInPolygon(point, coordinates[i])) {
      return false;
    }
  }
  return true;
}

function isPointInGeometry(point, geometry) {
  if (!geometry || typeof geometry !== "object") {
    return false;
  }
  if (geometry.type === "Polygon") {
    return pointInPolygonCoordinates(point, geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || []).some((polygon) =>
      pointInPolygonCoordinates(point, polygon),
    );
  }
  return false;
}

function boundsToPolygonGeometry(bounds) {
  if (!bounds) {
    return null;
  }
  const minLat = Number(bounds.minLat);
  const maxLat = Number(bounds.maxLat);
  const minLon = Number(bounds.minLon);
  const maxLon = Number(bounds.maxLon);
  if (![minLat, maxLat, minLon, maxLon].every(Number.isFinite)) {
    return null;
  }
  return {
    type: "Polygon",
    coordinates: [[
      [minLon, minLat],
      [maxLon, minLat],
      [maxLon, maxLat],
      [minLon, maxLat],
      [minLon, minLat],
    ]],
  };
}

function extractGeometriesFromAny(value, target = []) {
  if (!value) {
    return target;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      extractGeometriesFromAny(item, target);
    }
    return target;
  }
  if (value.type === "FeatureCollection") {
    extractGeometriesFromAny(value.features || [], target);
    return target;
  }
  if (value.type === "Feature") {
    extractGeometriesFromAny(value.geometry, target);
    return target;
  }
  if (value.type === "Polygon" || value.type === "MultiPolygon") {
    target.push(value);
  }
  return target;
}

function isPilotInsideBounds(pilot, boundsOrGeometries) {
  const lat = Number(pilot?.latitude);
  const lon = Number(pilot?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !boundsOrGeometries) {
    return false;
  }
  if (Array.isArray(boundsOrGeometries)) {
    return boundsOrGeometries.some((geometry) => isPointInGeometry([lon, lat], geometry));
  }
  return (
    lat >= Number(boundsOrGeometries.minLat) &&
    lat <= Number(boundsOrGeometries.maxLat) &&
    lon >= Number(boundsOrGeometries.minLon) &&
    lon <= Number(boundsOrGeometries.maxLon)
  );
}

function formatQueueMinutes(totalMinutes) {
  const rounded = Math.max(0, Math.round(Number(totalMinutes || 0)));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function TraconFlowIcon({ type }) {
  const departurePath =
    "M16.6 13.4H1.4a.4.4 0 0 0-.4.4v.8a.4.4 0 0 0 .4.4h15.2a.4.4 0 0 0 .4-.4v-.8a.4.4 0 0 0-.4-.4M3.014 10.732a.82.82 0 0 0 .608.268l3.263-.005c.258 0 .512-.061.741-.178L14.9 7.126c.669-.34 1.268-.824 1.676-1.458.457-.712.507-1.227.326-1.591-.18-.364-.618-.632-1.456-.686-.746-.049-1.488.148-2.157.487l-2.462 1.25-5.468-2.052a.45.45 0 0 0-.45-.028l-1.643.834a.457.457 0 0 0-.13.714l3.906 2.452-2.58 1.31-1.81-.912a.45.45 0 0 0-.4 0l-1.004.51a.457.457 0 0 0-.14.702z";
  const arrivalPath =
    "M16.6 13.8H1.4a.4.4 0 0 0-.4.4v.8a.4.4 0 0 0 .4.4h15.2a.4.4 0 0 0 .4-.4v-.8a.4.4 0 0 0-.4-.4M2.12 7.741l2.219 2c.182.165.4.284.636.349l7.19 1.959c.663.18 1.365.218 2.026.034.741-.207 1.085-.53 1.18-.893.096-.363-.043-.818-.584-1.374-.482-.496-1.108-.82-1.77-1l-2.438-.664L8.07 3.356a.42.42 0 0 0-.292-.298l-1.627-.443a.413.413 0 0 0-.518.41l1.199 4.106-2.555-.696-.69-1.697a.41.41 0 0 0-.276-.249l-.993-.27a.413.413 0 0 0-.518.397l.006 2.544c.004.223.15.434.314.581";
  const overflightPath =
    "M1.947 9.844a.83.83 0 0 1-.422-.514L.761 6.62a.457.457 0 0 1 .441-.564l1.126-.002a.45.45 0 0 1 .358.181l1.203 1.63 2.893-.004-2.378-3.95a.457.457 0 0 1 .437-.58l1.844-.002a.45.45 0 0 1 .389.228l3.953 4.299 2.761-.004c.75 0 1.5.16 2.145.54.723.426.993.863.99 1.269s-.28.844-1.01 1.272c-.65.382-1.404.544-2.153.545l-8.157.01a1.64 1.64 0 0 1-.742-.175z";
  const glyph = type === "arrival" ? arrivalPath : type === "overflight" ? overflightPath : departurePath;
  const angle = 0;
  return (
    <svg
      viewBox="0 0 18 18"
      width={16}
      height={16}
      fill="none"
      aria-hidden="true"
    >
      <g transform={`rotate(${angle} 9 9)`}>
        <path
          fill="currentColor"
          d={glyph}
        />
      </g>
    </svg>
  );
}

function buildAirportQueueSummary(pilots, boxes, previousTracker, previousRowsByIcao, nowMs) {
  const tracker = {};
  const rows = [];

  for (const box of boxes) {
    const durations = [];
    const icao = String(box?.icao || "").toUpperCase();

    for (const pilot of pilots || []) {
      const departure = normalizeAirportCode(pilot?.flight_plan?.departure);
      if (departure !== icao) {
        continue;
      }
      const hasGeometry = Array.isArray(box?.geometries) && box.geometries.length > 0;
      if (!isPilotInsideBounds(pilot, hasGeometry ? box.geometries : box?.bounds)) {
        continue;
      }
      if (Number(pilot?.altitude || 0) > QUEUE_ALTITUDE_MAX_FT) {
        continue;
      }
      if (Number(pilot?.groundspeed || 0) > QUEUE_GROUNDSPEED_MAX_KTS) {
        continue;
      }

      const callsign = String(pilot?.callsign || "").trim().toUpperCase();
      if (!callsign) {
        continue;
      }

      const trackerKey = `${icao}:${callsign}`;
      const previous = previousTracker?.[trackerKey];
      const enteredAt =
        Number.isFinite(previous?.enteredAt) && previous.enteredAt <= nowMs
          ? previous.enteredAt
          : nowMs;
      tracker[trackerKey] = { enteredAt, lastSeenAt: nowMs };
      durations.push((nowMs - enteredAt) / 60_000);
    }

    const count = durations.length;
    const avgMinutes = count > 0 ? durations.reduce((sum, value) => sum + value, 0) / count : 0;
    const maxMinutes = count > 0 ? Math.max(...durations) : 0;
    const previousRow = previousRowsByIcao?.[icao];
    const previousPressure = previousRow
      ? Number(previousRow.avgMinutes || 0) + Number(previousRow.count || 0) * 0.75
      : Number(avgMinutes) + count * 0.75;
    const nextPressure = Number(avgMinutes) + count * 0.75;
    const delta = nextPressure - previousPressure;
    const trend = delta > QUEUE_TREND_THRESHOLD ? "up" : delta < -QUEUE_TREND_THRESHOLD ? "down" : "flat";

    rows.push({
      icao,
      name: box?.name || icao,
      count,
      avgMinutes,
      maxMinutes,
      trend,
    });
  }

  return { rows, tracker };
}

function areTraconStatusEqual(previous, next) {
  if (previous === next) {
    return true;
  }
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    const prev = previous[index];
    const curr = next[index];
    if (prev?.id !== curr?.id || prev?.staffed !== curr?.staffed) {
      return false;
    }
    const prevCallsigns = prev?.callsigns || [];
    const currCallsigns = curr?.callsigns || [];
    if (prevCallsigns.length !== currCallsigns.length) {
      return false;
    }
    for (let i = 0; i < prevCallsigns.length; i += 1) {
      if (prevCallsigns[i] !== currCallsigns[i]) {
        return false;
      }
    }
  }
  return true;
}

function buildTowerStaffingByAirport(vatsim) {
  const next = {};
  for (const controller of vatsim?.controllers || []) {
    const callsign = String(controller?.callsign || "").trim().toUpperCase();
    if (!callsign || !callsign.endsWith("_TWR")) {
      continue;
    }
    const match = callsign.match(/^([A-Z0-9]{3,4})_(?:[A-Z0-9]{1,4}_)?TWR$/);
    if (!match) {
      continue;
    }
    const airport = normalizeAirportCode(match[1]);
    if (!airport) {
      continue;
    }
    next[airport] = true;
  }
  return next;
}

function areTowerStaffingByAirportEqual(previous, next) {
  if (previous === next) {
    return true;
  }
  if (!previous || !next || typeof previous !== "object" || typeof next !== "object") {
    return false;
  }
  const prevKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) {
    return false;
  }
  for (const key of prevKeys) {
    if (Boolean(previous[key]) !== Boolean(next[key])) {
      return false;
    }
  }
  return true;
}

function readTfmsSnapshot() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(TFMS_SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const savedAt = Number(parsed?.savedAt || 0);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > SNAPSHOT_MAX_AGE_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeTfmsSnapshot(snapshot) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(
      TFMS_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        ...snapshot,
        savedAt: Date.now(),
      }),
    );
  } catch {
    // Ignore storage errors and continue with live behavior.
  }
}

export default function TfmsViewerPage() {
  const [controllers, setControllers] = useState([]);
  const [traconStaffing, setTraconStaffing] = useState([]);
  const [towerStaffingByAirport, setTowerStaffingByAirport] = useState({});
  const [specialtySummary, setSpecialtySummary] = useState([]);
  const [eventSplitSummary, setEventSplitSummary] = useState([]);
  const [airportQueueSummary, setAirportQueueSummary] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingStatus, setProcessingStatus] = useState("Starting...");
  const [error, setError] = useState("");
  const [nextRefreshAt, setNextRefreshAt] = useState(Date.now() + REFRESH_MS);
  const [perfMetrics, setPerfMetrics] = useState(null);
  const [mapFlights, setMapFlights] = useState([]);
  const [isMapVisible, setIsMapVisible] = useState(false);
  const [specialtyBandThresholdsBySpecialty, setSpecialtyBandThresholdsBySpecialty] = useState({});
  const [eventSplitBandThresholdsByName, setEventSplitBandThresholdsByName] = useState({});
  const [specialtyTickerSignals, setSpecialtyTickerSignals] = useState({});
  const [eventSplitTickerSignals, setEventSplitTickerSignals] = useState({});
  const [selectedSpecialtyForThresholds, setSelectedSpecialtyForThresholds] = useState(null);
  const [specialtyModalPosition, setSpecialtyModalPosition] = useState({ x: 24, y: 24 });
  const [selectedEventSplitForThresholds, setSelectedEventSplitForThresholds] = useState(null);
  const [eventSplitModalPosition, setEventSplitModalPosition] = useState({ x: 24, y: 24 });
  const [isToolInfoOpen, setIsToolInfoOpen] = useState(false);
  const [isProjectionInfoOpen, setIsProjectionInfoOpen] = useState(false);
  const [excludeTraconVolumesInSummary, setExcludeTraconVolumesInSummary] = useState(true);
  const isFetchingRef = useRef(false);
  const nextRefreshAtRef = useRef(Date.now() + REFRESH_MS);
  const fetchAbortRef = useRef(null);
  const fetchRequestIdRef = useRef(0);
  const projectedFlightsRef = useRef([]);
  const pilotMotionByCallsignRef = useRef({});
  const specialtyTickerTokenRef = useRef(0);
  const [specialtyLogActive, setSpecialtyLogActive] = useState(false);
  const [specialtyLogEntries, setSpecialtyLogEntries] = useState([]);
  const specialtyLogColumnsRef = useRef([]);
  const eventSplitTickerTokenRef = useRef(0);
  const airportQueueTrackerRef = useRef({});
  const previousAirportQueueByIcaoRef = useRef({});

  const sectorIndex = useMemo(() => buildSectorIndex(sectorsGeoJson), []);
  const traconVolumeIndex = useMemo(() => buildTraconVolumeIndex(), []);
  const allTraconVolumePolygons = useMemo(
    () => Object.values(traconVolumeIndex.byId || {}).flat(),
    [traconVolumeIndex],
  );
  const eventSplits = useMemo(() => normalizeEventSplitConfig(eventSplitsData), []);
  const queueBoxes = useMemo(() => {
    const raw = Array.isArray(airportQueueBoxes?.airports) ? airportQueueBoxes.airports : [];
    const grouped = new Map();

    for (const row of raw) {
      const icao = normalizeAirportCode(row?.icao);
      if (!icao) {
        continue;
      }
      const existing = grouped.get(icao) || {
        icao,
        name: row?.name || icao,
        bounds: null,
        geometries: [],
      };
      if (!existing.name && row?.name) {
        existing.name = row.name;
      }

      if (row?.bounds) {
        const legacyGeometry = boundsToPolygonGeometry(row.bounds);
        if (legacyGeometry) {
          existing.geometries.push(legacyGeometry);
        } else if (!existing.bounds) {
          existing.bounds = row.bounds;
        }
      }

      if (Array.isArray(row?.areas)) {
        extractGeometriesFromAny(row.areas, existing.geometries);
      }
      if (row?.geojson) {
        extractGeometriesFromAny(row.geojson, existing.geometries);
      }

      grouped.set(icao, existing);
    }

    return [...grouped.values()].filter(
      (row) => row?.icao && (row?.geometries?.length > 0 || row?.bounds),
    );
  }, []);
  const defaultSpecialtySummary = useMemo(
    () => buildSpecialtySummary([], sectorIndex.specialties),
    [sectorIndex.specialties],
  );
  const specialtySummaryFlights = useMemo(
    () =>
      excludeTraconVolumesInSummary
        ? applyTraconExclusionToProjections(mapFlights, allTraconVolumePolygons)
        : mapFlights,
    [allTraconVolumePolygons, excludeTraconVolumesInSummary, mapFlights],
  );
  const specialtyCallsignsByBucket = useMemo(() => {
    const buckets = {};
    for (const specialty of sectorIndex.specialties || []) {
      buckets[`${specialty}:now`] = [];
      buckets[`${specialty}:p10`] = [];
      buckets[`${specialty}:p20`] = [];
      buckets[`${specialty}:p30`] = [];
    }

    for (const flight of specialtySummaryFlights || []) {
      const callsign = String(flight.callsign || "").trim();
      if (!callsign) {
        continue;
      }
      const groundspeed = Number(flight.groundspeed || 0);
      const nowAlt = Number(flight.altitude || 0);
      const p10Alt = Number(flight.proj10Altitude ?? flight.altitude ?? 0);
      const p20Alt = Number(flight.proj20Altitude ?? flight.altitude ?? 0);
      const p30Alt = Number(flight.proj30Altitude ?? flight.altitude ?? 0);

      if (flight.specialty && passesOperationalGate(nowAlt, groundspeed)) {
        const key = `${flight.specialty}:now`;
        if (Array.isArray(buckets[key])) {
          buckets[key].push(callsign);
        }
      }
      if (flight.proj10Specialty && passesOperationalGate(p10Alt, groundspeed)) {
        const key = `${flight.proj10Specialty}:p10`;
        if (Array.isArray(buckets[key])) {
          buckets[key].push(callsign);
        }
      }
      if (flight.proj20Specialty && passesOperationalGate(p20Alt, groundspeed)) {
        const key = `${flight.proj20Specialty}:p20`;
        if (Array.isArray(buckets[key])) {
          buckets[key].push(callsign);
        }
      }
      if (flight.proj30Specialty && passesOperationalGate(p30Alt, groundspeed)) {
        const key = `${flight.proj30Specialty}:p30`;
        if (Array.isArray(buckets[key])) {
          buckets[key].push(callsign);
        }
      }
    }

    for (const [key, list] of Object.entries(buckets)) {
      buckets[key] = [...new Set(list)].sort((a, b) => a.localeCompare(b));
    }
    return buckets;
  }, [sectorIndex.specialties, specialtySummaryFlights]);
  const sectorLayerOutlines = useMemo(() => {
    const layers = { low: [], high: [] };
    for (const feature of sectorsGeoJson.features || []) {
      const props = feature?.properties || {};
      const sectorRaw = String(props.sector || "");
      const sector = sectorRaw.toLowerCase();
      const specialty = String(props.specialty || "").toUpperCase();
      if (!sector || sector === "zhu") {
        continue;
      }
      const ceiling = Number(props.ceiling);
      const ring = feature?.geometry?.coordinates?.[0] || [];
      const points = ring
        .map((pair) => [Number(pair?.[1]), Number(pair?.[0])])
        .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
      if (points.length < 3) {
        continue;
      }
      let layer = "high";
      if (MAP_FORCE_HIGH_SECTOR_OUTLINES.has(sectorRaw)) {
        layer = "high";
      } else if (MAP_ADDITIONAL_SECTOR_OUTLINES.has(sectorRaw)) {
        layer = "low";
      } else if (Number.isFinite(ceiling) && ceiling <= 23999) {
        layer = "low";
      }
      if (MAP_INCLUDE_IN_BOTH_LAYER_OUTLINES.has(sectorRaw)) {
        layers.low.push({ id: sectorRaw, specialty, points });
        layers.high.push({ id: sectorRaw, specialty, points });
      } else {
        layers[layer].push({ id: sectorRaw, specialty, points });
      }
    }
    return layers;
  }, []);
  const specialtyBounds = useMemo(() => {
    const accumulator = {};
    for (const feature of sectorsGeoJson.features || []) {
      const props = feature?.properties || {};
      const specialty = String(props.specialty || "").toUpperCase();
      const sector = String(props.sector || "").toLowerCase();
      if (!specialty || sector === "zhu") {
        continue;
      }
      const ring = feature?.geometry?.coordinates?.[0] || [];
      if (!accumulator[specialty]) {
        accumulator[specialty] = {
          minLat: Infinity,
          maxLat: -Infinity,
          minLon: Infinity,
          maxLon: -Infinity,
        };
      }
      for (const pair of ring) {
        const lon = Number(pair?.[0]);
        const lat = Number(pair?.[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          continue;
        }
        accumulator[specialty].minLat = Math.min(accumulator[specialty].minLat, lat);
        accumulator[specialty].maxLat = Math.max(accumulator[specialty].maxLat, lat);
        accumulator[specialty].minLon = Math.min(accumulator[specialty].minLon, lon);
        accumulator[specialty].maxLon = Math.max(accumulator[specialty].maxLon, lon);
      }
    }

    const boundsBySpecialty = {};
    for (const [specialty, bounds] of Object.entries(accumulator)) {
      if (
        Number.isFinite(bounds.minLat) &&
        Number.isFinite(bounds.maxLat) &&
        Number.isFinite(bounds.minLon) &&
        Number.isFinite(bounds.maxLon)
      ) {
        boundsBySpecialty[specialty] = [
          [bounds.minLat, bounds.minLon],
          [bounds.maxLat, bounds.maxLon],
        ];
      }
    }
    return boundsBySpecialty;
  }, []);
  const defaultEventSplitSummary = useMemo(
    () => (SHOW_EVENT_SPLIT_SUMMARY ? buildSplitSummary([], eventSplits) : []),
    [eventSplits],
  );
  const defaultAirportQueueSummary = useMemo(
    () =>
      queueBoxes.map((box) => ({
        icao: box.icao,
        name: box.name || box.icao,
        count: 0,
        avgMinutes: 0,
        maxMinutes: 0,
        trend: "flat",
      })),
    [queueBoxes],
  );
  const specialtyDisplay = useMemo(
    () => (specialtySummary.length > 0 ? specialtySummary : defaultSpecialtySummary),
    [defaultSpecialtySummary, specialtySummary],
  );

  // Append a log entry whenever data refreshes while logging is active
  useEffect(() => {
    if (!specialtyLogActive || specialtyDisplay.length === 0) return;
    const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const counts = Object.fromEntries(specialtyDisplay.map((row) => [row.specialty, row.now]));
    setSpecialtyLogEntries((prev) => [...prev, { time, counts }]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialtyLogActive, specialtySummary]); // intentionally use specialtySummary (not display) so TRACON toggle doesn't add duplicate rows

  const handleSpecialtyLogToggle = useCallback(() => {
    if (!specialtyLogActive) {
      specialtyLogColumnsRef.current = specialtyDisplay.map((row) => row.specialty);
      setSpecialtyLogEntries([]);
      setSpecialtyLogActive(true);
    } else {
      const columns = specialtyLogColumnsRef.current;
      const header = ["time", ...columns].join(",");
      const rows = specialtyLogEntries.map((entry) =>
        [entry.time, ...columns.map((col) => String(entry.counts[col] ?? 0))].join(","),
      );
      const csv = [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `zhu-specialty-log-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setSpecialtyLogActive(false);
    }
  }, [specialtyLogActive, specialtyDisplay, specialtyLogEntries]);

  const airportQueueDisplay = useMemo(
    () => (airportQueueSummary.length > 0 ? airportQueueSummary : defaultAirportQueueSummary),
    [airportQueueSummary, defaultAirportQueueSummary],
  );
  const eventSplitDisplay = useMemo(
    () => {
      const rows = eventSplitSummary.length > 0 ? eventSplitSummary : defaultEventSplitSummary;
      const priority = new Map(EVENT_SPLIT_DISPLAY_ORDER.map((name, index) => [name, index]));
      return rows.slice().sort((a, b) => {
        const aName = String(a?.name || "");
        const bName = String(b?.name || "");
        const aPriority = priority.has(aName) ? priority.get(aName) : Number.MAX_SAFE_INTEGER;
        const bPriority = priority.has(bName) ? priority.get(bName) : Number.MAX_SAFE_INTEGER;
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        return aName.localeCompare(bName);
      });
    },
    [eventSplitSummary, defaultEventSplitSummary],
  );
  const baseTraconStaffing = useMemo(
    () => buildTraconStaffing({ controllers: [] }),
    [],
  );
  const traconStaffingDisplay = useMemo(
    () => (traconStaffing.length > 0 ? traconStaffing : baseTraconStaffing),
    [baseTraconStaffing, traconStaffing],
  );
  const traconStaffedById = useMemo(
    () =>
      Object.fromEntries(
        traconStaffingDisplay.map((facility) => [String(facility.id || "").toUpperCase(), Boolean(facility.staffed)]),
      ),
    [traconStaffingDisplay],
  );
  const traconAirportCodesById = useMemo(() => {
    const source = traconAirportsData?.tracons && typeof traconAirportsData.tracons === "object"
      ? traconAirportsData.tracons
      : {};
    const next = {};
    for (const [traconIdRaw, codesRaw] of Object.entries(source)) {
      const traconId = String(traconIdRaw || "").trim().toUpperCase();
      if (!traconId) {
        continue;
      }
      const codes = Array.isArray(codesRaw) ? codesRaw : [];
      const set = new Set();
      for (const codeValue of codes) {
        const raw = String(codeValue || "").trim().toUpperCase();
        const normalized = normalizeAirportCode(raw);
        if (raw) {
          set.add(raw);
        }
        if (normalized) {
          set.add(normalized);
        }
      }
      next[traconId] = set;
    }
    return next;
  }, []);
  const traconKpiDisplay = useMemo(
    () => {
      const orderIndexById = new Map((traconVolumeIndex.ids || []).map((id, index) => [id, index]));
      return (traconVolumeIndex.ids || []).map((id) => {
        const polygons = traconVolumeIndex.byId?.[id] || [];
        const flights = (mapFlights || [])
          .filter((flight) =>
            isInTraconVolume(
              Number(flight.latitude),
              Number(flight.longitude),
              polygons,
              Number(flight.altitude),
            ),
          );
        const callsigns = flights
          .map((flight) => String(flight.callsign || "").trim())
          .filter(Boolean);
        return {
          id,
          staffed: Boolean(traconStaffedById[String(id || "").toUpperCase()]),
          aircraftCount: callsigns.length,
          callsigns,
          flights,
        };
      }).sort((a, b) => {
        if (a.staffed !== b.staffed) {
          return a.staffed ? -1 : 1;
        }
        return (orderIndexById.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndexById.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      });
    },
    [mapFlights, traconStaffedById, traconVolumeIndex.byId, traconVolumeIndex.ids],
  );
  const traconCoreCards = useMemo(() => {
    const traconById = new Map(
      traconKpiDisplay.map((facility) => [String(facility.id || "").toUpperCase(), facility]),
    );
    const queueByIcao = new Map(
      airportQueueDisplay.map((row) => [String(row.icao || "").toUpperCase(), row]),
    );
    return CORE_TRACON_SUMMARY_ORDER.map(({ id }) => {
      const tracon = traconById.get(id) || { id, staffed: false, aircraftCount: 0, callsigns: [], flights: [] };
      const traconAirportCodes = traconAirportCodesById[id] || new Set();
      const airportCodesForClassify = traconAirportCodes;
      let departuresCount = 0;
      let arrivalsCount = 0;
      let overflightsCount = 0;
      for (const flight of tracon.flights || []) {
        const departure = String(flight?.departure || "").trim().toUpperCase();
        const arrival = String(flight?.arrival || "").trim().toUpperCase();
        const isDeparture = departure && airportCodesForClassify.has(departure);
        const isArrival = arrival && airportCodesForClassify.has(arrival);
        if (isDeparture) {
          departuresCount += 1;
        } else if (isArrival) {
          arrivalsCount += 1;
        } else {
          overflightsCount += 1;
        }
      }
      const queueAirports = [];
      const seenQueueIcao = new Set();
      for (const airportCode of traconAirportCodes) {
        const normalizedIcao = normalizeAirportCode(airportCode);
        if (!normalizedIcao || seenQueueIcao.has(normalizedIcao)) {
          continue;
        }
        const row = queueByIcao.get(normalizedIcao);
        if (!row) {
          continue;
        }
        queueAirports.push({
          icao: normalizedIcao,
          label: normalizedIcao,
          count: Number(row?.count || 0),
          avgMinutes: Number(row?.avgMinutes || 0),
          towerOnline: Boolean(towerStaffingByAirport[normalizedIcao]),
        });
        seenQueueIcao.add(normalizedIcao);
      }
      return {
        id,
        staffed: Boolean(tracon.staffed),
        aircraftCount: Number(tracon.aircraftCount || 0),
        callsigns: tracon.callsigns || [],
        departuresCount,
        arrivalsCount,
        overflightsCount,
        queueAirports,
      };
    });
  }, [airportQueueDisplay, towerStaffingByAirport, traconAirportCodesById, traconKpiDisplay]);
  const traconRemainingAirborne = useMemo(() => {
    const coreIds = new Set(CORE_TRACON_SUMMARY_ORDER.map((item) => item.id));
    return traconKpiDisplay.filter(
      (facility) => !coreIds.has(String(facility.id || "").toUpperCase()),
    );
  }, [traconKpiDisplay]);
  const traconRemainingOnlineAirborne = useMemo(
    () => traconRemainingAirborne.filter((facility) => facility.staffed),
    [traconRemainingAirborne],
  );
  const traconRemainingOfflineAirborne = useMemo(
    () => traconRemainingAirborne.filter((facility) => !facility.staffed),
    [traconRemainingAirborne],
  );
  const enrouteDisplay = useMemo(
    () =>
      controllers
        .slice()
        .sort(
          (a, b) =>
            getOnlineDurationMs(b.logon_time) - getOnlineDurationMs(a.logon_time),
        ),
    [controllers],
  );

  const refreshData = useCallback(async () => {
    if (isFetchingRef.current) {
      return;
    }
    isFetchingRef.current = true;
    fetchRequestIdRef.current += 1;
    const requestId = fetchRequestIdRef.current;

    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
    }
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setProcessingStatus("Fetching VATSIM data...");
    setError("");
    const refreshStart = performance.now();

    try {
      const response = await fetch(VATSIM_API, { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        throw new Error("Failed to fetch VATSIM data");
      }
      const vatsim = await response.json();
      const fetchDone = performance.now();

      if (requestId !== fetchRequestIdRef.current) {
        return;
      }

      setProcessingStatus("Processing flights...");

      const zhuControllers = getZhuEnrouteControllers(vatsim);
      const nextTraconStaffing = buildTraconStaffing(vatsim);
      const nextTowerStaffingByAirport = buildTowerStaffingByAirport(vatsim);
      const nextPilotMotion = buildPilotMotionModel(vatsim, pilotMotionByCallsignRef.current, sectorIndex);
      const motionDone = performance.now();
      pilotMotionByCallsignRef.current = nextPilotMotion;
      const projected = computeProjectedFlights(vatsim, sectorIndex, nextPilotMotion);
      const projectDone = performance.now();
      projectedFlightsRef.current = projected;
      setMapFlights(projected);
      const nextSpecialty = buildSpecialtySummaryWithTraconToggle(
        projected,
        sectorIndex.specialties,
        excludeTraconVolumesInSummary,
        allTraconVolumePolygons,
      );
      const nextEventSplit = SHOW_EVENT_SPLIT_SUMMARY
        ? buildSplitSummary(projected, eventSplits)
        : [];
      const queueSummaryResult = buildAirportQueueSummary(
        vatsim.pilots || [],
        queueBoxes,
        airportQueueTrackerRef.current,
        previousAirportQueueByIcaoRef.current,
        Date.now(),
      );
      const queueRows = queueSummaryResult.rows;
      airportQueueTrackerRef.current = queueSummaryResult.tracker;
      previousAirportQueueByIcaoRef.current = Object.fromEntries(
        queueRows.map((row) => [row.icao, row]),
      );
      const summaryDone = performance.now();

      setControllers((previous) => (areControllersEqual(previous, zhuControllers) ? previous : zhuControllers));
      setTraconStaffing((previous) =>
        areTraconStatusEqual(previous, nextTraconStaffing) ? previous : nextTraconStaffing,
      );
      setTowerStaffingByAirport((previous) =>
        areTowerStaffingByAirportEqual(previous, nextTowerStaffingByAirport)
          ? previous
          : nextTowerStaffingByAirport,
      );
      setSpecialtySummary((previous) => {
        if (areSummaryRowsEqual(previous, nextSpecialty, ["specialty", "now", "p10", "p20", "p30"])) {
          return previous;
        }
        const signalUpdate = buildSpecialtyTickerSignals(
          previous,
          nextSpecialty,
          specialtyTickerTokenRef.current,
        );
        specialtyTickerTokenRef.current = signalUpdate.nextToken;
        setSpecialtyTickerSignals(signalUpdate.signals);
        return nextSpecialty;
      });
      setAirportQueueSummary((previous) =>
        areSummaryRowsEqual(previous, queueRows, [
          "icao",
          "count",
          "avgMinutes",
          "maxMinutes",
          "trend",
        ])
          ? previous
          : queueRows,
      );
      if (SHOW_EVENT_SPLIT_SUMMARY) {
        setEventSplitSummary((previous) => {
          if (areSummaryRowsEqual(previous, nextEventSplit, ["name", "now", "p10", "p20", "p30"])) {
            return previous;
          }
          const signalUpdate = buildRowTickerSignals(
            previous,
            nextEventSplit,
            "name",
            EVENT_SPLIT_PROJECTION_FIELDS,
            eventSplitTickerTokenRef.current,
          );
          eventSplitTickerTokenRef.current = signalUpdate.nextToken;
          setEventSplitTickerSignals(signalUpdate.signals);
          return nextEventSplit;
        });
      }
      const nextPerfMetrics = {
        fetchMs: Math.round(fetchDone - refreshStart),
        motionMs: Math.round(motionDone - fetchDone),
        projectMs: Math.round(projectDone - motionDone),
        summaryMs: Math.round(summaryDone - projectDone),
        totalMs: Math.round(summaryDone - refreshStart),
      };
      setPerfMetrics(nextPerfMetrics);
      const nextRefresh = Date.now() + REFRESH_MS;
      setNextRefreshAt(nextRefresh);
      nextRefreshAtRef.current = nextRefresh;
      setProcessingStatus("");
      writeTfmsSnapshot({
        controllers: zhuControllers,
        traconStaffing: nextTraconStaffing,
        towerStaffingByAirport: nextTowerStaffingByAirport,
        specialtySummary: nextSpecialty,
        ...(SHOW_EVENT_SPLIT_SUMMARY ? { eventSplitSummary: nextEventSplit } : {}),
        airportQueueSummary: queueRows,
        perfMetrics: nextPerfMetrics,
      });
    } catch (fetchError) {
      if (fetchError?.name === "AbortError") {
        return;
      }
      if (requestId !== fetchRequestIdRef.current) {
        return;
      }
      setError(fetchError.message || "Data fetch failed");
      setProcessingStatus("Fetch error");
      const nextRefresh = Date.now() + REFRESH_MS;
      setNextRefreshAt(nextRefresh);
      nextRefreshAtRef.current = nextRefresh;
    } finally {
      if (requestId === fetchRequestIdRef.current) {
        setIsLoading(false);
        isFetchingRef.current = false;
      }
    }
  }, [allTraconVolumePolygons, eventSplits, excludeTraconVolumesInSummary, queueBoxes, sectorIndex]);

  useEffect(() => {
    const projected = projectedFlightsRef.current || [];
    const nextSpecialty = buildSpecialtySummaryWithTraconToggle(
      projected,
      sectorIndex.specialties,
      excludeTraconVolumesInSummary,
      allTraconVolumePolygons,
    );
    specialtyTickerTokenRef.current = 0;
    setSpecialtyTickerSignals({});
    setSpecialtySummary((previous) =>
      areSummaryRowsEqual(previous, nextSpecialty, ["specialty", "now", "p10", "p20", "p30"])
        ? previous
        : nextSpecialty,
    );
  }, [allTraconVolumePolygons, excludeTraconVolumesInSummary, sectorIndex.specialties]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const saved = window.localStorage.getItem(SPECIALTY_BAND_STORAGE_KEY);
    if (!saved) {
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      setSpecialtyBandThresholdsBySpecialty(normalizeSpecialtyThresholdMap(parsed));
    } catch {
      // Ignore malformed localStorage values and keep defaults.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      SPECIALTY_BAND_STORAGE_KEY,
      JSON.stringify(specialtyBandThresholdsBySpecialty),
    );
  }, [specialtyBandThresholdsBySpecialty]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const saved = window.localStorage.getItem(EVENT_SPLIT_BAND_STORAGE_KEY);
    if (!saved) {
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      setEventSplitBandThresholdsByName(normalizeSpecialtyThresholdMap(parsed));
    } catch {
      // Ignore malformed localStorage values and keep defaults.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      EVENT_SPLIT_BAND_STORAGE_KEY,
      JSON.stringify(eventSplitBandThresholdsByName),
    );
  }, [eventSplitBandThresholdsByName]);

  useEffect(() => {
    const snapshot = readTfmsSnapshot();
    if (!snapshot) {
      return;
    }
    if (Array.isArray(snapshot.controllers)) {
      setControllers(snapshot.controllers);
    }
    if (Array.isArray(snapshot.traconStaffing)) {
      setTraconStaffing(snapshot.traconStaffing);
    }
    if (snapshot?.towerStaffingByAirport && typeof snapshot.towerStaffingByAirport === "object") {
      setTowerStaffingByAirport(snapshot.towerStaffingByAirport);
    }
    if (Array.isArray(snapshot.specialtySummary)) {
      setSpecialtySummary(snapshot.specialtySummary);
    }
    if (SHOW_EVENT_SPLIT_SUMMARY && Array.isArray(snapshot.eventSplitSummary)) {
      setEventSplitSummary(snapshot.eventSplitSummary);
    }
    if (Array.isArray(snapshot.airportQueueSummary)) {
      setAirportQueueSummary(snapshot.airportQueueSummary);
      previousAirportQueueByIcaoRef.current = Object.fromEntries(
        snapshot.airportQueueSummary.map((row) => [row.icao, row]),
      );
    }
    if (snapshot?.perfMetrics && typeof snapshot.perfMetrics === "object") {
      setPerfMetrics(snapshot.perfMetrics);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refreshData();

    const timer = setInterval(() => {
      if (Date.now() >= nextRefreshAtRef.current && !isFetchingRef.current) {
        refreshData();
      }
    }, 1000);

    return () => {
      clearInterval(timer);
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort();
      }
    };
  }, [refreshData]);

  const feedTone = error ? "red" : isLoading ? "yellow" : "green";
  const updateSpecialtyBandThresholds = useCallback((specialty, nextPartial) => {
    const specialtyKey = normalizeSpecialtyKey(specialty);
    if (!specialtyKey) {
      return;
    }
    setSpecialtyBandThresholdsBySpecialty((previous) => {
      const current = getThresholdsForSpecialty(previous, specialtyKey);
      return {
        ...previous,
        [specialtyKey]: normalizeBandThresholds({
          greenMax: nextPartial.greenMax ?? current.greenMax,
          yellowMax: nextPartial.yellowMax ?? current.yellowMax,
        }),
      };
    });
  }, []);
  const resetSpecialtyBandThresholds = useCallback((specialty) => {
    const specialtyKey = normalizeSpecialtyKey(specialty);
    if (!specialtyKey) {
      return;
    }
    setSpecialtyBandThresholdsBySpecialty((previous) => {
      return {
        ...previous,
        [specialtyKey]: { ...DEFAULT_SPECIALTY_BAND_THRESHOLDS },
      };
    });
  }, []);
  const applySelectedThresholdsToAllSpecialties = useCallback(() => {
    if (!selectedSpecialtyForThresholds) {
      return;
    }
    const selectedThresholds = getThresholdsForSpecialty(
      specialtyBandThresholdsBySpecialty,
      selectedSpecialtyForThresholds,
    );
    const next = {};
    for (const specialty of sectorIndex.specialties || []) {
      const specialtyKey = normalizeSpecialtyKey(specialty);
      if (!specialtyKey) {
        continue;
      }
      next[specialtyKey] = { ...selectedThresholds };
    }
    setSpecialtyBandThresholdsBySpecialty(next);
  }, [sectorIndex.specialties, selectedSpecialtyForThresholds, specialtyBandThresholdsBySpecialty]);
  const resetAllSpecialtyBandThresholds = useCallback(() => {
    setSpecialtyBandThresholdsBySpecialty({});
  }, []);
  const applySelectedThresholdsToAllSpecialtiesAndClose = useCallback(() => {
    applySelectedThresholdsToAllSpecialties();
    setSelectedSpecialtyForThresholds(null);
  }, [applySelectedThresholdsToAllSpecialties]);
  const openSpecialtyThresholdModal = useCallback((specialty, anchorRect) => {
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
    const modalWidthEstimate = 480;
    const modalHeightEstimate = 320;
    const margin = 12;
    const anchorX = Number.isFinite(anchorRect?.left) ? anchorRect.left + 8 : 24;
    const anchorY = Number.isFinite(anchorRect?.top) ? anchorRect.top + 8 : 24;
    const x = Math.min(
      Math.max(margin, anchorX),
      Math.max(margin, viewportWidth - modalWidthEstimate - margin),
    );
    const y = Math.min(
      Math.max(margin, anchorY),
      Math.max(margin, viewportHeight - modalHeightEstimate - margin),
    );
    setSpecialtyModalPosition({ x, y });
    setSelectedSpecialtyForThresholds(specialty);
  }, []);
  const selectedSpecialtyThresholds = useMemo(
    () => getThresholdsForSpecialty(specialtyBandThresholdsBySpecialty, selectedSpecialtyForThresholds),
    [selectedSpecialtyForThresholds, specialtyBandThresholdsBySpecialty],
  );
  const greenUpperExclusive = selectedSpecialtyThresholds.greenMax + 1;
  const yellowLowerBound = selectedSpecialtyThresholds.greenMax + 1;
  const yellowUpperBound = selectedSpecialtyThresholds.yellowMax;
  const redLowerExclusive = selectedSpecialtyThresholds.yellowMax;
  const greenPercent = (selectedSpecialtyThresholds.greenMax / SPECIALTY_THRESHOLD_MAX) * 100;
  const yellowPercent = (selectedSpecialtyThresholds.yellowMax / SPECIALTY_THRESHOLD_MAX) * 100;
  const thresholdTrackBackground = `linear-gradient(to right,
    color-mix(in srgb, #22c55e 65%, white) 0%,
    color-mix(in srgb, #22c55e 65%, white) ${greenPercent}%,
    color-mix(in srgb, #eab308 62%, white) ${greenPercent}%,
    color-mix(in srgb, #eab308 62%, white) ${yellowPercent}%,
    color-mix(in srgb, #ef4444 62%, white) ${yellowPercent}%,
    color-mix(in srgb, #ef4444 62%, white) 100%)`;

  const updateEventSplitBandThresholds = useCallback((splitName, nextPartial) => {
    const splitKey = normalizeSpecialtyKey(splitName);
    if (!splitKey) {
      return;
    }
    setEventSplitBandThresholdsByName((previous) => {
      const current = getThresholdsForSpecialty(previous, splitKey);
      return {
        ...previous,
        [splitKey]: normalizeBandThresholds({
          greenMax: nextPartial.greenMax ?? current.greenMax,
          yellowMax: nextPartial.yellowMax ?? current.yellowMax,
        }),
      };
    });
  }, []);
  const resetEventSplitBandThresholds = useCallback((splitName) => {
    const splitKey = normalizeSpecialtyKey(splitName);
    if (!splitKey) {
      return;
    }
    setEventSplitBandThresholdsByName((previous) => ({
      ...previous,
      [splitKey]: { ...DEFAULT_SPECIALTY_BAND_THRESHOLDS },
    }));
  }, []);
  const applySelectedThresholdsToAllEventSplits = useCallback(() => {
    if (!selectedEventSplitForThresholds) {
      return;
    }
    const selectedThresholds = getThresholdsForSpecialty(
      eventSplitBandThresholdsByName,
      selectedEventSplitForThresholds,
    );
    const next = {};
    for (const splitName of Object.keys(eventSplits || {})) {
      const splitKey = normalizeSpecialtyKey(splitName);
      if (!splitKey) {
        continue;
      }
      next[splitKey] = { ...selectedThresholds };
    }
    setEventSplitBandThresholdsByName(next);
  }, [eventSplitBandThresholdsByName, eventSplits, selectedEventSplitForThresholds]);
  const resetAllEventSplitBandThresholds = useCallback(() => {
    setEventSplitBandThresholdsByName({});
  }, []);
  const applySelectedThresholdsToAllEventSplitsAndClose = useCallback(() => {
    applySelectedThresholdsToAllEventSplits();
    setSelectedEventSplitForThresholds(null);
  }, [applySelectedThresholdsToAllEventSplits]);
  const openEventSplitThresholdModal = useCallback((splitName, anchorRect) => {
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
    const modalWidthEstimate = 480;
    const modalHeightEstimate = 320;
    const margin = 12;
    const anchorX = Number.isFinite(anchorRect?.left) ? anchorRect.left + 8 : 24;
    const anchorY = Number.isFinite(anchorRect?.top) ? anchorRect.top + 8 : 24;
    const x = Math.min(
      Math.max(margin, anchorX),
      Math.max(margin, viewportWidth - modalWidthEstimate - margin),
    );
    const y = Math.min(
      Math.max(margin, anchorY),
      Math.max(margin, viewportHeight - modalHeightEstimate - margin),
    );
    setEventSplitModalPosition({ x, y });
    setSelectedEventSplitForThresholds(splitName);
  }, []);
  const selectedEventSplitThresholds = useMemo(
    () => getThresholdsForSpecialty(eventSplitBandThresholdsByName, selectedEventSplitForThresholds),
    [eventSplitBandThresholdsByName, selectedEventSplitForThresholds],
  );
  const splitGreenUpperExclusive = selectedEventSplitThresholds.greenMax + 1;
  const splitYellowLowerBound = selectedEventSplitThresholds.greenMax + 1;
  const splitYellowUpperBound = selectedEventSplitThresholds.yellowMax;
  const splitRedLowerExclusive = selectedEventSplitThresholds.yellowMax;
  const splitGreenPercent = (selectedEventSplitThresholds.greenMax / SPECIALTY_THRESHOLD_MAX) * 100;
  const splitYellowPercent = (selectedEventSplitThresholds.yellowMax / SPECIALTY_THRESHOLD_MAX) * 100;
  const splitThresholdTrackBackground = `linear-gradient(to right,
    color-mix(in srgb, #22c55e 65%, white) 0%,
    color-mix(in srgb, #22c55e 65%, white) ${splitGreenPercent}%,
    color-mix(in srgb, #eab308 62%, white) ${splitGreenPercent}%,
    color-mix(in srgb, #eab308 62%, white) ${splitYellowPercent}%,
    color-mix(in srgb, #ef4444 62%, white) ${splitYellowPercent}%,
    color-mix(in srgb, #ef4444 62%, white) 100%)`;

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-8 pb-28 md:px-10">
      <div className="route-validator-bg" />
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="panel">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-accent text-sm font-semibold uppercase tracking-[0.24em]">Traffic</p>
              <h1 className="font-heading text-main text-4xl font-bold tracking-wide md:text-5xl">
                TFMS
              </h1>
              <p className="text-muted mt-2 max-w-3xl">
                Live ZHU traffic overview with specialty projections at +10, +20, and +30
                minutes.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <ThemeSwitcher />
              <Link className="button-secondary text-sm" href="/">
                Back to Toolkit
              </Link>
              <button
                className="button-secondary text-sm"
                onClick={() => {
                  setIsProjectionInfoOpen(false);
                  setIsToolInfoOpen(true);
                }}
                type="button"
              >
                Tool Info
              </button>
            </div>
          </div>

        </header>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="panel tfms-compact-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-heading text-main text-2xl">Specialty Summary</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSpecialtyLogToggle}
                  className={`rounded-lg border px-3 py-1 text-xs font-semibold transition-colors ${
                    specialtyLogActive
                      ? "border-red-500/40 text-red-400 hover:border-red-500/70 hover:bg-red-500/10 hover:text-red-300"
                      : "border-emerald-500/40 text-emerald-400 hover:border-emerald-500/70 hover:bg-emerald-500/10 hover:text-emerald-300"
                  }`}
                >
                  {specialtyLogActive ? `Stop & Export (${specialtyLogEntries.length})` : "Start Logging"}
                </button>
              <label className="toggle-chip border-default bg-surface-soft text-muted inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
                <input
                  className="sr-only peer"
                  checked={excludeTraconVolumesInSummary}
                  onChange={(event) => setExcludeTraconVolumesInSummary(event.target.checked)}
                  type="checkbox"
                />
                <span className="toggle-chip-dot" aria-hidden="true" />
                <span>Exclude TRACON Volumes</span>
              </label>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="tfms-table tfms-specialty-table tfms-compact-table min-w-full">
                <thead>
                  <tr>
                    <th>Specialty</th>
                    <th>Now</th>
                    <th>+10</th>
                    <th>+20</th>
                    <th>+30</th>
                  </tr>
                </thead>
                <tbody>
                  {specialtyDisplay.map((row) => {
                    const thresholds = getThresholdsForSpecialty(
                      specialtyBandThresholdsBySpecialty,
                      row.specialty,
                    );
                    const rowTone = getSpecialtyRowTone(row, thresholds);
                    const rowClassName =
                      rowTone === "alert"
                        ? "tfms-row-alert"
                        : rowTone === "warning"
                          ? "tfms-row-warning"
                          : "";
                    return (
                    <tr className={rowClassName} key={row.specialty}>
                      <td>
                        <button
                          className="text-main tfms-specialty-name-button tfms-specialty-chip-button"
                          style={getSpecialtyChipStyle(row.specialty)}
                          onClick={(event) =>
                            openSpecialtyThresholdModal(
                              row.specialty,
                              event.currentTarget.getBoundingClientRect(),
                            )
                          }
                          type="button"
                        >
                          {row.specialty}
                        </button>
                      </td>
                      <td>
                        <CountBadge
                          key={`${row.specialty}-now-${specialtyTickerSignals[`${row.specialty}:now`]?.token || 0}`}
                          thresholds={thresholds}
                          tickerSignal={specialtyTickerSignals[`${row.specialty}:now`]}
                          title={
                            specialtyCallsignsByBucket[`${row.specialty}:now`]?.length
                              ? specialtyCallsignsByBucket[`${row.specialty}:now`].join(", ")
                              : "No included aircraft."
                          }
                          value={row.now}
                        />
                      </td>
                      <td>
                        <CountBadge
                          key={`${row.specialty}-p10-${specialtyTickerSignals[`${row.specialty}:p10`]?.token || 0}`}
                          thresholds={thresholds}
                          tickerSignal={specialtyTickerSignals[`${row.specialty}:p10`]}
                          title={
                            specialtyCallsignsByBucket[`${row.specialty}:p10`]?.length
                              ? specialtyCallsignsByBucket[`${row.specialty}:p10`].join(", ")
                              : "No included aircraft."
                          }
                          value={row.p10 ?? 0}
                        />
                      </td>
                      <td>
                        <CountBadge
                          key={`${row.specialty}-p20-${specialtyTickerSignals[`${row.specialty}:p20`]?.token || 0}`}
                          thresholds={thresholds}
                          tickerSignal={specialtyTickerSignals[`${row.specialty}:p20`]}
                          title={
                            specialtyCallsignsByBucket[`${row.specialty}:p20`]?.length
                              ? specialtyCallsignsByBucket[`${row.specialty}:p20`].join(", ")
                              : "No included aircraft."
                          }
                          value={row.p20 ?? 0}
                        />
                      </td>
                      <td>
                        <CountBadge
                          key={`${row.specialty}-p30-${specialtyTickerSignals[`${row.specialty}:p30`]?.token || 0}`}
                          thresholds={thresholds}
                          tickerSignal={specialtyTickerSignals[`${row.specialty}:p30`]}
                          title={
                            specialtyCallsignsByBucket[`${row.specialty}:p30`]?.length
                              ? specialtyCallsignsByBucket[`${row.specialty}:p30`].join(", ")
                              : "No included aircraft."
                          }
                          value={row.p30 ?? row.p10 ?? 0}
                        />
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel tfms-compact-card">
            <h2 className="font-heading text-main text-2xl">Online Positions</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="tfms-table tfms-compact-table min-w-full">
                <thead>
                  <tr>
                    <th>Sector</th>
                    <th>Name</th>
                    <th>CID</th>
                    <th>Online</th>
                  </tr>
                </thead>
                <tbody>
                  {enrouteDisplay.length === 0 ? (
                    <tr>
                      <td className="text-muted" colSpan={4}>
                        No enroute controllers online.
                      </td>
                    </tr>
                  ) : (
                    enrouteDisplay.map((controller) => (
                      <tr key={`${controller.callsign}-${controller.cid}`}>
                        <td>
                          {formatEnroutePosition(controller.callsign)}
                          {isReliefSignOn(controller.callsign) ? (
                            <span className="text-muted ml-1 text-[10px] align-super">(relief)</span>
                          ) : null}
                        </td>
                        <td>{controller.name || "-"}</td>
                        <td>{controller.cid || "-"}</td>
                        <td>{formatOnlineDuration(controller.logon_time)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        {SHOW_EVENT_SPLIT_SUMMARY ? (
          <section>
            <article className="panel tfms-compact-card">
              <h2 className="font-heading text-main text-2xl">Texas Triangle 3/27/26</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="tfms-table tfms-specialty-table tfms-compact-table min-w-full">
                  <thead>
                    <tr>
                      <th>Split</th>
                      <th>Now</th>
                      <th>+10</th>
                      <th>+20</th>
                      <th>+30</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventSplitDisplay.map((row) => {
                      const thresholds = getThresholdsForSpecialty(
                        eventSplitBandThresholdsByName,
                        row.name,
                      );
                      const rowTone = getSpecialtyRowTone(row, thresholds);
                      const rowClassName =
                        rowTone === "alert"
                          ? "tfms-row-alert"
                          : rowTone === "warning"
                            ? "tfms-row-warning"
                            : "";
                      return (
                      <tr className={rowClassName} key={row.name}>
                        <td>
                          <button
                            className="text-main tfms-specialty-name-button"
                            onClick={(event) =>
                              openEventSplitThresholdModal(
                                row.name,
                                event.currentTarget.getBoundingClientRect(),
                              )
                            }
                            type="button"
                          >
                            {row.name}
                          </button>
                        </td>
                        <td>
                          <CountBadge
                            key={`${row.name}-now-${eventSplitTickerSignals[`${row.name}:now`]?.token || 0}`}
                            thresholds={thresholds}
                            tickerSignal={eventSplitTickerSignals[`${row.name}:now`]}
                            value={row.now}
                          />
                        </td>
                        <td>
                          <CountBadge
                            key={`${row.name}-p10-${eventSplitTickerSignals[`${row.name}:p10`]?.token || 0}`}
                            thresholds={thresholds}
                            tickerSignal={eventSplitTickerSignals[`${row.name}:p10`]}
                            value={row.p10 ?? 0}
                          />
                        </td>
                        <td>
                          <CountBadge
                            key={`${row.name}-p20-${eventSplitTickerSignals[`${row.name}:p20`]?.token || 0}`}
                            thresholds={thresholds}
                            tickerSignal={eventSplitTickerSignals[`${row.name}:p20`]}
                            value={row.p20 ?? 0}
                          />
                        </td>
                        <td>
                          <CountBadge
                            key={`${row.name}-p30-${eventSplitTickerSignals[`${row.name}:p30`]?.token || 0}`}
                            thresholds={thresholds}
                            tickerSignal={eventSplitTickerSignals[`${row.name}:p30`]}
                            value={row.p30 ?? 0}
                          />
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        ) : null}

        <section>
          <article className="panel tfms-compact-card">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-main text-2xl">Enhanced Projection Map</h2>
              <button
                className="button-secondary px-3 py-1.5 text-xs"
                onClick={() => setIsMapVisible((value) => !value)}
                type="button"
              >
                {isMapVisible ? "Hide Map" : "Show Map"}
              </button>
            </div>
            {isMapVisible ? (
              <div className="mt-3">
                <MapErrorBoundary>
                  <TfmsProjectionMap
                    flights={mapFlights}
                    sectorLayerOutlines={sectorLayerOutlines}
                    specialtyBounds={specialtyBounds}
                    zhuPerimeter={sectorIndex.zhuPerimeter}
                  />
                </MapErrorBoundary>
              </div>
            ) : (
              <p className="text-muted mt-3 text-sm">
                Map hidden. Click Show Map to display enhanced projection tracks.
              </p>
            )}
          </article>
        </section>

        <section>
          <article className="panel tfms-compact-card">
            <h2 className="font-heading text-main text-2xl">TRACON Summary</h2>
            <div className="mt-3 space-y-4">
              <div>
                <div className="tfms-tracon-core-grid" aria-label="TRACON core summary">
                  {traconCoreCards.map((card) => (
                    <div className="tfms-tracon-core-column" key={card.id}>
                      <div
                        className="tfms-tracon-core-card"
                        title={
                          card.callsigns?.length
                            ? `Included aircraft: ${card.callsigns.join(", ")}`
                            : "No aircraft currently counted in this TRACON volume."
                        }
                      >
                        <div className="tfms-tracon-core-header">
                          <div className="tfms-tracon-kpi-left">
                            <p className="tfms-tracon-kpi-id text-main text-lg font-semibold tracking-[0.08em]">{card.id}</p>
                          </div>
                          <p className="tfms-tracon-core-airborne-header-value text-main text-lg font-semibold tracking-[0.08em]">
                            {card.aircraftCount}
                          </p>
                          <span
                            className={`tfms-core-status-pill ${
                              card.staffed ? "tfms-core-status-pill-online" : "tfms-core-status-pill-offline"
                            }`}
                          >
                            APP {card.staffed ? "Online" : "Offline"}
                          </span>
                        </div>
                        <div className="tfms-tracon-core-stat-list text-main">
                          <div className="tfms-tracon-core-metrics-inline" aria-label="Core traffic split">
                            <div className="tfms-tracon-core-metric-cell" aria-label="Arrivals" title="Arrivals">
                              <span className="tfms-tracon-core-metric-icon">
                                <TraconFlowIcon type="arrival" />
                              </span>
                              <span>{card.arrivalsCount}</span>
                            </div>
                            <div className="tfms-tracon-core-metric-cell" aria-label="Departures" title="Departures">
                              <span className="tfms-tracon-core-metric-icon">
                                <TraconFlowIcon type="departure" />
                              </span>
                              <span>{card.departuresCount}</span>
                            </div>
                            <div className="tfms-tracon-core-metric-cell" aria-label="Overflights" title="Overflights">
                              <span className="tfms-tracon-core-metric-icon">
                                <TraconFlowIcon type="overflight" />
                              </span>
                              <span>{card.overflightsCount}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className={`tfms-tracon-airport-stack ${card.queueAirports.length > 1 ? "tfms-tracon-airport-stack-two" : ""}`}>
                        {card.queueAirports.map((airport) => (
                          <div className="tfms-tracon-airport-card" key={`${card.id}-${airport.icao}`}>
                            <div className="tfms-tracon-airport-card-header">
                              <p className="tfms-tracon-airport-card-title">{airport.label}</p>
                              <span
                                className={`tfms-core-status-pill ${
                                  airport.towerOnline ? "tfms-core-status-pill-online" : "tfms-core-status-pill-offline"
                                }`}
                              >
                                TWR {airport.towerOnline ? "Online" : "Offline"}
                              </span>
                            </div>
                            <div className="tfms-tracon-core-stat-row">
                              <span>Queue</span>
                              <span>{airport.count}</span>
                            </div>
                            <div className="tfms-tracon-core-stat-row">
                              <span>Avg</span>
                              <span>{formatQueueMinutes(airport.avgMinutes)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="tfms-tracon-kpi-grid" aria-label="TRACON airborne secondary">
                  {traconRemainingOnlineAirborne.map((facility) => (
                    <div
                      className="tfms-tracon-kpi-card tfms-tracon-kpi-inline tfms-tracon-kpi-offline"
                      key={facility.id}
                      title={
                        facility.callsigns?.length
                          ? `Included aircraft: ${facility.callsigns.join(", ")}`
                          : "No aircraft currently counted in this TRACON volume."
                      }
                    >
                      <div className="tfms-tracon-kpi-inline-row tfms-tracon-kpi-inline-row-airborne">
                        <div className="tfms-tracon-kpi-left">
                          <span
                            className={`tfms-tracon-kpi-dot feed-indicator ${
                              facility.staffed ? "feed-indicator-green" : "feed-indicator-gray feed-indicator-static"
                            }`}
                            title={facility.staffed ? "Online" : "Offline"}
                            role="status"
                            aria-label={facility.staffed ? "Online" : "Offline"}
                          />
                          <p className="tfms-tracon-kpi-id text-main text-sm font-semibold tracking-[0.08em]">{facility.id}</p>
                        </div>
                        <div className="tfms-tracon-kpi-count tfms-tracon-kpi-center text-main text-sm font-semibold tabular-nums">
                          {facility.aircraftCount}
                        </div>
                      </div>
                    </div>
                  ))}
                  {traconRemainingOfflineAirborne.length > 0 ? (
                    <div className="tfms-tracon-offline-group">
                      <span className="tfms-tracon-kpi-card tfms-tracon-kpi-inline tfms-tracon-kpi-offline tfms-tracon-kpi-offline-summary">
                        TRACONs Offline ({traconRemainingOfflineAirborne.length})
                      </span>
                      <div className="tfms-tracon-offline-popover">
                        <div className="tfms-tracon-kpi-grid">
                          {traconRemainingOfflineAirborne.map((facility) => (
                            <span
                              className="tfms-tracon-chip tfms-tracon-chip-compact tfms-tracon-chip-offline"
                              key={facility.id}
                            >
                              {facility.id}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </article>
        </section>

      </div>

      {selectedSpecialtyForThresholds ? (
        <div
          className="bg-black/45 fixed inset-0 z-[1200] p-4"
          onClick={() => setSelectedSpecialtyForThresholds(null)}
        >
          <div
            className="panel absolute w-full max-w-md"
            style={{ left: specialtyModalPosition.x, top: specialtyModalPosition.y }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedSpecialtyForThresholds} Traffic Thresholds`}
          >
            <h3 className="font-heading text-main text-2xl">
              {selectedSpecialtyForThresholds} Traffic Thresholds
            </h3>
            <div className="mt-3 tfms-threshold-control">
              <div className="text-muted flex items-center justify-between text-xs uppercase tracking-[0.1em]">
                <span>Green &lt; {greenUpperExclusive}</span>
                <span>
                  Yellow {yellowLowerBound}-{yellowUpperBound}
                </span>
                <span>Red &gt; {redLowerExclusive}</span>
              </div>
              <div className="tfms-threshold-slider">
                <div className="tfms-threshold-track" style={{ background: thresholdTrackBackground }} />
                <input
                  className="tfms-threshold-input"
                  max={SPECIALTY_THRESHOLD_MAX - 1}
                  min={0}
                  onChange={(event) =>
                    updateSpecialtyBandThresholds(selectedSpecialtyForThresholds, {
                      greenMax: Number(event.target.value || 0),
                    })
                  }
                  type="range"
                  value={selectedSpecialtyThresholds.greenMax}
                />
                <input
                  className="tfms-threshold-input"
                  max={SPECIALTY_THRESHOLD_MAX}
                  min={1}
                  onChange={(event) =>
                    updateSpecialtyBandThresholds(selectedSpecialtyForThresholds, {
                      yellowMax: Number(event.target.value || 0),
                    })
                  }
                  type="range"
                  value={selectedSpecialtyThresholds.yellowMax}
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="button-destructive shrink-0 whitespace-nowrap px-3 py-1.5 text-xs"
                onClick={() => {
                  resetAllSpecialtyBandThresholds();
                  setSelectedSpecialtyForThresholds(null);
                }}
                type="button"
              >
                Reset All
              </button>
              <button
                className="button-destructive shrink-0 whitespace-nowrap px-3 py-1.5 text-xs"
                onClick={() => {
                  resetSpecialtyBandThresholds(selectedSpecialtyForThresholds);
                }}
                type="button"
              >
                Reset {selectedSpecialtyForThresholds}
              </button>
              <button
                className="button-primary shrink-0 whitespace-nowrap px-3 py-1.5 text-xs"
                onClick={applySelectedThresholdsToAllSpecialtiesAndClose}
                type="button"
              >
                Apply All
              </button>
              <button
                className="button-primary shrink-0 whitespace-nowrap px-3 py-1.5 text-xs"
                onClick={() => setSelectedSpecialtyForThresholds(null)}
                type="button"
              >
                Apply {selectedSpecialtyForThresholds}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {SHOW_EVENT_SPLIT_SUMMARY && selectedEventSplitForThresholds ? (
        <div
          className="bg-black/45 fixed inset-0 z-[1200] p-4"
          onClick={() => setSelectedEventSplitForThresholds(null)}
        >
          <div
            className="panel absolute w-full max-w-md"
            style={{ left: eventSplitModalPosition.x, top: eventSplitModalPosition.y }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedEventSplitForThresholds} Traffic Thresholds`}
          >
            <h3 className="font-heading text-main text-2xl">
              {selectedEventSplitForThresholds} Traffic Thresholds
            </h3>
            <div className="mt-3 tfms-threshold-control">
              <div className="text-muted flex items-center justify-between text-xs uppercase tracking-[0.1em]">
                <span>Green &lt; {splitGreenUpperExclusive}</span>
                <span>
                  Yellow {splitYellowLowerBound}-{splitYellowUpperBound}
                </span>
                <span>Red &gt; {splitRedLowerExclusive}</span>
              </div>
              <div className="tfms-threshold-slider">
                <div className="tfms-threshold-track" style={{ background: splitThresholdTrackBackground }} />
                <input
                  className="tfms-threshold-input"
                  max={SPECIALTY_THRESHOLD_MAX - 1}
                  min={0}
                  onChange={(event) =>
                    updateEventSplitBandThresholds(selectedEventSplitForThresholds, {
                      greenMax: Number(event.target.value || 0),
                    })
                  }
                  type="range"
                  value={selectedEventSplitThresholds.greenMax}
                />
                <input
                  className="tfms-threshold-input"
                  max={SPECIALTY_THRESHOLD_MAX}
                  min={1}
                  onChange={(event) =>
                    updateEventSplitBandThresholds(selectedEventSplitForThresholds, {
                      yellowMax: Number(event.target.value || 0),
                    })
                  }
                  type="range"
                  value={selectedEventSplitThresholds.yellowMax}
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="button-destructive shrink-0 whitespace-nowrap px-3 py-1.5 text-xs"
                onClick={() => {
                  resetAllEventSplitBandThresholds();
                  setSelectedEventSplitForThresholds(null);
                }}
                type="button"
              >
                Reset All
              </button>
              <button
                className="button-destructive shrink-0 whitespace-nowrap px-3 py-1.5 text-xs"
                onClick={() => {
                  resetEventSplitBandThresholds(selectedEventSplitForThresholds);
                }}
                type="button"
              >
                Reset {selectedEventSplitForThresholds}
              </button>
              <button
                className="button-primary shrink-0 whitespace-nowrap px-3 py-1.5 text-xs"
                onClick={applySelectedThresholdsToAllEventSplitsAndClose}
                type="button"
              >
                Apply All
              </button>
              <button
                className="button-primary shrink-0 whitespace-nowrap px-3 py-1.5 text-xs"
                onClick={() => setSelectedEventSplitForThresholds(null)}
                type="button"
              >
                Apply {selectedEventSplitForThresholds}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isToolInfoOpen ? (
        <div
          className="bg-black/45 fixed inset-0 z-[1200] flex items-center justify-center p-4"
          onClick={() => {
            setIsProjectionInfoOpen(false);
            setIsToolInfoOpen(false);
          }}
        >
          <div
            className="panel w-full max-w-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="TFMS Tool Info"
          >
            <h3 className="font-heading text-main text-2xl">TFMS Tool Use, Features, and Limitations</h3>
            <div className="text-muted mt-3 space-y-3 text-sm">
              <div>
                <p className="text-main text-xs font-semibold uppercase tracking-[0.12em]">Use</p>
                <p className="mt-1">
                  Use this page to monitor ZHU traffic load, see short-horizon projections (+10/+20/+30),
                  track enroute staffing, and manage terminal traffic with the TRACON Summary cards.
                </p>
              </div>
              <div>
                <p className="text-main text-xs font-semibold uppercase tracking-[0.12em]">Features</p>
                <p className="mt-2">
                  To set Specialty Summary thresholds: click a specialty name in the table, adjust the
                  Green and Yellow slider handles in that specialty modal, then use <span className="text-main font-semibold">Apply {`<SPECIALTY>`}</span> for one specialty or <span className="text-main font-semibold">Apply All</span> for all specialties.
                </p>
                <p className="mt-2">
                  TRACON Summary core cards (I90, AUS, SAT, MSY) show total airborne count plus
                  arrivals, departures, and overflights for each TRACON volume. Airport subcards beneath
                  each core card show queue count and average queue time, plus a TWR online/offline chip.
                </p>
                <p className="mt-2">
                  Non-core TRACONs are shown as compact airborne cards when staffed. Offline facilities are
                  consolidated behind the <span className="text-main font-semibold">TRACONs Offline (N)</span> chip.
                </p>
                <p className="mt-2">
                  Queue counts only include aircraft filed from that airport while inside configured
                  hold-short queue areas. They do not represent all aircraft on the airport surface.
                </p>
              </div>
              <div>
                <p className="text-main text-xs font-semibold uppercase tracking-[0.12em]">Limitations</p>
                <p className="mt-1">
                  Projections are estimate-based from VATSIM feed updates and motion modeling; they are a
                  situational aid and should not be treated as authoritative control instructions.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="button-secondary px-3 py-1.5 text-xs"
                onClick={() => setIsProjectionInfoOpen(true)}
                type="button"
              >
                More About Projections
              </button>
              <button
                className="button-primary px-3 py-1.5 text-xs"
                onClick={() => {
                  setIsProjectionInfoOpen(false);
                  setIsToolInfoOpen(false);
                }}
                type="button"
              >
                Close
              </button>
            </div>

            {isProjectionInfoOpen ? (
              <div
                className="bg-black/45 absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] p-4"
                onClick={() => setIsProjectionInfoOpen(false)}
              >
                <div
                  className="panel w-full max-w-xl"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-label="More About Projections"
                >
                  <h4 className="font-heading text-main text-xl">More About Projections</h4>
                  <div className="text-muted mt-3 space-y-2 text-sm">
                    <p>
                      This page updates every minute using live VATSIM data.
                    </p>
                    <p>
                      Aircraft are included when they are in Houston Center airspace now, close to entering it,
                      or inbound to airports we track for Houston operations.
                    </p>
                    <p>
                      The traffic numbers are shown for <span className="text-main font-semibold">Now, +10, +20, and +30 minutes</span> to give a short look-ahead for planning.
                    </p>
                    <p className="text-main text-xs font-semibold uppercase tracking-[0.12em] pt-1">
                      What The Projection Does
                    </p>
                    <p>
                      It takes recent position, heading, speed, and altitude data and estimates where each aircraft
                      will be in the next few buckets. It then maps those estimated positions back into ZHU sector
                      geometry to build workload-style counts.
                    </p>
                    <p className="text-main text-xs font-semibold uppercase tracking-[0.12em] pt-1">
                      What It Does Not Do
                    </p>
                    <p>
                      It does not perform full route-intent modeling. It does not predict exact turns, clearances,
                      reroutes, or tactical vectoring. It uses a short recent motion snapshot to extrapolate.
                    </p>
                    <p>
                      Overflights are included in traffic totals if they meet selection logic, but they are not
                      currently broken out as a separate view in the projection/specialty summary tables.
                    </p>
                    <p>
                      Treat this as a trend and planning aid, not an exact future traffic picture.
                    </p>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      className="button-primary px-3 py-1.5 text-xs"
                      onClick={() => setIsProjectionInfoOpen(false)}
                      type="button"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <FeedFooter
        error={error}
        feedTone={feedTone}
        nextRefreshAt={nextRefreshAt}
        perfMetrics={perfMetrics}
        processingStatus={processingStatus}
      />
    </main>
  );
}
