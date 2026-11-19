# Source provenance and modifications

This project contains code from [e3da/PowerSynth2-core](https://github.com/e3da/PowerSynth2-core), revision **88af2fff2467f2e01db1d0ffc6c8c420968d65fc**, under its GNU GPL version 3 license. The complete upstream license is retained as `LICENSE`. The authors identified in the upstream sources include John Calvin Alumbaugh, Imam Al Razi, Quang Le, and other PowerSynth contributors. Upstream project attribution also includes the E3DA and MSCAD laboratories at the University of Arkansas.

The downloaded UTF-8 source excerpts are preserved under `reference/`, with checksums in `reference/SHA256.json`. Downloads are not performed during package installation or normal use. `tools/extract_upstream.py` reproducibly creates the following modules:

| Installed vendor module | Upstream source and retained portion | Changes |
|---|---|---|
| `corner_stitch.py` | `engine/CornerStitch/CornerStitch.py`, complete geometry/tree implementation | Removed unused plotting/NetworkX imports; adapter resets global tile counters under a lock |
| `graph_types.py` | `engine/ConstrGraph/CGStructures.py`, `Vertex` and `Edge` | Extracted data records without plotting or graph-search dependencies |
| `self_inductance.py` | `model/electrical/parasitics/equations.py`, `self_ind_py` and `CalVal2` | Extracted relevant numerical kernels; enabled Numba disk caching |
| `mutual_inductance.py` | `model/electrical/parasitics/mutual_inductance_64.py`, `inter_func1`, `outer_addition`, `mutual_between_bars` | Removed examples/plotting; enabled Numba disk caching |
| `mna_solver.py` | `model/electrical/solver/mna_solver.py`, circuit solver class | Corrected single-branch transpose-matrix indexing and current-source KCL signs; removed examples, unused plotting import, and global warning suppression |
| `impedance_solver.py` | `model/electrical/solver/impedance_solver.py`, `Port` and `ImpedanceSolver` | Replaced removed `np.complex`; fixed port reset typo; preserved complex transfer-impedance phase; converted singleton arrays explicitly |
| `nsga2.py` | `opt/optimizer.py`, `DesignVar` and `NSGAII_Optimizer` | Retained the actual upstream DEAP μ+λ loop, NSGA-II selection, blend crossover, bounded Gaussian mutation, and settings; namespaced/reused DEAP creator classes to support repeated runs; removed unrelated annealing and example imports |

The new public `model`, `geometry`, `placement`, `mesh`, `electrical`, `solver`, `api`, export, and CLI layers are implementations for this reduced scope. In particular:

- The original large hierarchical `CGCreation` and 3D floorplan-generation modules are **not** copied wholesale. A new two-axis difference-constraint/LP adapter preserves coordinate ordering and fixed footprint dimensions.
- The copper finite-volume mesh and the side-effect-free branch/nodal solver are **new adapters**, not the full original PowerSynth mesher/electrical API. The extracted legacy circuit solvers remain available privately and are covered by regression tests.
- Round-wire geometry, general-orientation Neumann quadrature, and external-return-path support are new reduced-scope code. The exact retained upstream rectangular-bar kernels are identified above.
- The upstream hard-coded 1 MHz multi-loop orchestration is not used. Frequency is an explicit argument to every public evaluation.
- No thermal, MATLAB, Qt, database, or GUI code is imported by the installed package. The optional `optimization` extra adds DEAP; it is imported only when `optimize_pareto()` runs.
- The Pareto search uses the extracted upstream NSGA-II controller. Its new reduced-scope decoder projects bounded coordinate targets onto the two feasible constraint graphs using a normalized L1 linear program. It preserves the fixed floorplan and topology; it does not reproduce the complete upstream hierarchical longest-path/slack decoder. Warm starts, geometry deduplication, evaluation caching, caller RNG preservation, and common-mesh Pareto exports are new adapters. Screening/refined fronts are finite sampled sets rather than proven global optima.

The self-inductance formula's upstream comments credit FastHenry's `joelself.c`. The original mutual-inductance source cites the NIST rectangular-conductor inductance work; its implementation is retained with attribution through the upstream source excerpts. This project makes no claim of authorship of those equations.

The synthetic `examples/half_bridge.json` is a new diagnostic design for this package. It is not a copied published PowerSynth benchmark and does not imply validation of a fabricated module.

The corrected paper-linked `examples/tpel2019_2R.json` comes from `e3da/PowerSynth2-pkg`, revision `a1de7ced949c0fd0105d166767b1de8705eb65ab`, directory `work/Sample_Designs/2D_Case_2R`. Source files, checksums, and the original image are in `reference/benchmarks/tpel2019_2R/`. Copper and component coordinates are preserved after translation. Pin resolution, high-side orientation, assumed wire height, material values, and other adaptations are declared in `examples/tpel2019_2R.provenance.json` and `PAPER_REFERENCE.md`. The upstream README links the example to the 2019 publication; it is not claimed to be identical to the hardware-tested Figure 8 vehicle.

For local validation only, the optional executable at `.tools/fasthenry.exe` was downloaded from the official PowerSynth package repository, revision **a1de7ced949c0fd0105d166767b1de8705eb65ab**, path `bin/fasthenry.exe`. Its SHA-256 is **15222df96d989019d563051816e3f9781539f37bb1f1a69ebcb30f9c08642177**. This local reference tool is excluded from the Python distribution; it is not a runtime dependency. Its download provenance is also recorded beside the executable.
