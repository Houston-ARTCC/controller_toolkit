# ZHU Controller Toolkit

Unified front-end shell for Houston ARTCC controller utilities.

Current tool launchers:
- TFMS
- Alias Guide
- Route Validator
- ADAR Routes
- Split Map
- RVM Reference

## Getting Started

Run the development server:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Project Structure

- `data/tools.json`: tool registry used by the homepage launcher
- `app/page.js`: homepage entry
- `components/toolkit-home.js`: tool launcher grid UI
- `app/tools/[id]/page.js`: per-tool detail pages
- `app/globals.css`: shared theme + base UI styles
- `reference/`: source/reference docs used during development (not runtime)

### Alias Guide

- `app/tools/alias-guide/page.js`
- `components/alias-guide-page.js`
- `data/alias-guide.json`
- `scripts/convert-alias-markup.mjs`

### Route Validator

- `app/tools/route-validator/page.js`
- `components/route-validator-page.js`
- `app/tools/route-validator/styles.css`
- `data/zhu-routing-rules.json`

### TFMS

- `app/tools/tfms/page.js`
- `components/tfms-viewer-page.js`
- `components/tfms-projection-map.js`
- `app/tools/tfms/styles.css`
- `lib/tfms/compute.js`
- `data/tfms-sectors.json`
- `data/tfms-airport-queue-boxes.json`
- `data/tfms-event-splits.json` (currently hidden from UI, retained for future events)

## Adding a Tool

Add a new object to `data/tools.json` with:
- `id`
- `name`
- `description`
- `url`
- `liveUrl`
- `category`
- `status`
- `icon`
- `tags` (optional)

The homepage and `/tools/[id]` route will automatically include it.

## Alias Data Workflow

Alias Guide renders from `data/alias-guide.json`.

If you update legacy markup, regenerate JSON:

```bash
npm run alias:convert
```

Optional ID normalization pass:

```bash
node scripts/normalize-alias-ids.mjs
```

## Route Validator Notes

Runtime data:
- VATSIM feed: `https://data.vatsim.net/v3/vatsim-data.json` (60s refresh)
- D-ATIS feeds (`KIAH`, `KHOU`, `KDFW`, `KDAL`, `KATL`) (30m refresh)

Fallback:
- Static traffic/prefile samples in `components/route-validator-page.js`

Current statuses:
- `CHECK ROUTE`
- `FLOW`
- `ALTITUDE`
- `REVISION`
- `VALID`
- `NO RULE`

Default sort priority:
1. `CHECK ROUTE`
2. `FLOW`
3. `ALTITUDE`
4. `REVISION`
5. `VALID`
6. `NO RULE`

`COPY ROUTE` appears only for:
- `CHECK ROUTE`
- `FLOW`
- `REVISION`

## TFMS Notes

Current cards/modules:
- Specialty Summary (`Now`, `+10`, `+20`, `+30`)
- Online Positions (ZHU enroute + TRACON)
- Enhanced Projection Map
- Departure Queue (`KIAH`, `KHOU`, `KAUS`, `KSAT`, `KMSY`)

Event split summary:
- Logic/data retained
- Currently hidden and compute-gated

Queue boxes:
- Config supports `bounds`, `geojson`, or `areas`
- Multiple entries for the same ICAO are merged into one card

Projection/summary inclusion logic:
- Flight must pass ZHU relevance checks (in ZHU, near perimeter inbound, or inbound to tracked internal airports)
- Baseline minimum groundspeed filter: `>= 20 kts`
- Operational gate for summary counting: `groundspeed > 50 kts` **or** `altitude > 3000 ft`

Map behavior (current):
- Current aircraft icon
- `+10` projection dot
- Current-to-`+10` connector line
- No `+20/+30` dots/lines
- Toggleable sector overlays (`Low`, `High`)
- Specialty zoom buttons with specialty-aware coloring

## Validate

```bash
npm run lint
npm run test -- --run
npm run build
```

## Theme Modes

The app supports `Light`, `Dark`, and `System` mode via `Auto / Sun / Moon` controls in tool/page headers.  
Preference is saved in `localStorage` (`theme-mode`).

## GitHub Pages Deployment

Configured for static export + Pages.

Important files:
- `next.config.mjs` (`output: "export"`)
- `public/CNAME` (`toolkit.houston.center`)
- `.github/workflows/deploy-pages.yml`

Required one-time GitHub setup:
1. Repo `Settings > Pages`
2. Source: `GitHub Actions`
3. DNS: `toolkit.houston.center` CNAME to GitHub Pages target

Pushes to `main` then build/deploy automatically.

## PowerShell Notes

If `npm`/`npx` PowerShell script execution is blocked, use:
- `npm.cmd run dev`
- `npm.cmd run lint`
- `npm.cmd run test -- --run`
- `npm.cmd run build`
