# Design NN: controlled module geometry → loop inductance

This companion lab trains a small neural network on **128 new reduced-PEEC evaluations** of one controlled geometry family. Its browser prediction estimates the specified solver at a common **4 mm target mesh**, for the **L5.P → L1.P port at 100 kHz**. It is an educational numerical surrogate with separately recorded mesh and shared-graph solver checks. No measured hardware labels are used.

The real trained model, preassigned split, full geometries, full electrical results, and source snapshot are shipped under [`public/models/design-nn/`](../public/models/design-nn/). [`model.json`](../public/models/design-nn/model.json) contains the resulting train/validation/test MAE, RMSE and maximum absolute error in nH. [`audit.json`](../public/models/design-nn/audit.json) reports mesh sensitivity and FastHenry differences separately from NN approximation error.

## Physical slice and source fidelity

The preserved source is the official paper-linked `2D_Case_2R` benchmark, with the explicit physical-pin and wire adaptations recorded in [`source/tpel2019_2R.provenance.json`](../public/models/design-nn/source/tpel2019_2R.provenance.json). This is not a replica of the paper's hardware-tested Figure 8 vehicle.

Two bounded physical inputs completely specify the varying geometry:

| Input | Range | Meaning |
|---|---|---|
| `spineWidth` | 7–13 mm | Width of the right-hand SW copper return spine T3 |
| `gap` | 0.5–2.5 mm | Vertical copper clearance from the DC_MINUS/T1 upper edge to the SW lower edge |

For width `w` and gap `g`, set `y0 = 8 + g`. Rectangles use `(x, y, width, height)` in mm:

```text
T2 = (2,      y0,   40-w, 18-y0)
T3 = (42-w,   y0,   w,    42-y0)
D1 = (8,      y0+1, 4,    6)
D2 = (17,     y0+1, 4,    6)
```

The gap therefore changes the lower SW bar's height, the return spine's length, and the lower die row's y position together. It does not translate the entire module. Only T2, T3, D1 and D2 are released in the generated design's `fixed` flags. All other source fields remain fixed. The source base is `(10, 2)`; the domain center is `(10, 1.5)`.

The source geometry kernel requires a **0.001 mm planar lattice**. Offline sampling and browser geometry/inference both realize inputs on that lattice. The sliders and numeric controls use that same 0.001 mm step. The UI and prediction always describe the same realized geometry.

The 45 × 50 mm substrate, five leads, backside plane, high-side dies, die footprints/pins, materials, topology, wire technology and measurement settings remain fixed. All eight bonds inherit their die pin's x coordinate at their trace landing; their XY projections stay vertical while their 3D profiles arch upward by the source's assumed 1 mm. The UI renders that source geometry in its own viewer, independent of the conceptual converter and its export assembly.

The top and back copper thickness is 0.2 mm, with resistivity 1.67785235 × 10⁻⁸ Ω·m. The top copper's bottom z is 1.035 mm; the backside's is 0 mm. The 0.835 mm ceramic gap is retained. Power and gate bond diameters are 0.3 and 0.1 mm, with resistivity 2.65251989 × 10⁻⁸ Ω·m. The four explicit D–S links are enabled, each 1 µΩ with zero inductance; these define an extraction configuration rather than a switching-control sequence.

## Dataset and split

The split is fixed **before obtaining any labels**:

- Training: 80 layouts — 24 perimeter points, domain center, source base, and 54 Latin-hypercube points with seed 42.
- Validation: 24 independent Latin-hypercube points with seed 43.
- Test: 24 independent off-grid Latin-hypercube points with seed 44.

The held-out test assesses **interior interpolation** within the declared rectangle. Training explicitly covers the boundaries; the test does not measure performance on an unseen boundary or outside this geometry family.

Requested inputs are realized on the required lattice. Full geometries are hashed and deduplicated before labels are generated. The deterministic sampling aborts if realization introduces a duplicate; it does not copy targets or move a sample after observing its score. The existing optimization-selected Pareto layouts and legacy synthetic examples supply **no targets** for this dataset.

Before evaluation, the script checks a 41 × 41 domain grid plus all 128 realized samples: 1,809 checks for planar rules, finite pads, conservative foreign-copper intersections, topology, source fixtures/ports, unchanged electrical settings, and straight bond projections. No domain tightening was needed. Full source validation is repeated when the solver builds each mesh.

Each main label uses `MeshSettings(cell_mm=4, thickness_cells=1, quadrature_order=6, max_branches=5000, wire_segments=None)`. `None` retains the source's eight segments per wire. Four CPU worker processes use one BLAS thread each. The cache key pins complete geometry and mesh; its physics fingerprint additionally pins every bundled source file and the Python/NumPy/SciPy/Numba/NetworkX versions. Checkpoints are written after every successful evaluation. Invalid evaluations receive diagnostics without a fabricated numerical target.

Artifacts include:

- `samples.csv` / `samples.json`: inputs, split, nH labels, resistance, mesh/frequency, geometry hash, branch/node count, runtime and residual.
- `dataset.json`: complete source-schema geometry and complete PEEC result for every sample.
- `geometries.json`: complete generated geometries for direct preview parity checks.
- `split-indices.json`: immutable preassigned sample indices.
- `parity.json` and `geometry-parity.json`: Python inference and source endpoint/wire-profile fixtures for browser verification.
- `evaluation-cache.json`, `progress.json`, `failures.json`: resumable numerical evaluations and status.
- `provenance.json` and `source/`: source hashes, software versions, reproducible code and original notices.

## Training and browser inference

Input and output `StandardScaler` instances are fitted to the **80 training rows only**, using population standard deviations. Candidate networks have two tanh hidden layers, with widths 16 or 32, and one scalar output. Each size uses the predeclared seeds 42, 43 and 44. Adam uses learning rate 0.01 and weight decay 10⁻⁵, up to 4,000 epochs with 500-epoch validation patience. The checkpoint and architecture are chosen by validation MSE; the test labels are excluded until the winner is frozen.

The exported model reports the selected architecture, checkpoint epoch, seed, all validation candidates, and independent test metrics. A simple polynomial Ridge baseline (degree selected from 1–3 using validation only) is reported for context. The browser always uses the exported MLP, without training, network requests to a model service, or an ML runtime dependency. Linear weights retain PyTorch's `[output][input]` ordering, and inference uses JavaScript double-precision arithmetic matching the offline float64 network.

The recorded run selected **2 → 16 → 16 → 1**. On the 24 untouched interior test geometries, the fixed model and the validation-selected degree-3 Ridge comparator produced:

| Predictor | Test MAE (nH) | Test RMSE (nH) | Test max absolute error (nH) | Test mean absolute percentage error |
|---|---:|---:|---:|---:|
| Selected tanh MLP | 0.037075 | 0.046213 | 0.111917 | 0.236916% |
| Degree-3 Ridge polynomial | 0.045457 | 0.058838 | 0.134689 | 0.290796% |

These results compare prediction with the **4 mm PEEC target**, with boundary locations already represented in training. They do not establish unseen-boundary, extrapolation, or hardware accuracy. The MLP training and validation RMSE were 0.022749 and 0.028183 nH, respectively. The exported polynomial powers, coefficients and parity values allow its test metrics to be checked independently in JavaScript.

`src/designNN.js` loads the model, summarized references and audit, validates their shapes, and exposes prediction, exact realized-geometry reference lookup, geometry generation and wire/endpoint helpers. Its default 41 × 41 landscape consists of **NN predictions**, not new solver evaluations. Missing exact solver references remain missing; nearest neighbours and interpolated scores are never presented as solver truth. Loading supports cancellation and retry.

## Numerical and physical limits

Six fixed sentinels — four corners, domain center and source base — are evaluated at **both 4 and 3 mm**. These checks are separate from the single-fidelity main label column; selected labels are never replaced with finer values. Each check reports `abs(L4 − L3) / L3` and the configured 2% last-change criterion. The UI shows the actual maximum and failed status when applicable. Passing one last-change criterion is not proof of convergence for the continuous domain.

In this run, **five of six** sentinels exceeded 2%; changes ranged from **1.868692% to 2.900854%**. All three FastHenry checks completed, with inductance differences of **0.614126%, 0.700191% and 0.661074%** from the matching 4 mm conductor graph. The full-precision values and individual fixtures are retained in the audit.

Three predeclared fixtures — the source base and two opposite corners — also have an optional FastHenry comparison. The executable is used locally and is not distributed. These checks export the **same conductor graph**, represent circular wires as equal-area square bars, and idealize near-ideal device links. They check electrical calculation on the shared representation; they are not independent geometric or hardware validation. The audit preserves executable/input hashes, solver options, mesh settings and model differences.

NN error measures approximation of the 4 mm numerical estimator. Mesh refinement sensitivity is a different error source and can exceed the NN error. The target mesher adds geometry/contact-dependent cuts and coalesces nearly coincident cuts, so changing geometry can change discretization abruptly. The model's one thickness cell uses uniform-current filaments and DC material resistivity; it does not automatically resolve skin depth. Capacitance, magnetic materials, thermal behavior, external fixture inductance and full 3D manufacturing signoff are outside this model. No uncertainty interval or guaranteed physical accuracy is inferred from the test metrics.

## Reproduction and attribution

The initial snapshot was copied read-only from `D:/powersynth`; that repository is not modified. The copied reduced-core source retains PowerSynth contributor attribution, including the E3DA and MSCAD laboratories at the University of Arkansas, and the upstream GPL version 3 license. See [`source/THIRD_PARTY.md`](../public/models/design-nn/source/THIRD_PARTY.md), [`source/LICENSE-GPL-3.0.txt`](../public/models/design-nn/source/LICENSE-GPL-3.0.txt), and the file-level notices. The upstream core revision is `88af2fff2467f2e01db1d0ffc6c8c420968d65fc`; the benchmark package revision is `a1de7ced949c0fd0105d166767b1de8705eb65ab`. The exact reduced adapters used here are shipped as source and individually hashed.

On the configured Windows host:

```powershell
& D:/powersynth/.venv/Scripts/python.exe -B scripts/reproduce-design-nn.py
```

The script imports the **bundled source snapshot** and resumes matching evaluations. It creates Numba/temporary caches under `.openai/design-nn/`, inside this project. For a fresh source snapshot, use `--snapshot-from D:/powersynth`; a changed physics fingerprint refuses to mix existing labels. The environment needs NumPy, SciPy, NetworkX, Numba, threadpoolctl, scikit-learn and CPU PyTorch; exact run versions are recorded in provenance.

```powershell
# Validate the geometry domain without labels or training.
python -B scripts/reproduce-design-nn.py --geometry-only

# Retrain/export from completed, integrity-checked labels without solver work.
python -B scripts/reproduce-design-nn.py --train-only

# Run parity, data integrity and integration checks.
npm test
npm run build
```

`--train-only` verifies the source/software fingerprint, planned split and inputs, each actual geometry hash, the common mesh, positive target/residual, and equality with the pinned cache before exporting. Test metrics can be reproduced without obtaining any external dataset or modifying the external solver repository.
