# Paper-linked reference and corrected wire constraints

The supplied paper is Evans et al., **PowerSynth: A Power Module Layout Generation Tool**, IEEE TPEL 34(6), 5063–5078 (2019), [DOI 10.1109/TPEL.2018.2870346](https://doi.org/10.1109/TPEL.2018.2870346).

## Evidence from the paper

Section II-B (printed page 5066) requires Manhattan traces and bond wires. Figures 4 and 17 show straight, axis-aligned bonds in plan view. Figure 7 shows that raised 3D profiles are compatible with this straight XY projection. Section V-A positions wires relative to their parent devices: independent movement of device and landing coordinates was the missing coupling in the earlier synthetic implementation.

Figure 8 and Section III-B describe a **hardware-tested 40 × 50 mm** DBC vehicle: 200 μm copper, 635 μm AlN, pairs of 300 μm aluminum wires, and no active dies. Measurements span 10 kHz–1 MHz. This experimental validation does not automatically apply to other software layouts or models.

## Source-preserving reusable layout

The official [`2D_Case_2R` example](https://github.com/e3da/PowerSynth2-pkg/tree/a1de7ced949c0fd0105d166767b1de8705eb65ab/work/Sample_Designs/2D_Case_2R) explicitly states in its README that the layout, without reliability constraints, was used in the 2019 paper.

The imported example is **45 × 50 mm**, with seven patterned copper rectangles, four MOSFET footprints, five lead footprints, and eight bond-wire groups. Coordinates are shifted by (-5, -5) mm to place the substrate at the origin. All copper and component footprint coordinates are otherwise unchanged and fixed in this reference. The original official layout PNG is retained for comparison.

This is a paper-linked software benchmark, **not an exact reconstruction or new hardware validation of Figure 8**. Exact manufacturing CAD for that 40 × 50 mm vehicle was not identified in the inspected release files.

## Explicit adaptations

Legacy tiny bond-pad rectangles are symbolic markers and do not consistently coincide with `MOSFET.part` physical pads. The import uses catalog pin centers, rotates the high-side pin orientation by 180 degrees, and aligns trace landings with these pins. The symbolic markers are not represented as newly validated physical die pads.

Other declared assumptions:

- Power/gate diameters: 0.3/0.1 mm; one wire per source connection, matching the source table counts.
- Loop height: 1 mm, since the source technology file does not specify it.
- Copper and aluminum conductivities follow the paper; the legacy placeholder wire resistivity is not used.
- The source's 0.835 mm ceramic gap and floating 0.2 mm backside copper are retained, rather than substituting the Figure 8 vehicle's 0.635 mm gap.
- Frequency is explicitly 100 kHz. Internal device connections are near-ideal, with specified conducting states and a lead-to-lead port convention.
- Static source geometry rules are checked; the optional voltage/current reliability extension is disabled as specified for the paper-linked case.

The adaptations are recorded in [examples/tpel2019_2R.provenance.json](examples/tpel2019_2R.provenance.json). Original files, download URLs, SHA-256 checksums, and source imagery are in `reference/benchmarks/tpel2019_2R/`.

## Implementation corrections

`BondWire.planar_axis` rejects tilted plan-view spans. Terminals can inherit a coordinate from a physical component pin using `align_to` and `align_axis`; this coupling participates in placement constraints and finite-pad enclosure checks. Initial tilted geometry is rejected. Exact electrical ties prefer the baseline, and fixed backside-conductor boundaries cannot be overwritten by a requested floorplan size.

The synthetic example remains available for testing after correcting its landings. Its historical numerical reports are superseded because solver agreement did not establish compliance with the paper's geometry.

## Recorded checks at 100 kHz

| Check | Result |
|---|---|
| Source copper and footprint coordinates | Preserved after origin shift |
| Geometry and finite contact pads | Passed |
| Bond wires in plan view | 8/8 vertical; all Δx = 0 |
| Electrical connectivity | L5.P to L1.P conducting path |
| 8 / 6 / 4 mm meshes | 16.91101 / 15.79812 / 15.89669 nH |
| Final mesh-refinement change | 0.620%, below the configured 2% criterion |
| Package, 4 mm target mesh | 15.89669 nH; 4.15893 mΩ |
| FastHenry, matching graph and mesh | 15.79229 nH; 4.15877 mΩ |
| Inductance difference | 0.661% |

FastHenry uses equal-area square wire cross sections and idealizes the nearly ideal device links. This checks two numerical model configurations, not error against physical hardware. Mesh refinement does not validate assumed wire heights or technology parameters.

Reproduce the source conversion and checks:

```powershell
.\.venv\Scripts\python.exe tools/build_paper_reference.py
.\.venv\Scripts\python.exe tools/validate_paper_reference.py --fasthenry .tools/fasthenry.exe
.\.venv\Scripts\python.exe -m pytest -q
```

The report, top-view PNG/SVG, reference design, wire audit, and electrical evidence are in `results/paper_reference/`.
