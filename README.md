# FLUX — Power Converter Explorer

An educational, browser-based 3D hardware explorer for a conceptual 3 kW, 400 V / 48 V isolated dual active bridge converter. Built with React, Vite and Three.js; all geometry and textures are authored locally in code.

## Run

```sh
npm install
npm run dev
```

`npm run build` produces the static deployment in `dist/`. `npm run preview` serves the production build.

## Explore

- Orbit by dragging; zoom by scrolling or pinching; right-drag to pan.
- Click a mesh or open a category in Assembly to select a part. Search by reference designator or name.
- Pull any selected part out independently; return it with the same control.
- Use the explosion slider or Assembled / Exploded buttons to separate the complete assembly.
- Hide, show, isolate or focus a part. Reset restores every component and the camera.
- Use the Top / Front / 3D views, component label toggle or auto rotation.
- Follow five stages in Power path to learn how the DAB transfers energy.
- Open **AI opportunities** to identify 15 proposed AI applications across design, control and maintenance. Select a component or explore all hardware; choosing an application outlines its physical targets in 3D.
- A link ending in `/?mode=ai` opens directly in AI opportunities mode.
- Read **What** for the task, data modality, inputs and outputs; **Which** for candidate methods and rationale; **How** for training, execution location, implementation and validation. The map distinguishes passive hardware targets from the computer performing the algorithm.
- Export a GLB containing all 29 named component groups, materials and metadata, in assembled coordinates regardless of the current view.

Keyboard shortcuts: **E** explode, **X** extract selected part, **I** isolate, **H** hide/show, **R** reset, **Escape** exit isolation. Shortcuts are disabled while typing or reading the explanatory dialog.

## Component inventory

| System | Separable parts |
| --- | --- |
| Semiconductors | 4 HV SiC MOSFETs + 4 LV silicon MOSFETs |
| Capacitors | 2 HV DC-link + 4 LV DC-link capacitors |
| Magnetics | Isolation transformer + transfer inductor |
| Gate drivers | 4 dual-channel gate driver boards |
| Control | Digital control card |
| Thermal | Finned aluminum heatsink |
| EMI | Filter board, common-mode choke, 2 film capacitors |
| Structure | Main PCB + 2 DC terminals |

Small supporting ICs, screws, traces, pins and windings belong to their parent component groups. Every listed part has its own identity and transform. Model export preserves that hierarchy.

## Architecture and limits

`src/data.js` owns the inventory, component descriptions and power-path stages. `geometry.js` builds the named mesh hierarchy. `scene.js` owns rendering, picking, camera behavior, eased transforms, resource cleanup and export. The React components own the accessible UI and application state; animation does not trigger React rendering every frame.

Targets, dimensions, electrical routing and thermal interfaces are illustrative. The app is not a circuit simulation, manufacturing model, reference-board reproduction or validated electrical/thermal/EMI design. Geometry uses arbitrary illustrative scene units.

The educational DAB explanation is grounded in [TI’s TIDA-010054 topology reference](https://www.ti.com/tool/TIDA-010054), a separate 10 kW design. Our 3 kW / 400 V / 48 V assembly is conceptual. No credentials or runtime service are required by the frontend.

## AI framework and tests

The application map follows Li et al., *Fundamentals of Artificial Intelligence for Power Electronics*, IEEE TIE, 2026, DOI [10.1109/TIE.2026.3715958](https://doi.org/10.1109/TIE.2026.3715958), and the [author Algorithm Selector](https://github.com/XinzeLee/AI_for_PE_Algorithm_Selector). Framework attribution, source anchors and the proposed-application boundary are documented in `docs/ai-framework.md`.

The 15 converter mappings are educational proposals, not trained models or paper-validated results for this concept hardware. No inference, model training, sensor stream, simulated AI performance or autonomous hardware control runs in the site. Additional instrumentation is identified where needed. Real-time inference is conditional on target-specific timing and validation; agents operate in an engineering tool environment outside the switching loop.

`src/aiData.js` owns the source record, applications and filter helpers. `AIExplorer.jsx` and `ai.css` provide the responsive What / Which / How panel. `ai-integration.css` positions it within the retained explorer. Scene highlights are separate helper objects outside the exported hardware root and do not mutate shared mesh materials.

Run `npm test` (or `node --test tests/ai-map.test.mjs`) for physical-target coverage, lifecycle/part filtering and complete framework records. Browser QA separately verifies rendered interactions, responsive layout and export.

Design: `docs/design.md`. Hosting identity and static directory: `.openai/hosting.json`.
