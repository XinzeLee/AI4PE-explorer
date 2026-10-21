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

Design: `docs/design.md`. Hosting identity and static directory: `.openai/hosting.json`.
