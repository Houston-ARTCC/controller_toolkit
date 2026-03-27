"use client";

import { divIcon } from "leaflet";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { getSpecialtyColors } from "@/lib/tfms/specialty-colors";

function isFiniteCoordinate(value) {
  return Number.isFinite(Number(value));
}

function buildTrackPoints(flight) {
  const points = [
    [Number(flight.latitude), Number(flight.longitude)],
    [Number(flight.proj10Latitude), Number(flight.proj10Longitude)],
    [Number(flight.proj20Latitude), Number(flight.proj20Longitude)],
    [Number(flight.proj30Latitude), Number(flight.proj30Longitude)],
  ];
  return points.filter(([lat, lon]) => isFiniteCoordinate(lat) && isFiniteCoordinate(lon));
}

function formatTooltipAltitude(value) {
  const altitude = Number(value);
  if (!Number.isFinite(altitude) || altitude <= 0) {
    return "-";
  }
  if (altitude >= 18000) {
    return `FL${Math.round(altitude / 100)}`;
  }
  return `${Math.round(altitude).toLocaleString()} ft`;
}

function darkenHex(hex, factor = 0.8) {
  const value = String(hex || "").trim();
  const match = value.match(/^#?([a-fA-F0-9]{6})$/);
  if (!match) {
    return "#334155";
  }
  const normalized = match[1];
  const red = Math.max(0, Math.min(255, Math.round(parseInt(normalized.slice(0, 2), 16) * factor)));
  const green = Math.max(0, Math.min(255, Math.round(parseInt(normalized.slice(2, 4), 16) * factor)));
  const blue = Math.max(0, Math.min(255, Math.round(parseInt(normalized.slice(4, 6), 16) * factor)));
  return `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
}

function getSectorPolygonStyle(specialty, layer, isDarkTheme) {
  const palette = getSpecialtyColors(specialty);
  const fillColor = palette.sectorFill;
  const outlineSeed = palette.iconFill;
  const outlineColor = isDarkTheme ? outlineSeed : darkenHex(outlineSeed, 0.7);
  const outlineOpacity = isDarkTheme ? (layer === "high" ? 0.76 : 0.7) : layer === "high" ? 0.9 : 0.86;
  const fillOpacity = isDarkTheme ? (layer === "high" ? 0.06 : 0.045) : layer === "high" ? 0.14 : 0.11;
  return {
    color: outlineColor,
    weight: isDarkTheme ? 1.3 : 1.6,
    opacity: outlineOpacity,
    fill: true,
    fillColor,
    fillOpacity,
    lineJoin: "round",
  };
}

function getSpecialtyZoomButtonStyle(specialty, isDarkTheme, isActive) {
  const colors = getSpecialtyColors(specialty);
  if (isActive) {
    return {
      borderColor: isDarkTheme ? colors.iconFill : darkenHex(colors.iconFill, 0.72),
      backgroundColor: isDarkTheme
        ? "color-mix(in srgb, var(--surface) 72%, transparent)"
        : "color-mix(in srgb, var(--surface) 82%, transparent)",
      color: isDarkTheme ? colors.sectorFill : darkenHex(colors.iconFill, 0.66),
      boxShadow: `inset 0 0 0 1px ${isDarkTheme ? colors.iconFill : darkenHex(colors.iconFill, 0.76)}`,
    };
  }
  return {
    borderColor: isDarkTheme
      ? "color-mix(in srgb, var(--surface-border) 70%, transparent)"
      : "color-mix(in srgb, var(--surface-border) 88%, transparent)",
    backgroundColor: isDarkTheme
      ? "color-mix(in srgb, var(--surface) 86%, transparent)"
      : "color-mix(in srgb, var(--surface) 92%, transparent)",
    color: isDarkTheme
      ? "color-mix(in srgb, var(--muted) 80%, white)"
      : "color-mix(in srgb, var(--muted) 88%, black)",
  };
}

function getSpecialtyZoomButtonHoverStyle(specialty, isDarkTheme, isActive) {
  const colors = getSpecialtyColors(specialty);
  if (isActive) {
    return {
      borderColor: isDarkTheme ? colors.iconFill : darkenHex(colors.iconFill, 0.68),
      backgroundColor: isDarkTheme
        ? "color-mix(in srgb, var(--surface-soft) 86%, transparent)"
        : "color-mix(in srgb, var(--surface-soft) 92%, transparent)",
      color: isDarkTheme ? colors.sectorFill : darkenHex(colors.iconFill, 0.62),
      boxShadow: `inset 0 0 0 1px ${isDarkTheme ? colors.iconFill : darkenHex(colors.iconFill, 0.72)}`,
    };
  }
  return {
    borderColor: isDarkTheme ? colors.iconFill : darkenHex(colors.iconFill, 0.72),
    backgroundColor: isDarkTheme
      ? "color-mix(in srgb, var(--surface-soft) 90%, transparent)"
      : "color-mix(in srgb, var(--surface-soft) 95%, transparent)",
    color: isDarkTheme ? colors.sectorFill : darkenHex(colors.iconFill, 0.68),
    boxShadow: `inset 0 0 0 1px ${isDarkTheme ? colors.iconFill : darkenHex(colors.iconFill, 0.76)}`,
  };
}

function MapInstanceBridge({ onReady }) {
  const map = useMap();
  useEffect(() => {
    onReady?.(map);
  }, [map, onReady]);
  return null;
}

export default function TfmsProjectionMap({
  flights = [],
  sectorLayerOutlines = null,
  specialtyBounds = null,
  zhuPerimeter = [],
}) {
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState({
    low: true,
    high: false,
  });
  const [activeSpecialty, setActiveSpecialty] = useState("ALL");
  const [hoveredSpecialty, setHoveredSpecialty] = useState("");

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    const updateTheme = () => {
      const resolved = root.getAttribute("data-theme");
      setIsDarkTheme(resolved === "dark");
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const mapData = useMemo(
    () =>
      (Array.isArray(flights) ? flights : [])
        .map((flight) => ({
          id: String(flight.mapId || ""),
          callsign: String(flight.callsign || ""),
          isEnteringZhu: Boolean(flight.isEnteringZhu),
          altitude: Number(flight.altitude || 0),
          heading: Number(flight.heading || 0),
          specialty: String(flight.specialty || ""),
          proj10Specialty: String(flight.proj10Specialty || ""),
          proj20Specialty: String(flight.proj20Specialty || ""),
          proj30Specialty: String(flight.proj30Specialty || ""),
          points: buildTrackPoints(flight),
        }))
        .filter((flight) => flight.id && flight.points.length >= 1),
    [flights],
  );

  const perimeterBounds = useMemo(() => {
    if (!Array.isArray(zhuPerimeter) || zhuPerimeter.length < 3) {
      return null;
    }
    const valid = zhuPerimeter
      .map((point) => [Number(point?.[1]), Number(point?.[0])])
      .filter(([lat, lon]) => isFiniteCoordinate(lat) && isFiniteCoordinate(lon));
    return valid.length >= 3 ? valid : null;
  }, [zhuPerimeter]);
  const specialtyKeys = useMemo(
    () =>
      Object.keys(specialtyBounds || {})
        .map((value) => String(value || "").toUpperCase())
        .sort((a, b) => a.localeCompare(b)),
    [specialtyBounds],
  );
  const selectedBounds = useMemo(() => {
    if (activeSpecialty && activeSpecialty !== "ALL") {
      const candidate = specialtyBounds?.[activeSpecialty];
      if (Array.isArray(candidate) && candidate.length === 2) {
        return candidate;
      }
    }
    return perimeterBounds;
  }, [activeSpecialty, perimeterBounds, specialtyBounds]);

  const applyBounds = useCallback(
    (bounds, zoomBump = 0) => {
      const map = mapRef.current;
      if (!map || !Array.isArray(bounds) || bounds.length < 2) {
        return;
      }
      map.invalidateSize(false);
      map.fitBounds(bounds, {
        animate: false,
        padding: [0, 0],
      });
      if (Number.isFinite(zoomBump) && zoomBump !== 0) {
        const zoomedIn = Math.min(map.getMaxZoom(), map.getZoom() + zoomBump);
        map.setZoom(zoomedIn, { animate: false });
      }
    },
    [],
  );

  useEffect(() => {
    if (!mapReady) {
      return;
    }
    applyBounds(selectedBounds, activeSpecialty === "ALL" ? 1 : 0);
  }, [activeSpecialty, applyBounds, mapReady, selectedBounds]);
  const tileUrl = isDarkTheme
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png";
  const projectionLineColor = isDarkTheme ? "#f8fafc" : "#334155";
  const projectionLineOpacity = isDarkTheme ? 0.75 : 0.64;

  const toggleLayer = (layer) =>
    setVisibleLayers((previous) => ({
      ...previous,
      [layer]: !previous[layer],
    }));

  const getAircraftIcon = (heading, specialty) => {
    const normalizedHeading = Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : 0;
    const colors = getSpecialtyColors(specialty);
    const iconFill = isDarkTheme ? colors.iconFill : darkenHex(colors.iconFill, 0.76);
    const iconStroke = isDarkTheme ? "#f8fafc" : darkenHex(colors.iconFill, 0.52);
    const backdropFill = isDarkTheme ? "rgba(8, 14, 28, 0.56)" : "rgba(15, 23, 42, 0.18)";
    const backdropStroke = isDarkTheme ? "rgba(226, 236, 254, 0.32)" : "rgba(15, 23, 42, 0.42)";
    const glowDeviation = isDarkTheme ? 0.95 : 1.4;
    const glowOpacity = isDarkTheme ? 0.6 : 0.88;
    const backdropRadius = isDarkTheme ? 9.7 : 9.3;
    const backdropStrokeWidth = isDarkTheme ? 1.05 : 1;
    const iconStrokeWidth = isDarkTheme ? 1.28 : 1.4;
    const iconSize = isDarkTheme ? 30 : 28;
    const iconAnchor = isDarkTheme ? 15 : 14;
    const aircraftSvg = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 28 28" fill="none">
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="${glowDeviation}" flood-color="${iconFill}" flood-opacity="${glowOpacity}"/>
          </filter>
        </defs>
        <circle cx="14" cy="14" r="${backdropRadius}" fill="${backdropFill}" stroke="${backdropStroke}" stroke-width="${backdropStrokeWidth}"/>
        <g filter="url(#glow)">
          <path d="M14 2 L16.3 9.2 L23.5 11.4 L23.5 13.2 L16.2 13.1 L14.8 17.7 L18.6 21.5 L18 22.9 L14 20.2 L10 22.9 L9.4 21.5 L13.2 17.7 L11.8 13.1 L4.5 13.2 L4.5 11.4 L11.7 9.2 L14 2 Z"
                fill="${iconFill}" stroke="${iconStroke}" stroke-width="${iconStrokeWidth}" stroke-linejoin="round"/>
          <circle cx="14" cy="14" r="0.9" fill="#e0f2fe"/>
        </g>
      </svg>`,
    );
    return divIcon({
      className: "tfms-aircraft-icon-wrap",
      html: `<div class="tfms-aircraft-icon" style="transform: rotate(${normalizedHeading}deg)"><img src="data:image/svg+xml,${aircraftSvg}" alt="" /></div>`,
      iconSize: [iconSize, iconSize],
      iconAnchor: [iconAnchor, iconAnchor],
    });
  };

  if (mapData.length === 0) {
    return <p className="text-muted text-sm">No enhanced-projection aircraft to map right now.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--surface-border)]">
      <div className="border-default bg-surface-soft flex flex-wrap items-center gap-1.5 border-b px-2 py-1">
        <span className="text-muted text-[10px] uppercase tracking-[0.08em]">Sectors</span>
        <button
          className={`button-secondary px-2 py-0.5 text-[10px] ${visibleLayers.low ? "theme-mode-button-active" : ""}`}
          onClick={() => toggleLayer("low")}
          type="button"
        >
          Low
        </button>
        <button
          className={`button-secondary px-2 py-0.5 text-[10px] ${visibleLayers.high ? "theme-mode-button-active" : ""}`}
          onClick={() => toggleLayer("high")}
          type="button"
        >
          High
        </button>
        <span className="text-muted ml-1 text-[10px] uppercase tracking-[0.08em]">Zoom</span>
        <button
          className={`button-secondary px-2 py-0.5 text-[10px] ${activeSpecialty === "ALL" ? "theme-mode-button-active" : ""}`}
          onClick={() => {
            setActiveSpecialty("ALL");
            requestAnimationFrame(() => applyBounds(perimeterBounds, 1));
          }}
          type="button"
        >
          All
        </button>
        {specialtyKeys.map((specialty) => (
          <button
            className="button-secondary px-2 py-0.5 text-[10px]"
            key={`zoom-${specialty}`}
            onMouseEnter={() => setHoveredSpecialty(specialty)}
            onMouseLeave={() => setHoveredSpecialty((current) => (current === specialty ? "" : current))}
            onClick={() => {
              setActiveSpecialty(specialty);
              requestAnimationFrame(() => applyBounds(specialtyBounds?.[specialty], 0));
            }}
            style={
              hoveredSpecialty === specialty
                ? getSpecialtyZoomButtonHoverStyle(specialty, isDarkTheme, activeSpecialty === specialty)
                : getSpecialtyZoomButtonStyle(specialty, isDarkTheme, activeSpecialty === specialty)
            }
            type="button"
          >
            {specialty}
          </button>
        ))}
      </div>
      <MapContainer
        center={[30.03, -95.33]}
        className="h-[26rem] w-full"
        scrollWheelZoom
        zoom={6}
      >
        <MapInstanceBridge
          onReady={(map) => {
            mapRef.current = map;
            setMapReady(true);
          }}
        />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url={tileUrl}
        />
        {visibleLayers.low
          ? (Array.isArray(sectorLayerOutlines?.low) ? sectorLayerOutlines.low : []).map((outline) => (
              <Polygon
                key={`low-sector-${outline.id}`}
                pathOptions={getSectorPolygonStyle(outline.specialty, "low", isDarkTheme)}
                positions={outline.points}
              />
            ))
          : null}
        {visibleLayers.high
          ? (Array.isArray(sectorLayerOutlines?.high) ? sectorLayerOutlines.high : []).map((outline) => (
              <Polygon
                key={`high-sector-${outline.id}`}
                pathOptions={getSectorPolygonStyle(outline.specialty, "high", isDarkTheme)}
                positions={outline.points}
              />
            ))
          : null}
        {mapData.map((flight) => {
          const [start, p10] = flight.points;
          const enteringSpecialty =
            flight.specialty || flight.proj10Specialty || flight.proj20Specialty || flight.proj30Specialty || "";
          const iconSpecialty =
            flight.isEnteringZhu && !flight.specialty
              ? flight.proj10Specialty || flight.proj20Specialty || flight.proj30Specialty || ""
              : flight.specialty;
          return (
            <Fragment key={flight.id}>
              {start && p10 ? (
                <Polyline
                  opacity={projectionLineOpacity}
                  pathOptions={{ color: projectionLineColor, weight: 1.5 }}
                  positions={[start, p10]}
                />
              ) : null}
              <Marker icon={getAircraftIcon(flight.heading, iconSpecialty)} position={start}>
                <Tooltip direction="top" offset={[0, -4]} permanent={false} sticky>
                  <div className="text-[11px] leading-tight">
                    <div>{flight.callsign || "-"}</div>
                    <div>{formatTooltipAltitude(flight.altitude)}</div>
                    <div>
                      {enteringSpecialty
                        ? flight.isEnteringZhu
                          ? `Entering: ${enteringSpecialty}`
                          : enteringSpecialty
                        : ""}
                    </div>
                  </div>
                </Tooltip>
              </Marker>
              {p10 ? (
                <CircleMarker center={p10} pathOptions={{ color: "#93c5fd", fillColor: "#60a5fa", fillOpacity: 0.9 }} radius={3.2}>
                  <Tooltip direction="top" offset={[0, -4]} permanent={false} sticky>
                    <div className="text-[11px] leading-tight">
                      <div>{flight.callsign || "-"}</div>
                      <div>+10 mins</div>
                      <div>{flight.proj10Specialty || ""}</div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              ) : null}
            </Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}
