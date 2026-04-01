"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polygon, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";

const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

const SPECIALTY_COLORS = {
  AUS: "#f87171", CRP: "#fb923c", LCH: "#a3e635",
  LFK: "#a78bfa", NEW: "#fbbf24", OCN: "#60a5fa", RSG: "#e879f9",
};
const DIRECTION_COLORS = {
  N: "#38bdf8", S: "#fb923c", E: "#34d399", W: "#c084fc",
};
const EW_COLORS = {
  E: "#38bdf8", W: "#fb923c",
};
const STANDARD_LABELS = {
  specialty: [
    { label: "83", position: [30.555, -96.972] },
    { label: "87", position: [27.782, -97.491] },
    { label: "43", position: [28.935, -93.794] },
    { label: "38", position: [31.182, -92.864] },
    { label: "24", position: [29.984, -89.889] },
    { label: "53", position: [26.289, -90.800] },
    { label: "50", position: [30.396, -100.248] },
  ],
  direction: [
    { label: "50", position: [30.696, -99.248] },
    { label: "38", position: [31.182, -92.864] },
    { label: "87", position: [28.638, -97.187] },
    { label: "24", position: [28.212, -89.634] },
  ],
  ew: [
    { label: "50", position: [29.696, -98.648] },
    { label: "46", position: [29.696, -91.634] },
  ],
};

function geoJsonRingToLatLngs(ring) {
  return ring.map(([lng, lat]) => [lat, lng]);
}

function MapInvalidator() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
  }, [map]);
  return null;
}


function getStandardFill(feature, standardView) {
  const p = feature.properties;
  if (standardView === "specialty") return SPECIALTY_COLORS[p.category] ?? "#94a3b8";
  if (standardView === "direction") return DIRECTION_COLORS[p.direction] ?? "#94a3b8";
  if (standardView === "ew") return p.direction === "E" ? EW_COLORS.E : EW_COLORS.W;
  return "#94a3b8";
}

export default function SplitMapExportView({ features, strata, mode, standardView, customColors, customLabels, mapView }) {
  const enrouteFeatures = useMemo(
    () => features.filter((f) => f.properties.strata === strata),
    [features, strata],
  );

  const strataLabels = useMemo(
    () => Array.from(customLabels.entries()).filter(([, lbl]) => lbl.strata === strata),
    [customLabels, strata],
  );

  return (
    <MapContainer
      center={mapView?.center ? [mapView.center.lat, mapView.center.lng] : [30.5, -97.5]}
      zoom={mapView?.zoom ?? 6}
      zoomControl={false}
      attributionControl={false}
      style={{ height: "100%", width: "100%", background: "#0b1220" }}
    >
      <TileLayer url={TILE_URL} crossOrigin={true} />
      <MapInvalidator />
      {enrouteFeatures.map((f) => {
        const name = f.properties.name;
        let pathOptions;
        if (mode === "standard") {
          pathOptions = { color: "#0f172a", weight: 2, opacity: 1, fillColor: getStandardFill(f, standardView), fillOpacity: 1 };
        } else {
          const colorHex = customColors.get(`${strata}-${name}`);
          pathOptions = colorHex
            ? { color: "#0f172a", weight: 2, opacity: 1, fillColor: colorHex, fillOpacity: 1 }
            : { color: "#334155", weight: 2, opacity: 1, fillColor: "#151c2c", fillOpacity: 1 };
        }
        return (
          <Polygon
            key={name}
            positions={geoJsonRingToLatLngs(f.geometry.coordinates[0])}
            pathOptions={pathOptions}
          />
        );
      })}
      {mode === "standard" && STANDARD_LABELS[standardView].map(({ label, position }) => (
        <Marker
          key={`stdlabel-${label}-${position[0]}`}
          position={position}
          opacity={0}
          icon={L.divIcon({ className: "", iconSize: [0, 0] })}
          interactive={false}
        >
          <Tooltip permanent direction="center" opacity={1} className="split-map-label" >
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "1.25rem", fontWeight: 700, color: "#ffffff" }}>{label}</span>
          </Tooltip>
        </Marker>
      ))}
      {mode === "custom" && strataLabels.map(([id, lbl]) => (
        <Marker
          key={id}
          position={lbl.position}
          opacity={0}
          icon={L.divIcon({ className: "", iconSize: [0, 0] })}
          interactive={false}
        >
          <Tooltip permanent direction="center" opacity={1} className="split-map-label">
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "1.25rem", fontWeight: 700, color: "#ffffff" }}>{lbl.text}</span>
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}
