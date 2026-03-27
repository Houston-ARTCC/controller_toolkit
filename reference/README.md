## Reference Files

This folder contains source/reference documents used during toolkit development.

These files are for controller/engineering reference and migration support. They are not runtime dependencies unless explicitly imported by app code.

## Current Reference Artifacts

- `2024-04-29_FAA_Order_JO_7360.1J_Aircraft_Type_Designators--post.pdf`
  - Used for aircraft type/class lookups (jet, turboprop, prop, etc.)
  - Not used for FAA equipment suffix capability rules (`/G`, `/L`, etc.)

- `ZHU_Airports.txt`
  - Source list used to build/validate internal ZHU airport handling for TFMS logic

## Notes

- Keep large source documents here instead of root-level project paths.
- Prefer adding short context comments in this README when a new reference file is introduced.
