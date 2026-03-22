## Reference Files

This folder contains source/reference documents used while developing route-validator logic.

### FAA Aircraft Type Designators PDF

File:
`2024-04-29_FAA_Order_JO_7360.1J_Aircraft_Type_Designators--post.pdf`

Usage in this project:
- Helps map aircraft type designators to engine/class categories (e.g., jet, turboprop, prop).
- Supports classification logic decisions; it is not an app runtime dependency.

Notes:
- This document does **not** define FAA equipment suffix capability rules (`/G`, `/L`, etc.).
- Equipment suffix interpretation comes from project-specific operational rules.
