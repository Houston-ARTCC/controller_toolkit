"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import MapErrorBoundary from "@/components/map-error-boundary";
import sectorsData from "@/data/split-map-sectors.json";

// 8 colors evenly spaced on the hue wheel, arranged so grid neighbors
// are ~180° apart: Red/Cyan, Orange/Violet, Lime/Fuchsia, Blue/Amber
const CUSTOM_PALETTE = [
  { label: "Red",     hex: "#f87171" },  // row 1
  { label: "Cyan",    hex: "#22d3ee" },
  { label: "Orange",  hex: "#fb923c" },
  { label: "Violet",  hex: "#a78bfa" },
  { label: "Lime",    hex: "#a3e635" },  // row 2
  { label: "Fuchsia", hex: "#e879f9" },
  { label: "Blue",    hex: "#60a5fa" },
  { label: "Amber",   hex: "#fbbf24" },
];

const SplitMapMap = dynamic(() => import("@/components/split-map-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <span className="text-muted text-sm">Loading map…</span>
    </div>
  ),
});

const STANDARD_VIEWS = [
  { id: "specialty", label: "By Specialty" },
  { id: "direction", label: "By Direction" },
  { id: "ew",        label: "E / W" },
];


export default function SplitMapPage() {
  const [mode, setMode] = useState("custom");
  const [strata, setStrata] = useState("low");
  const [showTracon, setShowTracon] = useState(true);
  const [standardView, setStandardView] = useState("specialty");
  const [customColors, setCustomColors] = useState(new Map());
  const [customLabels, setCustomLabels] = useState(new Map());
  const [picker, setPicker] = useState(null); // { feature, x, y }
  const [labelEditor, setLabelEditor] = useState(null); // { id: string|null, x, y, position, text }
  const [showInfo, setShowInfo] = useState(false);
  const labelIdCounter = useRef(0);
  const labelInputRef = useRef(null);
  const mapContainerRef = useRef(null);

  // Close picker on outside click
  useEffect(() => {
    if (!picker) return;
    const handler = (e) => {
      if (!e.target.closest("[data-color-picker]")) setPicker(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [picker]);

  // Close label editor on outside click
  useEffect(() => {
    if (!labelEditor) return;
    const handler = (e) => {
      if (!e.target.closest("[data-label-editor]")) setLabelEditor(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [labelEditor]);

  // Auto-focus label input when editor opens
  useEffect(() => {
    if (labelEditor) labelInputRef.current?.focus();
  }, [labelEditor]);

  const handleSectorClick = useCallback((feature, containerPoint) => {
    setPicker({ feature, x: containerPoint.x, y: containerPoint.y });
  }, []);

  const handleColorSelect = useCallback((feature, colorHex) => {
    setCustomColors((prev) => {
      const next = new Map(prev);
      next.set(`${strata}-${feature.properties.name}`, colorHex);
      return next;
    });
    setPicker(null);
  }, [strata]);

  const handleClearColor = useCallback((feature) => {
    setCustomColors((prev) => {
      const next = new Map(prev);
      next.delete(`${strata}-${feature.properties.name}`);
      return next;
    });
    setPicker(null);
  }, [strata]);

  const handleMapRightClick = useCallback((latlng, containerPoint) => {
    setPicker(null);
    setLabelEditor({ id: null, x: containerPoint.x, y: containerPoint.y, position: [latlng.lat, latlng.lng], text: "" });
  }, []);

  const handleLabelClick = useCallback((id, containerPoint) => {
    setCustomLabels((prev) => {
      const lbl = prev.get(id);
      if (lbl) setLabelEditor({ id, x: containerPoint.x, y: containerPoint.y, position: lbl.position, text: lbl.text });
      return prev;
    });
    setPicker(null);
  }, []);

  const handleLabelSave = useCallback(() => {
    if (!labelEditor || !labelEditor.text.trim()) return;
    setCustomLabels((prev) => {
      const next = new Map(prev);
      const id = labelEditor.id ?? `label-${++labelIdCounter.current}`;
      next.set(id, { id, position: labelEditor.position, text: labelEditor.text.trim(), strata });
      return next;
    });
    setLabelEditor(null);
  }, [labelEditor, strata]);

  const handleLabelDelete = useCallback((id) => {
    setCustomLabels((prev) => { const next = new Map(prev); next.delete(id); return next; });
    setLabelEditor(null);
  }, []);

  const handleClearAll = useCallback(() => {
    setCustomColors(new Map());
    setCustomLabels(new Map());
    setPicker(null);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="border-default bg-surface flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <Link href="/" className="text-muted hover:text-accent transition-colors">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <span className="text-foreground font-semibold">Split Map</span>

        {/* Mode toggle */}
        <div className="border-default bg-surface-soft ml-2 flex gap-0.5 rounded-lg border p-0.5">
          {["custom", "standard"].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                mode === m
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Strata toggle */}
        <div className="border-default bg-surface-soft flex gap-0.5 rounded-lg border p-0.5">
          <span className="text-muted flex items-center px-2 text-xs font-semibold">Strata</span>
          {["low", "high"].map((s) => (
            <button
              key={s}
              onClick={() => setStrata(s)}
              className={`rounded-md px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                strata === s
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Standard view buttons (only in standard mode) */}
        {mode === "standard" && (
          <div className="border-default bg-surface-soft flex gap-0.5 rounded-lg border p-0.5">
            {STANDARD_VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setStandardView(v.id)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  standardView === v.id
                    ? "bg-sky-500 text-white shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}

        {/* TRACON toggle */}
        <div className="border-default bg-surface-soft flex gap-0.5 rounded-lg border p-0.5">
          <span className="text-muted flex items-center px-2 text-xs font-semibold">TRACONs</span>
          {[true, false].map((val) => (
            <button
              key={String(val)}
              onClick={() => setShowTracon(val)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                showTracon === val
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {val ? "On" : "Off"}
            </button>
          ))}
        </div>

        {/* Clear all (custom mode) */}
        {mode === "custom" && (customColors.size > 0 || customLabels.size > 0) && (
          <button
            onClick={handleClearAll}
            className="rounded-lg border border-red-500/40 px-3 py-1 text-xs font-semibold text-red-400 transition-colors hover:border-red-500/70 hover:bg-red-500/10 hover:text-red-300"
          >
            Clear All
          </button>
        )}

        {/* Info button */}
        <button
          onClick={() => setShowInfo(true)}
          className="border-default text-muted hover:text-foreground ml-auto rounded-lg border px-3 py-1 text-xs font-semibold transition-colors"
        >
          Tool Info
        </button>

      </header>


      {/* Map area */}
      <div ref={mapContainerRef} className="relative min-h-0 flex-1">
        <MapErrorBoundary>
          <SplitMapMap
            features={sectorsData.features}
            strata={strata}
            showTracon={showTracon}
            mode={mode}
            customColors={customColors}
            customLabels={customLabels}
            standardView={standardView}
            onSectorClick={handleSectorClick}
            onMapRightClick={handleMapRightClick}
            onLabelClick={handleLabelClick}
            isDarkTheme={true}
          />
        </MapErrorBoundary>

        {/* Color picker popover */}
        {picker && mode === "custom" && (
          <div
            data-color-picker
            className="border-default bg-surface shadow-lg absolute z-[1000] rounded-xl border p-3"
            style={{
              left: Math.min(picker.x + 8, (mapContainerRef.current?.offsetWidth ?? 400) - 200),
              top: Math.min(picker.y + 8, (mapContainerRef.current?.offsetHeight ?? 400) - 160),
            }}
          >
            <div className="text-muted mb-2 text-[10px] font-semibold uppercase tracking-widest">
              Sector {picker.feature.properties.name}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {CUSTOM_PALETTE.map((c) => (
                <button
                  key={c.hex}
                  title={c.label}
                  onClick={() => handleColorSelect(picker.feature, c.hex)}
                  className="h-6 w-6 rounded-md transition-transform hover:scale-110 focus:outline-none"
                  style={{
                    background: c.hex,
                    boxShadow:
                      customColors.get(picker.feature.properties.name) === c.hex
                        ? `0 0 0 2px white, 0 0 0 3.5px ${c.hex}`
                        : undefined,
                  }}
                />
              ))}
            </div>
            {customColors.has(`${strata}-${picker.feature.properties.name}`) && (
              <button
                onClick={() => handleClearColor(picker.feature)}
                className="mt-2 w-full rounded-md border border-red-500/30 py-1 text-center text-[10px] text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-300"
              >
                Clear color
              </button>
            )}
          </div>
        )}

        {/* Label editor popover */}
        {labelEditor && mode === "custom" && (
          <div
            data-label-editor
            className="border-default bg-surface shadow-lg absolute z-[1000] rounded-xl border p-3 w-48"
            style={{
              left: Math.min(labelEditor.x + 8, (mapContainerRef.current?.offsetWidth ?? 400) - 200),
              top: Math.min(labelEditor.y + 8, (mapContainerRef.current?.offsetHeight ?? 400) - 110),
            }}
          >
            <div className="text-muted mb-2 text-[10px] font-semibold uppercase tracking-widest">
              {labelEditor.id ? "Edit Label" : "New Label"}
            </div>
            <input
              ref={labelInputRef}
              type="text"
              value={labelEditor.text}
              onChange={(e) => setLabelEditor((prev) => ({ ...prev, text: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLabelSave();
                if (e.key === "Escape") setLabelEditor(null);
              }}
              className="bg-surface-soft border-default w-full rounded-md border px-2 py-1 text-xs font-mono text-foreground outline-none focus:border-sky-500"
              placeholder="Label text…"
            />
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={handleLabelSave}
                className="bg-sky-500 text-white rounded-md px-3 py-1 text-xs font-semibold transition-colors hover:bg-sky-400"
              >
                {labelEditor.id ? "Update" : "Add"}
              </button>
              {labelEditor.id && (
                <button
                  onClick={() => handleLabelDelete(labelEditor.id)}
                  className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-400 transition-colors hover:border-red-500/70 hover:bg-red-500/10 hover:text-red-300"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tool Info modal */}
      {showInfo && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60"
          onMouseDown={() => setShowInfo(false)}
        >
          <div
            className="border-default bg-surface shadow-xl relative w-full max-w-md rounded-2xl border p-6"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-foreground text-base font-semibold">Split Map</h2>
              <button
                onClick={() => setShowInfo(false)}
                className="text-muted hover:text-foreground transition-colors"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <section>
                <h3 className="text-foreground mb-1 font-semibold">Modes</h3>
                <p className="text-muted leading-relaxed"><span className="text-foreground font-medium">Custom</span> — Build a split configuration by painting sectors with colors and adding position labels. Use the Strata toggle to work on low and high altitudes independently.</p>
                <p className="text-muted mt-1.5 leading-relaxed"><span className="text-foreground font-medium">Standard</span> — View the three pre-defined ZHU split configurations: By Specialty, By Direction, or E / W.</p>
              </section>

              <section>
                <h3 className="text-foreground mb-1 font-semibold">Custom Mode Controls</h3>
                <ul className="text-muted space-y-1 leading-relaxed">
                  <li><span className="text-foreground font-medium">Click a sector</span> — open the color picker to assign or clear a color.</li>
                  <li><span className="text-foreground font-medium">Right-click the map</span> — place a new position label at that location.</li>
                  <li><span className="text-foreground font-medium">Click a label</span> — edit the text or delete the label.</li>
                  <li><span className="text-foreground font-medium">Clear All</span> — remove all colors and labels for the current configuration.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-foreground mb-1 font-semibold">Other Controls</h3>
                <ul className="text-muted space-y-1 leading-relaxed">
                  <li><span className="text-foreground font-medium">Strata</span> — toggle between Low (FL240 and below) and High (FL250 and above) sectors.</li>
                  <li><span className="text-foreground font-medium">TRACONs</span> — show or hide TRACON airspace boundaries.</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
