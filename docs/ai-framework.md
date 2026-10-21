# AI opportunities extension

## Intent and requirements

The existing separable 3D converter remains the artifact. Add an educational AI application map grounded in the exact TIE **What–Which–How** framework, linked to physical components. Identify useful tasks, candidate methods, data, training/runtime locations, engineering constraints and validation. Preserve original explorer, power path, separation and GLB export. Publish to the existing private site with its current audience.

No trained models, measurements, predicted performance or autonomous converter control are implemented or implied.

## Verified primary sources

- Li et al., *Fundamentals of Artificial Intelligence for Power Electronics*, IEEE Transactions on Industrial Electronics, 2026. DOI [10.1109/TIE.2026.3715958](https://doi.org/10.1109/TIE.2026.3715958). [IEEE record](https://ieeexplore.ieee.org/document/11707256).
- [Author-uploaded full manuscript](https://www.researchgate.net/publication/411564495_Fundamentals_of_Artificial_Intelligence_for_Power_Electronics), uploaded by Fanfan Lin on August 5, 2026. Full extracted text reviewed for framework and section references.
- [Author companion repository](https://github.com/XinzeLee/Fundamentals_of_AI_for_PE).
- [Author Algorithm Selector](https://github.com/XinzeLee/AI_for_PE_Algorithm_Selector). Its README explicitly maps What / Which / How and revised paper sections.

## Attribution boundary

The framework and methodology categories come from the paper. The converter-specific entries in `src/aiData.js` are original **proposed applications** of that framework. They do not claim that the paper experimentally validates this 3 kW concept, its sensors, dimensions or component choices. Linked sources explain methodology and related examples, not measured results for this model.

## Evidence anchors

| Source anchor | Use in the explorer |
| --- | --- |
| §I, Fig. 1 | Problem-first What → Which → How organization |
| §II, Fig. 2 | Distinguish tabular, ordered signals, spatial fields, connected graphs and unstructured documents |
| §III, Fig. 3 | Acquisition, EDA/preprocessing, training, tuning, deployment |
| §III-D–G | Learning type, method/data fit, held-out evaluation and complexity checks |
| §IV | Physics-informed loss/architecture; physical penalties need independent checks |
| §V; VII-C | Realizable constrained optimization and stochastic repeated-run comparisons |
| §VI | Agentic orchestration of engineering tools with traceable verification |
| §VII-D, Fig. 17 | Compact embedded modulation/control: accuracy, latency and model size |

The main companion includes related DAB modulation, magnetic-loss and IGBT maintenance examples. Their exact implementations are not copied into the app. Some repository excerpts use older figure numbers; this document uses the author manuscript numbering.

## Completion checklist

- [x] Verify the exact paper and framework from primary author sources.
- [x] Define proposed applications for all seven required component systems and supporting structure.
- [x] Implement selectable physical targets with separate scene-owned AI highlights.
- [x] Add responsive What / Which / How exploration, phase and part filters, citations and runtime/data distinctions.
- [x] Verify coverage, selection/filter state, original functionality, responsive rendering, export and production build.
- [ ] Save and publish the exact verified source to the existing private site.

## Verification evidence at source save

- Three Node tests pass: complete physical-target coverage (29/29), lifecycle/part filter composition and complete What/Which/How records. Unknown IDs are rejected by coverage assertions.
- In-app browser: all 15 application selections were checked against displayed target chips and scene target IDs. Empty filters clear the scene highlights and recover using Show all phases.
- Desktop and 390 × 844 mobile verified. Mobile filters collapse, What/Which/How tabs remain visible, the panel collapses to enlarge the canvas, and keyboard Left/Right tab navigation works.
- Verified application target reveal, single-part isolation, group focus, original extraction / hide / show / reset and power-path navigation.
- Export while AI highlights were active: glTF 2.0 binary parses successfully, 29 unique physical component groups and 679 meshes, zero AI annotation nodes. Highlights remain outside the export root.
- Source content independently reviewed against the author manuscript and companion material: no blocking scientific/attribution findings. No trained-model or measured-performance claims.
- Browser console and production build checked. Other browsers and native touch gestures have not been tested.
