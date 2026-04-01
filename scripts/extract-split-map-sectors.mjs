/**
 * One-time script: extracts the geojsonData FeatureCollection embedded in
 * split-map/standard.js and writes it to data/split-map-sectors.json.
 *
 * Run from the controller_toolkit root:
 *   node scripts/extract-split-map-sectors.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const SOURCE = resolve(
  "C:/Users/Dave/Documents/GitHub/split-map/standard.js",
);
const DEST = resolve("data/split-map-sectors.json");

const source = readFileSync(SOURCE, "utf8");

// Find the geojsonData assignment and extract the object literal
// by counting braces (handles arbitrary nesting depth).
const marker = "var geojsonData = ";
const markerIdx = source.indexOf(marker);
if (markerIdx === -1) throw new Error("Could not find geojsonData in source");

const objStart = source.indexOf("{", markerIdx + marker.length);
let depth = 0;
let inString = false;
let escape = false;
let i = objStart;

while (i < source.length) {
  const c = source[i];
  if (escape) { escape = false; i++; continue; }
  if (c === "\\" && inString) { escape = true; i++; continue; }
  if (c === '"') { inString = !inString; i++; continue; }
  if (!inString) {
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) break; }
  }
  i++;
}

const jsonStr = source.slice(objStart, i + 1);
const data = JSON.parse(jsonStr);

const counts = { low: 0, high: 0, tracon: 0, neighbor: 0 };
for (const f of data.features) {
  const s = f.properties?.strata;
  if (counts[s] !== undefined) counts[s]++;
}

writeFileSync(DEST, JSON.stringify(data, null, 2));

console.log(`Wrote ${DEST}`);
console.log(`  ${data.features.length} features total`);
console.log(`  low: ${counts.low}, high: ${counts.high}, tracon: ${counts.tracon}, neighbor: ${counts.neighbor}`);
