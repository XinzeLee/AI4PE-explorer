# FLUX design and implementation checklist

- [x] Confirm educational hardware explorer intent through GrillMe.
- [x] Choose conceptual 3 kW, 400 V / 48 V dual active bridge architecture.
- [x] Generate complete primary-screen concept through built-in Image Gen.
- [x] Define interface system from concept.
- [x] Implement named, individually separable 3D assembly and all seven required systems.
- [x] Implement selection, explosion, extraction, hiding, isolation, view presets and export.
- [x] Add explanatory power path and responsive interface.
- [x] Verify browser interactions, WebGL rendering, responsive layout and production build.
- [x] Compare concept with browser screenshot.
- [ ] Publish private Site and hand off (release step after source save).

## Design system

Warm light gray canvas #f4f5f2; white header, sidebar, inspector and dock. Dark ink #171d20, muted #758080, teal #117766, fine borders #e0e5e1. Copper orange magnetics, blue capacitors, mint driver boards. No image overlay. System sans typography: 36px bold heading, 24px inspector heading, 14px controls, 12px metadata. 72px header; 250px left component rail; open 3D canvas; 256px upper-right inspector; bottom-centered explosion dock; 48px footer. Icons: lucide 18px, 1.6px stroke. Modest 6–10px radii, subtle shadows. Header controls, component accordion rows, selection inspector, floating control dock, footer tabs and explainer dialog. Mobile: collapsed assembly drawer, smaller header, full-width canvas, compact bottom inspector and dock.

## Functional architecture

React shell and focused UI modules. Imperative Three.js scene in a dedicated class, with shared geometries/materials, named component roots, eased transforms and controlled disposal. No React state updates per animation frame. Geometry generated locally; no remote asset dependency. UI and GLB carry component descriptions and topology metadata. Targets are illustrative, not simulated performance claims.

## Technical grounding

Topology overview: https://www.ti.com/tool/TIDA-010054 (a separate 10 kW reference, not this illustrative geometry). DAB has two active full bridges, a high-frequency isolation transformer, and a series transfer inductance. Our 400 V / 48 V, 3 kW targets are illustrative. HV side uses SiC MOSFETs; LV side uses silicon MOSFETs. Four dual-channel gate driver daughterboards represent eight gate channels. EMI filter and layout are conceptual, not a validated EMI design.

## Verification at release

### Current 31-part model

The mechanical refinement retains 31 separately selectable roots and a clean solder-mask surface. Switches have continuous tab–insulator–rail–column–baseplate thermal contact, fixed bent leads and matching drills. Terminal/driver collisions are removed; capacitors, magnetic cradles, filter spacers and the control socket have seating surfaces. Transformer and choke windings clear their ferrite, and the choke has two continuous windings with four terminals. The top camera keeps the full assembly in frame.

All 52 tests pass, including actual mesh contacts, bore rays, pin boundaries, preview extrema, winding geometry, shading normals and canonical export. Browser checks cover all component selections, independent extraction, isolation, explosion, top/3D views, mobile selection, and design/control/maintenance anchors with state restoration. The final GLB was downloaded while a part was extracted and parsed: 31 unique named component roots, 779 meshes, 35 embedded images; every root matches its canonical assembled position. Export leaves the live extracted state intact and emits no new runtime warning. Production build passes. These are geometric and software checks; no electrical, thermal or insulation compliance is claimed.

### Initial prototype (historical)

Browser: Codex in-app browser. Desktop and 390 × 844 mobile. All 29 component selections verified against the inspector. Verified extraction/return, isolate, hide/show, reset, search/empty state, explosion, camera presets, mobile drawer and detail expansion, explanation dialog, and all five power-path stages. GLB binary parsed successfully: 29 unique component roots across eight categories, 679 meshes. Production build passes. Browser console has no current runtime errors after fixes. Native touch gestures and other browsers have not been tested.
