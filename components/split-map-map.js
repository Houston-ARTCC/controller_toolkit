"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Pane, Polygon, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

// Standard specialty colors — aligned with the 8-color custom palette
const SPECIALTY_COLORS = {
  AUS: "#f87171",
  CRP: "#fb923c",
  LCH: "#a3e635",
  LFK: "#a78bfa",
  NEW: "#fbbf24",
  OCN: "#60a5fa",
  RSG: "#e879f9",
};

// Color palettes for standard views
const DIRECTION_COLORS = {
  N: { fill: "#38bdf8", stroke: "#0ea5e9" },
  S: { fill: "#fb923c", stroke: "#f97316" },
  E: { fill: "#34d399", stroke: "#10b981" },
  W: { fill: "#c084fc", stroke: "#a855f7" },
};

const EW_COLORS = {
  E: { fill: "#38bdf8", stroke: "#0ea5e9" },
  W: { fill: "#fb923c", stroke: "#f97316" },
};

// Fixed-position position labels for each standard view
// Positions sourced from original splits.houston.center standard.js
const STANDARD_LABELS = {
  specialty: [
    { label: "83", position: [30.555, -96.972] }, // AUS
    { label: "87", position: [27.782, -97.491] }, // CRP
    { label: "43", position: [28.935, -93.794] }, // LCH
    { label: "38", position: [31.182, -92.864] }, // LFK
    { label: "24", position: [29.984, -89.889] }, // NEW
    { label: "53", position: [26.289, -90.800] }, // OCN
    { label: "50", position: [30.396, -100.248] }, // RSG
  ],
  direction: [
    { label: "50", position: [30.696, -99.248] },  // W
    { label: "38", position: [31.182, -92.864] },  // N
    { label: "87", position: [28.638, -97.187] },  // S
    { label: "24", position: [28.212, -89.634] },  // E
  ],
  ew: [
    { label: "50", position: [29.696, -98.648] },  // W split
    { label: "46", position: [29.696, -91.634] },  // E split
  ],
};

// 12 swatchable colors for custom mode (visible on dark Carto basemap)
const CUSTOM_PALETTE = [
  { label: "Sky",     hex: "#38bdf8" },
  { label: "Emerald", hex: "#34d399" },
  { label: "Amber",   hex: "#fbbf24" },
  { label: "Rose",    hex: "#fb7185" },
  { label: "Violet",  hex: "#a78bfa" },
  { label: "Orange",  hex: "#fb923c" },
  { label: "Teal",    hex: "#2dd4bf" },
  { label: "Indigo",  hex: "#818cf8" },
  { label: "Lime",    hex: "#a3e635" },
  { label: "Fuchsia", hex: "#e879f9" },
  { label: "Cyan",    hex: "#22d3ee" },
  { label: "Red",     hex: "#f87171" },
];


function MapRightClickHandler({ onRightClick }) {
  useMapEvents({
    contextmenu: (e) => {
      e.originalEvent.preventDefault();
      onRightClick(e.latlng, e.containerPoint);
    },
  });
  return null;
}

function MapInitialBounds({ features }) {
  const map = useMap();
  useEffect(() => {
    const allPoints = features
      .filter((f) => f.properties.strata === "low" || f.properties.strata === "high")
      .flatMap((f) => geoJsonRingToLatLngs(f.geometry.coordinates[0]));
    if (allPoints.length > 0) {
      map.fitBounds(allPoints, { padding: [24, 24], animate: false });
      map.setZoom(map.getZoom() - 0.25, { animate: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — fit once on mount only
  return null;
}

function geoJsonRingToLatLngs(ring) {
  return ring.map(([lng, lat]) => [lat, lng]);
}

function hexToRgb(hex) {
  const m = hex.replace("#", "").match(/.{2}/g);
  return m ? m.map((h) => parseInt(h, 16)) : [100, 100, 100];
}

function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}


function getStandardStyle(feature, view) {
  const p = feature.properties;
  let fill = "#94a3b8";

  if (view === "specialty") {
    fill = SPECIALTY_COLORS[p.category] ?? "#94a3b8";
  } else if (view === "direction") {
    fill = (DIRECTION_COLORS[p.direction] ?? DIRECTION_COLORS.N).fill;
  } else if (view === "ew") {
    fill = EW_COLORS[p.direction === "E" ? "E" : "W"].fill;
  }

  return {
    color: "#0f172a",
    weight: 2,
    opacity: 1,
    fillColor: fill,
    fillOpacity: 1,
  };
}

export default function SplitMapMap({
  features,
  strata,
  showTracon,
  mode,
  customColors,
  customLabels,
  standardView,
  onSectorClick,
  onMapRightClick,
  onLabelClick,
  isDarkTheme,
}) {
  const tileUrl = isDarkTheme
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png";

  const enrouteFeatures = useMemo(
    () => features.filter((f) => f.properties.strata === strata),
    [features, strata],
  );
  const traconFeatures = useMemo(
    () => features.filter((f) => f.properties.strata === "tracon"),
    [features],
  );
  const neighborFeatures = useMemo(
    () => features.filter((f) => f.properties.strata === "neighbor"),
    [features],
  );

  const neighborStyle = {
    color: "#64748b",
    weight: 1,
    opacity: 0.7,
    fill: false,
  };

  const traconStyle = {
    color: isDarkTheme ? "#ffffff" : "#1e293b",
    weight: 2,
    opacity: 0.6,
    fill: false,
    dashArray: "6 5",
  };

  return (
    <div style={{ height: "100%", width: "100%", background: isDarkTheme ? "#0b1220" : "#eff4fa" }}>
    <MapContainer
      center={[30.5, -93.0]}
      zoom={6}
      zoomSnap={0.25}
      zoomControl={false}
      attributionControl={false}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer url={tileUrl} />
      <MapInitialBounds features={features} />
      {mode === "custom" && <MapRightClickHandler onRightClick={onMapRightClick} />}

      {neighborFeatures.map((f, i) => (
        <Polygon
          key={`neighbor-${i}`}
          positions={geoJsonRingToLatLngs(f.geometry.coordinates[0])}
          pathOptions={neighborStyle}
        />
      ))}

      {enrouteFeatures.map((f) => {
        const name = f.properties.name;
        let pathOptions;

        if (mode === "custom") {
          const colorHex = customColors.get(`${strata}-${name}`);
          if (colorHex) {
            pathOptions = {
              color: "#0f172a",
              weight: 2,
              opacity: 1,
              fillColor: colorHex,
              fillOpacity: 1,
            };
          } else {
            pathOptions = {
              color: "#334155",
              weight: 2,
              opacity: 1,
              fillColor: "#151c2c",
              fillOpacity: 1,
            };
          }
        } else {
          pathOptions = getStandardStyle(f, standardView);
        }

        return (
          <Polygon
            key={`enroute-${name}`}
            positions={geoJsonRingToLatLngs(f.geometry.coordinates[0])}
            pathOptions={pathOptions}
            eventHandlers={
              mode === "custom"
                ? { click: (e) => onSectorClick(f, e.containerPoint) }
                : undefined
            }
          >
            <Tooltip
              direction="center"
              permanent={false}
              opacity={0.9}
              className="split-map-tooltip"
            >
              <span className="font-mono text-xs font-bold">{name}</span>
            </Tooltip>
          </Polygon>
        );
      })}

      {mode === "custom" && (
        <Pane name="label-pane" style={{ zIndex: 460 }}>
          {Array.from(customLabels.entries())
            .filter(([, lbl]) => lbl.strata === strata)
            .map(([id, lbl]) => (
              <Marker
                key={id}
                position={lbl.position}
                opacity={0}
                icon={L.divIcon({ className: "", iconSize: [0, 0] })}
                pane="label-pane"
                eventHandlers={{ click: (e) => { L.DomEvent.stop(e.originalEvent); onLabelClick(id, e.containerPoint); } }}
              >
                <Tooltip permanent direction="center" opacity={1} className="split-map-label" interactive={true}>
                  {lbl.text}
                </Tooltip>
              </Marker>
            ))}
        </Pane>
      )}

      {mode === "standard" && (
        <Pane name="label-pane" style={{ zIndex: 460 }}>
          {STANDARD_LABELS[standardView].map(({ label, position }) => (
            <Marker
              key={`stdlabel-${label}-${position[0]}-${position[1]}`}
              position={position}
              opacity={0}
              icon={L.divIcon({ className: "", iconSize: [0, 0] })}
              interactive={false}
              pane="label-pane"
            >
              <Tooltip
                permanent
                direction="center"
                opacity={1}
                className="split-map-label"
              >
                {label}
              </Tooltip>
            </Marker>
          ))}
        </Pane>
      )}

      {showTracon && (
        <Pane name="tracon-pane" style={{ zIndex: 450 }}>
          {traconFeatures.map((f, i) => (
            <Polygon
              key={`tracon-${i}`}
              positions={geoJsonRingToLatLngs(f.geometry.coordinates[0])}
              pathOptions={traconStyle}
              pane="tracon-pane"
            >
              <Tooltip
                direction="center"
                permanent={false}
                opacity={0.85}
                className="split-map-tooltip"
              >
                <span className="font-mono text-xs">{f.properties.sector}</span>
              </Tooltip>
            </Polygon>
          ))}
        </Pane>
      )}
    </MapContainer>
    </div>
  );
}
