"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ThemeSwitcher from "@/components/theme-switcher";
import sectorsGeoJson from "@/data/tfms-sectors.json";
import airportQueueBoxes from "@/data/tfms-airport-queue-boxes.json";
import {
  buildPilotMotionModel,
  buildTraconStaffing,
  buildSectorIndex,
  buildSpecialtySummary,
  computeProjectedFlights,
  getZhuEnrouteControllers,
} from "@/lib/tfms/compute";

const VATSIM_API = "https://data.vatsim.net/v3/vatsim-data.json";
const REFRESH_MS = 60_000;
const TFMS_SNAPSHOT_STORAGE_KEY = "tfms-viewer-snapshot-v2";
const SNAPSHOT_MAX_AGE_MS = 5 * 60_000;
const SPECIALTY_THRESHOLD_MAX = 30;
const SPECIALTY_BAND_STORAGE_KEY = "tfms-specialty-band-thresholds-by-specialty";
const DEFAULT_SPECIALTY_BAND_THRESHOLDS = { greenMax: 10, yellowMax: 20 };
const QUEUE_ALTITUDE_MAX_FT = 5_000;
const QUEUE_GROUNDSPEED_MAX_KTS = 80;
const QUEUE_TREND_THRESHOLD = 0.25;

function normalizeSpecialtyKey(value) {
  return String(value || "").trim().toUpperCase();
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

function CountBadge({ value, thresholds, tickerSignal }) {
  const flashClass =
    tickerSignal?.direction === "up"
      ? "tfms-count-tick-down"
      : tickerSignal?.direction === "down"
        ? "tfms-count-tick-up"
        : "";
  return <span className={`tfms-count ${getBandClass(value, thresholds)} ${flashClass}`}>{value}</span>;
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

function normalizeAirportCode(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) {
    return "";
  }
  if (/^[A-Z]{3}$/.test(text)) {
    return `K${text}`;
  }
  if (/^[A-Z0-9]{4}$/.test(text)) {
    return text;
  }
  return "";
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonCoordinates(point, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return false;
  }
  if (!pointInRing(point, coordinates[0])) {
    return false;
  }
  for (let i = 1; i < coordinates.length; i += 1) {
    if (pointInRing(point, coordinates[i])) {
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

function getQueuePressureClass(avgMinutes) {
  if (avgMinutes < 5) return "tfms-queue-green";
  if (avgMinutes < 10) return "tfms-queue-yellow";
  return "tfms-queue-red";
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
  const [specialtySummary, setSpecialtySummary] = useState([]);
  const [airportQueueSummary, setAirportQueueSummary] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingStatus, setProcessingStatus] = useState("Starting...");
  const [error, setError] = useState("");
  const [nextRefreshAt, setNextRefreshAt] = useState(Date.now() + REFRESH_MS);
  const [perfMetrics, setPerfMetrics] = useState(null);
  const [specialtyBandThresholdsBySpecialty, setSpecialtyBandThresholdsBySpecialty] = useState({});
  const [specialtyTickerSignals, setSpecialtyTickerSignals] = useState({});
  const [selectedSpecialtyForThresholds, setSelectedSpecialtyForThresholds] = useState(null);
  const [specialtyModalPosition, setSpecialtyModalPosition] = useState({ x: 24, y: 24 });
  const [isToolInfoOpen, setIsToolInfoOpen] = useState(false);
  const [isProjectionInfoOpen, setIsProjectionInfoOpen] = useState(false);
  const isFetchingRef = useRef(false);
  const nextRefreshAtRef = useRef(Date.now() + REFRESH_MS);
  const fetchAbortRef = useRef(null);
  const fetchRequestIdRef = useRef(0);
  const projectedFlightsRef = useRef([]);
  const pilotMotionByCallsignRef = useRef({});
  const specialtyTickerTokenRef = useRef(0);
  const airportQueueTrackerRef = useRef({});
  const previousAirportQueueByIcaoRef = useRef({});

  const sectorIndex = useMemo(() => buildSectorIndex(sectorsGeoJson), []);
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
  const airportQueueDisplay = useMemo(
    () => (airportQueueSummary.length > 0 ? airportQueueSummary : defaultAirportQueueSummary),
    [airportQueueSummary, defaultAirportQueueSummary],
  );
  const baseTraconStaffing = useMemo(
    () => buildTraconStaffing({ controllers: [] }),
    [],
  );
  const traconStaffingDisplay = useMemo(
    () => (traconStaffing.length > 0 ? traconStaffing : baseTraconStaffing),
    [baseTraconStaffing, traconStaffing],
  );
  const traconDisplay = useMemo(
    () =>
      traconStaffingDisplay
        .slice()
        .sort((a, b) => {
          if (a.staffed !== b.staffed) {
            return a.staffed ? -1 : 1;
          }
          return a.id.localeCompare(b.id);
        }),
    [traconStaffingDisplay],
  );
  const traconSortPriority = useCallback((id) => {
    const priorityOrder = ["I90", "AUS", "SAT", "MSY"];
    return priorityOrder.indexOf(id);
  }, []);
  const traconOnlineDisplay = useMemo(
    () =>
      traconDisplay
        .filter((facility) => facility.staffed)
        .sort((a, b) => {
          const aPriority = traconSortPriority(a.id);
          const bPriority = traconSortPriority(b.id);
          const aPinned = aPriority !== -1;
          const bPinned = bPriority !== -1;
          if (aPinned && bPinned) {
            return aPriority - bPriority;
          }
          if (aPinned && !bPinned) {
            return -1;
          }
          if (bPinned && !aPinned) {
            return 1;
          }
          return a.id.localeCompare(b.id);
        }),
    [traconDisplay, traconSortPriority],
  );
  const traconOfflineDisplay = useMemo(
    () =>
      traconDisplay
        .filter((facility) => !facility.staffed)
        .sort((a, b) => a.id.localeCompare(b.id)),
    [traconDisplay],
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
      const nextPilotMotion = buildPilotMotionModel(vatsim, pilotMotionByCallsignRef.current, sectorIndex);
      const motionDone = performance.now();
      pilotMotionByCallsignRef.current = nextPilotMotion;
      const projected = computeProjectedFlights(vatsim, sectorIndex, nextPilotMotion);
      const projectDone = performance.now();
      projectedFlightsRef.current = projected;
      const nextSpecialty = buildSpecialtySummary(projected, sectorIndex.specialties);
      const queueSummaryResult = buildAirportQueueSummary(
        vatsim.pilots || [],
        queueBoxes,
        airportQueueTrackerRef.current,
        previousAirportQueueByIcaoRef.current,
        Date.now(),
      );
      airportQueueTrackerRef.current = queueSummaryResult.tracker;
      previousAirportQueueByIcaoRef.current = Object.fromEntries(
        queueSummaryResult.rows.map((row) => [row.icao, row]),
      );
      const summaryDone = performance.now();

      setControllers((previous) => (areControllersEqual(previous, zhuControllers) ? previous : zhuControllers));
      setTraconStaffing((previous) =>
        areTraconStatusEqual(previous, nextTraconStaffing) ? previous : nextTraconStaffing,
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
        areSummaryRowsEqual(previous, queueSummaryResult.rows, [
          "icao",
          "count",
          "avgMinutes",
          "maxMinutes",
          "trend",
        ])
          ? previous
          : queueSummaryResult.rows,
      );
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
        specialtySummary: nextSpecialty,
        airportQueueSummary: queueSummaryResult.rows,
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
  }, [queueBoxes, sectorIndex]);

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
    if (Array.isArray(snapshot.specialtySummary)) {
      setSpecialtySummary(snapshot.specialtySummary);
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
            <h2 className="font-heading text-main text-2xl">Specialty Summary</h2>
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
                          className="text-main tfms-specialty-name-button"
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
                          value={row.now}
                        />
                      </td>
                      <td>
                        <CountBadge
                          key={`${row.specialty}-p10-${specialtyTickerSignals[`${row.specialty}:p10`]?.token || 0}`}
                          thresholds={thresholds}
                          tickerSignal={specialtyTickerSignals[`${row.specialty}:p10`]}
                          value={row.p10 ?? 0}
                        />
                      </td>
                      <td>
                        <CountBadge
                          key={`${row.specialty}-p20-${specialtyTickerSignals[`${row.specialty}:p20`]?.token || 0}`}
                          thresholds={thresholds}
                          tickerSignal={specialtyTickerSignals[`${row.specialty}:p20`]}
                          value={row.p20 ?? 0}
                        />
                      </td>
                      <td>
                        <CountBadge
                          key={`${row.specialty}-p30-${specialtyTickerSignals[`${row.specialty}:p30`]?.token || 0}`}
                          thresholds={thresholds}
                          tickerSignal={specialtyTickerSignals[`${row.specialty}:p30`]}
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
            <div className="mt-3 flex flex-wrap gap-1.5 pt-3" aria-label="TRACON Staffing">
              <p className="text-muted w-full text-[11px] font-semibold uppercase tracking-[0.12em]">
                TRACON Online
              </p>
              {traconOnlineDisplay.length > 0 ? (
                traconOnlineDisplay.map((facility) => (
                  <span
                    className="tfms-tracon-chip tfms-tracon-chip-compact tfms-tracon-chip-online"
                    key={facility.id}
                  >
                    <span
                      className="feed-indicator feed-indicator-static feed-indicator-green"
                      aria-hidden="true"
                    />
                    <span className="font-semibold tracking-[0.08em]">{facility.id}</span>
                  </span>
                ))
              ) : null}
              {traconOfflineDisplay.length > 0 ? (
                <div className="tfms-tracon-offline-group" tabIndex={0}>
                  <span className="tfms-tracon-chip tfms-tracon-chip-compact tfms-tracon-chip-offline">
                    <span
                      className="feed-indicator feed-indicator-static feed-indicator-gray"
                      aria-hidden="true"
                    />
                    <span className="font-semibold tracking-[0.08em]">
                      Offline ({traconOfflineDisplay.length})
                    </span>
                  </span>
                  <div className="tfms-tracon-offline-popover">
                    <p className="text-muted text-[10px] font-semibold uppercase tracking-[0.1em]">
                      Offline TRACONs
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {traconOfflineDisplay.map((facility) => (
                        <span
                          className="tfms-tracon-chip tfms-tracon-chip-compact tfms-tracon-chip-offline"
                          key={`offline-${facility.id}`}
                        >
                          <span
                            className="feed-indicator feed-indicator-static feed-indicator-gray"
                            aria-hidden="true"
                          />
                          <span className="font-semibold tracking-[0.08em]">{facility.id}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        </section>

        <section>
          <article className="panel tfms-compact-card">
            <h2 className="font-heading text-main text-2xl">Departure Queue</h2>
            <div className="mt-3 tfms-queue-grid">
              {airportQueueDisplay.map((row) => (
                <div className={`tfms-queue-card ${getQueuePressureClass(row.avgMinutes)}`} key={row.icao}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-main text-base font-bold tracking-[0.08em]">{row.icao}</p>
                    <span
                      className={`tfms-queue-trend tfms-queue-trend-${row.trend}`}
                      title={row.trend === "up" ? "Queue pressure increasing" : row.trend === "down" ? "Queue pressure decreasing" : "No significant change"}
                    >
                      {row.trend === "up" ? "Increasing" : row.trend === "down" ? "Decreasing" : "Steady"}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted uppercase tracking-[0.08em]">Queue</p>
                      <p className="text-main mt-1 text-base font-semibold">{row.count}</p>
                    </div>
                    <div>
                      <p className="text-muted uppercase tracking-[0.08em]">Avg</p>
                      <p className="text-main mt-1 text-base font-semibold">{formatQueueMinutes(row.avgMinutes)}</p>
                    </div>
                    <div>
                      <p className="text-muted uppercase tracking-[0.08em]">Longest</p>
                      <p className="text-main mt-1 text-base font-semibold">{formatQueueMinutes(row.maxMinutes)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

      </div>

      {selectedSpecialtyForThresholds ? (
        <div
          className="bg-black/45 fixed inset-0 z-50 p-4"
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
                className="button-secondary px-3 py-1.5 text-xs"
                onClick={resetAllSpecialtyBandThresholds}
                type="button"
              >
                Reset All
              </button>
              <button
                className="button-secondary px-3 py-1.5 text-xs"
                onClick={() => resetSpecialtyBandThresholds(selectedSpecialtyForThresholds)}
                type="button"
              >
                Reset {selectedSpecialtyForThresholds}
              </button>
              <button
                className="button-primary px-3 py-1.5 text-xs"
                onClick={applySelectedThresholdsToAllSpecialtiesAndClose}
                type="button"
              >
                Apply All
              </button>
              <button
                className="button-primary px-3 py-1.5 text-xs"
                onClick={() => setSelectedSpecialtyForThresholds(null)}
                type="button"
              >
                Apply {selectedSpecialtyForThresholds}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isToolInfoOpen ? (
        <div
          className="bg-black/45 fixed inset-0 z-50 flex items-center justify-center p-4"
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
                  track enroute staffing, watch local departure queues, and quickly see which TRACON facilities are online.
                </p>
              </div>
              <div>
                <p className="text-main text-xs font-semibold uppercase tracking-[0.12em]">Features</p>
                <p className="mt-2">
                  To set Specialty Summary thresholds: click a specialty name in the table, adjust the
                  Green and Yellow slider handles in that specialty modal, then use <span className="text-main font-semibold">Apply {`<SPECIALTY>`}</span> for one specialty or <span className="text-main font-semibold">Apply All</span> for all specialties.
                </p>
                <p className="mt-2">
                  Departure Queue cards track aircraft filed from each configured airport while they remain
                  inside that airport&apos;s configured queue area(s). These queue areas are drawn around
                  runway hold-short zones, not all aircraft on the airport surface. Cards show queue count,
                  average time in queue, longest wait, and whether queue pressure is increasing, steady,
                  or decreasing.
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
                      currently isolated into a separate overflight-only view.
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
