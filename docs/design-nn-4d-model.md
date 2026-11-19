# Design NN v2: four geometry inputs → loop inductance

This version expands the controlled PowerSynth module family to four physical inputs and uses **256 fresh reduced-PEEC labels** at one common **4 mm target mesh**. The output is the modeled loop inductance of the **L5.P → L1.P path at 100 kHz**. The browser evaluates a fixed offline-trained neural network; moving a control does not run the solver or train a new model.

The completed two-input experiment remains unchanged in `public/models/design-nn/`, `src/designNN.js`, `scripts/reproduce-design-nn.py`, and [the v1 record](design-nn-model.md). Its 128 targets are not mixed into the new dataset. Version 2 reuses the same individually hashed source snapshot at `public/models/design-nn/source/`, with that relative location recorded in provenance, and has its own data, cache, split, model, metrics and audits in `public/models/design-nn-4d/`.

## Physical family and valid bounds

| Input | Symbol | Bounds (mm) | Physical meaning |
|---|---|---|---|
| `spineWidth` | w | 7–13 | Width of the right SW copper return spine T3 |
| `gap` | g | 0.5–2.5 | Vertical clearance from DC_MINUS/T1 to the SW lower edge |
| `barHeight` | h | 4.75–6 | Height of the DC_MINUS/T1 copper bar, from fixed y = 2 |
| `dieOffset` | dx | −0.75–0.75 | Joint x translation of low-side dies D1/D2 from source x = 8/17 |

The source default is `(w,g,h,dx) = (10,2,6,0)`. For `y0 = 2 + h + g`, rectangles use `(x,y,width,height)` in millimetres:

```text
T1 = (2,      2,    40,   h)
T2 = (2,      y0,   40-w, 18-y0)
T3 = (42-w,   y0,   w,    42-y0)
D1 = (8+dx,   y0+1, 4,    6)
D2 = (17+dx,  y0+1, 4,    6)
```

These five objects are released in their generated `fixed` flags; all other source geometry and specifications are retained. Increasing either h or g moves the low die row vertically while changing the SW shelf height and spine length. The die offset moves both low dies together without changing their spacing or footprint size. Landing-pad x coordinates inherit the physical pin coordinates, keeping all eight bond projections vertical.

The bounds follow source geometry and rules. Fixed lead L1 ends at y = 6, so its 0.5 mm enclosure requires h ≥ 4.5 mm; h ≥ 4.75 adds margin. Low dies must fit below the fixed SW upper edge y = 18 with 0.5 mm enclosure, requiring h + g ≤ 8.5. Choosing h ≤ 6 retains the v1 gap range through 2.5 mm in a feasible rectangle. The source coordinate ordering allows approximately −1 < dx < 1, so ±0.75 adds margin. Fixed L2 enclosure and foreign-copper clearance bound the spine width to 6.5–13.5; the chosen 7–13 mm interval adds margin.

A **7⁴ grid including all 16 corners, plus all 256 realized samples**, passes 2,657 source geometry checks. These cover finite pads, planar rules, topology, conservative foreign-copper wire checks, fixed leads/high dies, fixed ports, unchanged electrical settings, and eight vertical wire projections. The source's 0.001 mm planar lattice is used consistently by sampling, browser geometry and prediction. Full geometries are hashed and deduplicated after realization.

The 45 × 50 mm substrate, 0.2 mm copper layers, 0.835 mm ceramic gap, floating backside plane, five lead locations, high-side dies, device footprints/pins, materials and wire technology remain fixed. All four explicit near-ideal D–S extraction links remain enabled. Source wire heights are assumed 1 mm, with power/gate diameters 0.3/0.1 mm. These are the declared benchmark adaptations, not newly validated hardware dimensions. The rotatable module and dimensioned plan depict this actual parameterized source geometry in a separate viewer from the conceptual converter assembly.

## Sampling and numerical labels

The split is assigned before any labels are obtained:

- **160 training layouts:** 16 corners, eight face centers, domain center, source base, and 134 Latin-hypercube points with seed 42.
- **48 validation layouts:** independent interior Latin-hypercube points with seed 43.
- **48 test layouts:** independent interior Latin-hypercube points with seed 44.

The test measures **interior interpolation within this four-input rectangle**. Corners and face centers are represented in training; the test does not assess unseen boundaries, extrapolation, or other routing topologies. Requested and realized parameters, geometry hashes and the preassigned split are saved before scoring; the complete generated geometries are retained with the raw results. The run aborts on realized duplicates and retains failed-evaluation diagnostics without inventing targets.

All 256 main targets use `MeshSettings(cell_mm=4, thickness_cells=1, quadrature_order=6, max_branches=5000, wire_segments=None)`. Source bond groups retain eight segments. Up to four CPU processes use one BLAS thread each. Checkpoints are written after successful evaluations; source bytes, Python/NumPy/SciPy/Numba/NetworkX versions, full geometry and mesh settings pin the cache. No optimization-selected, v1, analytic-formula or NN-generated target supplies a new main label.

The raw dataset and audit are separate. Four declared 4D corner fixtures, domain center and source base have additional **4→3 mm** checks. Two opposite new corners and the source base have FastHenry shared-graph comparisons. These checks never replace selected main labels with finer results. FastHenry represents round wires as equal-area square bars and idealizes the near-ideal device links; it checks calculation on the same exported conductor representation rather than independently validating geometry or hardware. Exact executable/input hashes and solver options are saved.

## Training and conditional response landscapes

Input and output scalers use the **160 training rows only**. Candidate float64 MLPs have architectures **4 → 32 → 32 → 1** and **4 → 64 → 64 → 1**, with tanh activations and predeclared seeds 42, 43 and 44. Adam uses learning rate 0.01 and weight decay 10⁻⁵, up to 4,000 epochs with 500-epoch validation patience. Checkpoint and architecture selection use validation MSE, excluding the test targets. A polynomial Ridge comparator chooses degree 1–3 by validation only. Exported weights preserve PyTorch's output/input ordering; native JavaScript double-precision inference is checked against Python on every sample. Polynomial powers and coefficients make the comparator independently checkable.

The recorded validation selection is **4 → 64 → 64 → 1**, seed 44, checkpoint epoch 97. The untouched 48-point interior test split gives:

| Predictor | Test MAE (nH) | Test RMSE (nH) | Test maximum absolute error (nH) | Test MAPE |
|---|---:|---:|---:|---:|
| Selected tanh MLP | 0.065075 | 0.084633 | 0.225225 | 0.411081% |
| Validation-selected degree-3 Ridge | 0.058110 | 0.074984 | 0.181874 | 0.368072% |

The Ridge comparator has lower test error on this split. The frozen neural model is retained to demonstrate its learned geometry mapping and architecture; the test results are not used to retune it. MLP training and validation RMSE are 0.072770 and 0.065036 nH. These errors measure fidelity to the common 4 mm estimator, with no claim of extrapolation or hardware accuracy.

The separate six-fixture 4→3 mm audit has **three checks above 2%**, with maximum change **2.362283%**. Three FastHenry shared-graph differences are **0.600387%, 0.696228% and 0.661074%**. Mesh sensitivity remains a distinct source of uncertainty from the NN approximation error.

The browser response landscape is a **conditional NN surface**: two chosen geometry inputs form the horizontal axes, predicted inductance is the vertical axis, and the other two inputs remain fixed at their current controls. Changing either held input recomputes that surface. Grid values are NN estimates, not new solver results. The selected marker is evaluated at all four actual inputs, including positions between grid nodes. Solver references use exact realized four-coordinate lookup; nearby or interpolated labels are never presented as exact solver values.

Artifacts in `public/models/design-nn-4d/` include `model.json`, `samples.json`, `samples.csv`, `dataset.json`, `geometries.json`, `sampling-plan.json`, `split-indices.json`, `parity.json`, `geometry-parity.json`, `audit.json`, `geometry-audit.json`, cache/checkpoint files, `provenance.json`, and file hashes. Model metrics report MAE, RMSE, maximum absolute error in nH and percentage error for each split. Mesh sensitivity is reported separately from NN approximation error.

## Scope and reproduction

This model approximates a specified **4 mm numerical estimator**, with input-dependent discretization. The mesher adds geometry/contact-dependent cuts and coalesces nearly coincident cuts, so smooth physical changes can cause deterministic label roughness. One thickness cell and uniform-current filaments do not automatically resolve skin depth. The model excludes capacitance, magnetic materials, temperature, external fixture inductance and full 3D manufacturing signoff. Test error and shared-graph agreement do not establish hardware accuracy or an uncertainty interval.

```powershell
# Generate or resume this fresh 4D dataset, then train and export.
& D:/powersynth/.venv/Scripts/python.exe -B scripts/reproduce-design-nn-4d.py

# Audit the domain without numerical labels.
python -B scripts/reproduce-design-nn-4d.py --geometry-only

# Retrain/export using integrity-checked completed targets, without solver work.
python -B scripts/reproduce-design-nn-4d.py --train-only
```

The script imports the preserved v1 **source** snapshot, never its labels, and writes only this project's v2 data/runtime cache locations. It does not modify `D:/powersynth` or the completed v1 experiment. Exact runtime versions and the reproduction-script hash are recorded. `--train-only` verifies the physics fingerprint, deterministic split/features, actual geometry hashes, common mesh, valid target/residual and exact pinned cache equality before export. The local FastHenry executable is optional and is not distributed; another installation can be selected with `--fasthenry`.

PowerSynth source attribution and its GPL version 3 license remain in the preserved source snapshot: [`THIRD_PARTY.md`](../public/models/design-nn/source/THIRD_PARTY.md), [`LICENSE-GPL-3.0.txt`](../public/models/design-nn/source/LICENSE-GPL-3.0.txt), and the original file notices. The pinned upstream core revision is `88af2fff2467f2e01db1d0ffc6c8c420968d65fc`; the paper-linked benchmark package revision is `a1de7ced949c0fd0105d166767b1de8705eb65ab`. The source adapters used for these labels are shipped and individually hashed.
