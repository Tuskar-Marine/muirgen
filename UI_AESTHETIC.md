# Muirgen Alpha - UI Aesthetics & Design Guidelines

This document is the source of truth for the Muirgen user interface design language. Any future developers (or AI agents) working on this codebase must strictly adhere to these principles.

## 1. Cassette Futurism & 80s Sci-Fi Roots
Muirgen is designed for active maritime deployment but heavily leans into an 80s "sci-fi space ship" aesthetic. 
- **Hardware Permanence:** The software must feel like it is physically etched into a CRT glass. Floating windows, drop shadows, and modern "app icon" grids are not to be used. 
- **The Tactical Array:** Interfaces should resemble dense grids of tactile, chunky hardware buttons. Use bracketed typography (e.g., `[ NAV_SYS ]`) and horizontal dividing lines (`====`) to build structural, tabular grids.
- **Modals are Forbidden:** Do not use floating modal overlays. The central viewport acts as a dedicated, switchable CRT. Peripheral instruments (Sidebar, Header, Footer) must remain fixed and visible at all times to preserve muscle memory during emergencies.

## 2. Monochrome Red Palette Constraints
The system operates on a strict monochromatic red display to preserve night vision.
- **Permitted Styles:** 1px rigid borders, chamfered "corner cuts", monospace typography, and CRT scanline backgrounds.
- **Glows vs. Drop Shadows:** Standard web drop shadows are banned. However, "glows" (using `text-shadow` or `box-shadow` with bright red) are explicitly encouraged to simulate an old-fashioned physical button lighting up or an active LED state.
- **Blurs:** CSS blurring (`filter: blur()`) should generally be avoided to preserve legibility, with one strict exception: blurring is permitted to actively obscure data if a session is invalid or locked.

## 3. Navigation Paradigm: Breadcrumbs + Button Fields
- **Sidebar:** Contains only root-level categories (e.g., `VSM`, `Config`, `Telemetry`, `State`).
- **Main Viewport:** When a root is selected, the viewport loads a tactical field of buttons.
- **Breadcrumbs:** The top of the main viewport must feature a structural breadcrumb tree (e.g., `VSM // CONFIG // BATTERIES`) that is clickable for backward navigation.
- **Alarms (The "Viewport Red Alert"):** Critical alarms take over the main viewport (optionally utilizing aggressive border strobing) but must *never* hide the sidebar or telemetry footer/header.

## 4. CSS Consolidation (Muirgen.css vs App.css)
- **`Muirgen.css` is the Master File:** Always prefer and reuse classes from `Muirgen.css`.
- **Phasing out `App.css`:** If you find a suitable class in `App.css`, use it, but add a note/TODO indicating that the class should be migrated to `Muirgen.css`. The core goal is to minimize, consolidate, and eventually phase out `App.css`.
- **No Inline Styles:** The use of `style="..."` is strictly forbidden to ensure styling is never hardcoded and remains manageable.
