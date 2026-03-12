# ZHU Controller Toolkit

Unified front-end shell for Houston ARTCC controller utilities.

Current tools are registered in a single data file and rendered as searchable cards:
- TFMS Viewer
- Alias Guide (migrated internal route)
- Split Map
- RVM Reference

## Getting Started

Run the development server:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Project Structure

- `data/tools.json`: tool registry (add/edit tools here)
- `app/page.js`: homepage entry
- `components/toolkit-home.js`: searchable tool grid UI
- `app/tools/[id]/page.js`: per-tool detail pages
- `app/tools/alias-guide/page.js`: migrated Alias Guide tool
- `components/alias-guide-page.js`: refactored Alias UI (sidebar nav, search, cards)
- `data/alias-guide.json`: normalized Alias data model used by the app
- `data/alias-guide-markup.html`: imported source markup from legacy Alias Guide
- `scripts/convert-alias-markup.mjs`: converter from legacy markup to normalized JSON
- `lib/tools.js`: helpers for loading tool data
- `app/globals.css`: shared theme tokens and utility classes

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
- `tags`

The homepage and `/tools/[id]` route will automatically include it.

## Alias Data Workflow

The Alias Guide now renders from `data/alias-guide.json`.

If you update legacy source HTML in `data/alias-guide-markup.html`, regenerate JSON with:

```bash
npm run alias:convert
```

### Alias Module Notes

- In `data/alias-guide.json`, most content fields store both:
  - `html`: rendered UI content (supports formatting tags)
  - `text`: plain-text content used for search/filter
- Keep `html` and `text` semantically aligned when editing content.
- Current section layout behavior:
  - `CRC/ZHU Basics`: explorer layout (accordion groups + sticky detail panel + share links)
  - `Pilot Help Messages`: explorer layout (accordion groups + sticky detail panel + share links)
  - `Autotrack`: informational table layout
  - `Standard Routes`: informational table layout
- Explorer permalink links use URL query param:
  - `/tools/alias-guide?alias=<entry-id>#<section-id>`
  - currently enabled for `CRC/ZHU Basics` and `Pilot Help Messages`

## Validate

```bash
npm run lint
npm run build
```

## Theme Modes

The app now supports `Light`, `Dark`, and `System` mode via a global top-right selector.
Preference is saved in `localStorage` (`theme-mode`).

## GitHub Pages Deployment

This project is configured for static export + GitHub Pages.

Important files:
- `next.config.mjs` (`output: "export"`)
- `public/CNAME` (`toolkit.houston.center`)
- `.github/workflows/deploy-pages.yml`

Required one-time GitHub settings:
1. In your repo, go to `Settings > Pages`.
2. Under `Source`, select `GitHub Actions`.
3. In your DNS provider, set `toolkit.houston.center` to GitHub Pages (CNAME target per GitHub docs).

After that, pushes to `main` will build and deploy automatically.

## Notes for PowerShell

If your machine blocks `npm`/`npx` PowerShell scripts, use:
- `npm.cmd run dev`
- `npm.cmd run lint`
- `npm.cmd run build`
