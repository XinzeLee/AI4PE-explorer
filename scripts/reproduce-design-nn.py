"""Generate a controlled PowerSynth PEEC dataset and train the Design NN.

This script is new for the explorer (2026-10-24). The bundled reduced-core
PowerSynth source retains its GPL-3.0 license and original attribution.

First run: python -B scripts/reproduce-design-nn.py --snapshot-from D:/powersynth
Resume/retrain offline: python -B scripts/reproduce-design-nn.py
Train from completed labels only: python -B scripts/reproduce-design-nn.py --train-only
No legacy optimization labels, formulas, or surrogate-generated labels are used.
"""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/models/design-nn"
SOURCE = OUTPUT / "source"
RUNTIME = ROOT / ".openai/design-nn"
RUNTIME.mkdir(parents=True, exist_ok=True)
for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[name] = "1"
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.dont_write_bytecode = True
os.environ["NUMBA_CACHE_DIR"] = str(RUNTIME / "numba-cache")
os.environ["TORCH_HOME"] = str(RUNTIME / "torch")
(RUNTIME / "temp").mkdir(exist_ok=True)
tempfile.tempdir = str(RUNTIME / "temp")

SEED = 42
INPUTS = ["spineWidth", "gap"]
BOUNDS = [[7., 13.], [.5, 2.5]]
MESH = dict(cell_mm=4., thickness_cells=1, quadrature_order=6, max_branches=5000, wire_segments=None)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def digest_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_hash(value):
    def normalize(v):
        if isinstance(v, dict): return {k: normalize(a) for k, a in v.items()}
        if isinstance(v, (tuple, list)): return [normalize(a) for a in v]
        if isinstance(v, (int, float)) and not isinstance(v, bool): return float(v)
        return v
    return hashlib.sha256(json.dumps(normalize(value), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def snapshot(folder):
    """Copy only source into this project; never modify the external repository."""
    folder = Path(folder)
    for source in sorted((folder / "src/powersynth_layout").rglob("*.py")):
        target = SOURCE / "powersynth_layout" / source.relative_to(folder / "src/powersynth_layout")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    for name in ("tpel2019_2R.json", "tpel2019_2R.provenance.json"):
        shutil.copyfile(folder / "examples" / name, SOURCE / name)
    for original, filename in [("LICENSE", "LICENSE-GPL-3.0.txt"), ("THIRD_PARTY.md", "THIRD_PARTY.md"),
                               ("PAPER_REFERENCE.md", "PAPER_REFERENCE.md"), ("pyproject.toml", "pyproject.toml")]:
        shutil.copyfile(folder / original, SOURCE / filename)
    print("Copied pinned reduced-core source and benchmark into the project.", flush=True)


def configure_source():
    if not (SOURCE / "powersynth_layout/model.py").is_file():
        raise RuntimeError("Missing source snapshot. First run with --snapshot-from D:/powersynth.")
    sys.path.insert(0, str(SOURCE))


def make_geometry(base, width, gap):
    """Exact physical two-input slice; no feasible-projection decoder is used."""
    if not (BOUNDS[0][0] <= width <= BOUNDS[0][1] and BOUNDS[1][0] <= gap <= BOUNDS[1][1]):
        raise ValueError("Inputs outside the declared physical domain")
    # Positive dimensions use the same half-up lattice rule as Math.round in JS.
    width, gap = (math.floor(float(value) * 1000 + .5) / 1000 for value in (width, gap))
    d = copy.deepcopy(base)
    y0 = 8. + gap
    for r in d["regions"]:
        if r["id"] == "T2": r["rect_mm"] = [2., y0, 40. - width, 18. - y0]; r["fixed"] = False
        if r["id"] == "T3": r["rect_mm"] = [42. - width, y0, width, 42. - y0]; r["fixed"] = False
    for c in d["components"]:
        if c["id"] == "D1": c["rect_mm"] = [8., y0 + 1., 4., 6.]; c["fixed"] = False
        if c["id"] == "D2": c["rect_mm"] = [17., y0 + 1., 4., 6.]; c["fixed"] = False
    return d


def make_samples(base):
    import numpy as np
    from scipy.stats import qmc
    boundary = [(w, g) for w in np.linspace(7, 13, 7) for g in (.5, 2.5)]
    boundary += [(w, g) for w in (7., 13.) for g in np.linspace(.5, 2.5, 7)[1:-1]]
    train = boundary + [(10., 1.5), (10., 2.)]
    def lhs(n, seed):
        return qmc.scale(qmc.LatinHypercube(d=2, seed=seed).random(n), [7., .5], [13., 2.5]).tolist()
    groups = {"train": train + lhs(54, SEED), "validation": lhs(24, SEED + 1), "test": lhs(24, SEED + 2)}
    rows, seen = [], set()
    for split, points in groups.items():
        for w, g in points:
            requested = dict(spineWidth=float(w), gap=float(g))
            w, g = (math.floor(float(value) * 1000 + .5) / 1000 for value in (w, g))
            design = make_geometry(base, w, g)
            fingerprint = canonical_hash(design)
            if fingerprint in seen:
                raise RuntimeError("Duplicate realized geometry: sampling must be fixed before labels are obtained")
            seen.add(fingerprint)
            rows.append(dict(id=f"design_{len(rows):03d}", split=split, spineWidth=w, gap=g,
                             requestedInputs=requested, designHash=fingerprint, design=design))
    assert len(rows) == 128
    return rows


def geometry_audit(base, samples):
    import numpy as np
    from powersynth_layout import load_design, validate_layout
    from powersynth_layout.mesh import wire_points
    source = load_design(base)
    reference = load_design(make_geometry(base, 10., 2.))
    flags = []
    # Dense domain audit includes corners, every boundary, and center, independently
    # of training splits. Exact continuous geometry is still checked per sample.
    points = [(float(w), float(g)) for w in np.linspace(7, 13, 41) for g in np.linspace(.5, 2.5, 41)]
    points += [(p["spineWidth"], p["gap"]) for p in samples]
    for width, gap in points:
        d = load_design(make_geometry(reference.to_dict(), width, gap))
        result = validate_layout(d, reference=reference)
        vertical = all(np.ptp(wire_points(d, w)[:, 0]) < 1e-10 for w in d.bond_wires)
        fixtures = d.board_mm == source.board_mm and all(a == b for a, b in zip(d.components, source.components) if a.kind != "die")
        ports = all(d.endpoint(p) == source.endpoint(p) for p in (source.loop.source, source.loop.sink))
        conditions = (d.layers, d.bond_wires, d.terminals, d.paths, d.loop, d.rules) == (source.layers, source.bond_wires, source.terminals, source.paths, source.loop, source.rules)
        if not all((result.valid, vertical, fixtures, ports, conditions)):
            flags.append(dict(spineWidth=width, gap=gap, issues=list(result.issues),
                              verticalWires=vertical, fixedFixtures=fixtures, portsUnchanged=ports, conditionsUnchanged=conditions))
    value = dict(checkedCount=len(points), gridResolution=41, valid=not flags, failures=flags,
                 uniqueSamples=len({p["designHash"] for p in samples}), allWiresVertical=not flags,
                 substrateMM=[45, 50], fixedLeads=5, wireGroups=8, domainTightened=False,
                 planarLatticeMM=.001,
                 note="41×41 domain grid plus every realized sample; inputs realized on the required 1 µm lattice. Source topology, finite pads, conservative foreign-copper checks, fixed leads/ports, and electrical settings checked.")
    if flags: raise RuntimeError("Physical parameterization failed geometry preflight: " + json.dumps(flags[:5]))
    return value


def worker(payload):
    configure_source()
    from threadpoolctl import threadpool_limits
    from powersynth_layout import load_design, MeshSettings, evaluate_electrical
    design, mesh, executable = payload
    with threadpool_limits(limits=1):
        if executable:
            from powersynth_layout.fasthenry import compare_fasthenry
            return compare_fasthenry(load_design(design), executable, mesh=MeshSettings(**mesh), timeout_s=300)
        return evaluate_electrical(load_design(design), mesh=MeshSettings(**mesh)).to_dict()


def generate(base, samples, source_hash, workers, executable):
    from concurrent.futures import ProcessPoolExecutor, as_completed
    cachepath = OUTPUT / "evaluation-cache.json"
    cache = json.loads(cachepath.read_text()) if cachepath.exists() else {"physicsHash": source_hash, "evaluations": {}}
    if cache["physicsHash"] != source_hash: raise RuntimeError("Source snapshot changed; use a fresh output/cache to avoid mixed labels")
    failures = []
    progress = {"status": "running", "mainTotal": len(samples), "mainComplete": 0, "stage": "pilot", "failures": failures}
    def key(row, mesh): return canonical_hash(dict(designHash=row["designHash"], mesh=mesh))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        def batch(rows, mesh, stage):
            jobs, outputs = {}, {}
            progress["stage"] = stage
            for row in rows:
                k = key(row, mesh)
                if k in cache["evaluations"]:
                    outputs[row["id"]] = cache["evaluations"][k]
                else:
                    jobs[pool.submit(worker, (row["design"], mesh, None))] = (row, k)
            progress["mainComplete"] = sum(key(r, MESH) in cache["evaluations"] for r in samples)
            write_json(OUTPUT / "progress.json", progress)
            for job in as_completed(jobs):
                row, k = jobs[job]
                try:
                    result = job.result()
                    if not (result["inductance_h"] > 0 and result["relative_residual"] < 1e-7):
                        raise RuntimeError("Nonpositive target or failed solver residual")
                    outputs[row["id"]] = result
                    cache["evaluations"][k] = result
                    write_json(cachepath, cache)
                    progress["mainComplete"] = sum(key(r, MESH) in cache["evaluations"] for r in samples)
                    progress["lastCompleted"] = row["id"]
                    write_json(OUTPUT / "progress.json", progress)
                    print(f"{stage}: {row['id']} w={row['spineWidth']:.6f} g={row['gap']:.6f}: {result['inductance_nh']:.6f} nH ({result['elapsed_s']:.1f}s); main {progress['mainComplete']}/128", flush=True)
                except Exception as exc:
                    failures.append(dict(id=row["id"], stage=stage, diagnostic=f"{type(exc).__name__}: {exc}"))
                    write_json(OUTPUT / "progress.json", progress)
                    raise
            return outputs
        sentinel_coordinates = [(7., .5), (7., 2.5), (13., .5), (13., 2.5), (10., 1.5), (10., 2.)]
        sentinels = [next(p for p in samples if (p["spineWidth"], p["gap"]) == xy) for xy in sentinel_coordinates]
        four = batch(sentinels, MESH, "pilot-4mm")
        three = batch(sentinels, MESH | {"cell_mm": 3.}, "pilot-3mm")
        checks = []
        for row in sentinels:
            a, b = four[row["id"]], three[row["id"]]
            change = abs(a["inductance_h"] - b["inductance_h"]) / b["inductance_h"]
            checks.append(dict(id=row["id"], spineWidth=row["spineWidth"], gap=row["gap"],
                               coarse=a, fine=b, changePercent=100 * change, withinTolerance=change <= .02))
        audit = dict(mesh=dict(targetCellMM=4, finerCellMM=3, tolerancePercent=2, checks=checks,
                               maxChangePercent=max(v["changePercent"] for v in checks),
                               allWithinTolerance=all(v["withinTolerance"] for v in checks),
                               note="Separate 4→3 mm sentinel audit; all 128 training labels remain at common 4 mm. Last-change checks are not proof of physical accuracy."),
                     fastHenry=dict(available=bool(executable), checks=[], note="Shared conductor graph check, equal-area square wires and idealized device links; not independent geometry or hardware validation."))
        write_json(OUTPUT / "audit.json", audit)
        outputs = batch(samples, MESH, "main-4mm")
        for row in samples: row["electrical"] = outputs[row["id"]]
        write_json(OUTPUT / "dataset.json", samples)
        # Only three declared fixtures are compared; no test-set labels choose them.
        fhrows = [sentinels[0], sentinels[3], sentinels[5]]
        if executable:
            fhcache = OUTPUT / "fasthenry-cache.json"
            saved = json.loads(fhcache.read_text()) if fhcache.exists() else {}
            for row in fhrows:
                k = canonical_hash(dict(physicsHash=source_hash, designHash=row["designHash"], mesh=MESH, executableSHA256=digest_file(Path(executable))))
                if k not in saved:
                    saved[k] = pool.submit(worker, (row["design"], MESH, executable)).result()
                    write_json(fhcache, saved)
                result = saved[k]
                audit["fastHenry"]["checks"].append(dict(id=row["id"], spineWidth=row["spineWidth"], gap=row["gap"],
                    differencePercent=100 * result["relative_inductance_difference"], **result))
                write_json(OUTPUT / "audit.json", audit)
                print(f"FastHenry {row['id']}: {100*result['relative_inductance_difference']:.3f}% difference", flush=True)
            audit["fastHenry"]["maxDifferencePercent"] = max(v["differencePercent"] for v in audit["fastHenry"]["checks"])
        progress["status"] = "labels-complete"
        write_json(OUTPUT / "progress.json", progress)
        write_json(OUTPUT / "audit.json", audit)
    return samples, audit


def train_and_export(base, rows, audit, provenance):
    import numpy as np
    import sklearn
    import torch
    from sklearn.preprocessing import StandardScaler
    from torch import nn
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    write_json(OUTPUT / "dataset.json", rows)
    x = np.array([[p[k] for k in INPUTS] for p in rows])
    y = np.array([p["electrical"]["inductance_nh"] for p in rows]).reshape(-1, 1)
    split = {name: [i for i, p in enumerate(rows) if p["split"] == name] for name in ("train", "validation", "test")}
    xs = StandardScaler().fit(x[split["train"]])
    ys = StandardScaler().fit(y[split["train"]])
    features = torch.tensor(xs.transform(x), dtype=torch.float64)
    targets = torch.tensor(ys.transform(y), dtype=torch.float64)
    candidates = []
    # Validation-only selection between two compact sizes and three fixed seeds.
    # Test targets are not accessed until the single winner has been frozen.
    for width in (16, 32):
        for trial_seed in (SEED, SEED + 1, SEED + 2):
            torch.manual_seed(trial_seed)
            net = nn.Sequential(nn.Linear(2, width), nn.Tanh(), nn.Linear(width, width), nn.Tanh(), nn.Linear(width, 1)).double()
            optimizer = torch.optim.Adam(net.parameters(), lr=.01, weight_decay=1e-5)
            best_loss, best_state, best_epoch, stale = float("inf"), None, 0, 0
            for epoch in range(1, 4001):
                net.train(); optimizer.zero_grad()
                loss = torch.mean((net(features[split["train"]]) - targets[split["train"]]) ** 2)
                loss.backward(); optimizer.step()
                net.eval()
                with torch.no_grad(): val = torch.mean((net(features[split["validation"]]) - targets[split["validation"]]) ** 2).item()
                if val < best_loss - 1e-9:
                    best_loss, best_state, best_epoch, stale = val, copy.deepcopy(net.state_dict()), epoch, 0
                else: stale += 1
                if stale >= 500: break
            net.load_state_dict(best_state)
            candidates.append(dict(width=width, seed=trial_seed, validationMSEScaled=best_loss, epoch=best_epoch, stoppedEpoch=epoch, net=net))
    winner = min(candidates, key=lambda c: (c["validationMSEScaled"], c["width"], c["seed"]))
    net = winner["net"].eval()
    with torch.no_grad(): predicted = net(features).numpy() * ys.scale_ + ys.mean_
    def metrics(indices):
        errors = predicted[indices, 0] - y[indices, 0]
        return dict(count=len(indices), maeNH=float(np.mean(np.abs(errors))), rmseNH=float(np.sqrt(np.mean(errors ** 2))),
                    maxErrorNH=float(np.max(np.abs(errors))), mapePercent=float(np.mean(np.abs(errors / y[indices, 0])) * 100))
    all_metrics = {name: metrics(indices) for name, indices in split.items()}
    # Transparent simple baseline, selected polynomial degree by validation only.
    from sklearn.preprocessing import PolynomialFeatures
    from sklearn.linear_model import Ridge
    baselines = []
    for degree in (1, 2, 3):
        poly = PolynomialFeatures(degree=degree)
        transformed = poly.fit_transform(xs.transform(x))
        fit = Ridge(alpha=1e-5).fit(transformed[split["train"]], y[split["train"]])
        # sklearn 1.9 squeezes a single target even when fit with (n,1).
        # Restore the explicit output axis before scoring to avoid broadcasting.
        pred = np.asarray(fit.predict(transformed)).reshape(-1, 1)
        vmse = float(np.mean((pred[split["validation"]] - y[split["validation"]]) ** 2))
        baselines.append((vmse, degree, pred, np.asarray(fit.coef_).reshape(-1).tolist(),
                          float(np.asarray(fit.intercept_).reshape(-1)[0]), poly.powers_.tolist()))
    baseline = min(baselines, key=lambda v: (v[0], v[1]))
    baseline_errors = baseline[2][split["test"], 0] - y[split["test"], 0]
    layers = []
    for layer in net:
        if isinstance(layer, nn.Linear): layers.append(dict(type="linear", weight=layer.weight.detach().tolist(), bias=layer.bias.detach().tolist()))
        else: layers.append(dict(type="tanh"))
    network = dict(scaler=dict(mean=xs.mean_.tolist(), scale=xs.scale_.tolist()),
                   targetScaler=dict(mean=float(ys.mean_[0]), scale=float(ys.scale_[0])), layers=layers)
    summaries = [dict(id=p["id"], split=p["split"], spineWidth=p["spineWidth"], gap=p["gap"], designHash=p["designHash"],
                      requestedSpineWidth=p["requestedInputs"]["spineWidth"], requestedGap=p["requestedInputs"]["gap"],
                      inductanceNH=p["electrical"]["inductance_nh"], resistanceMilliOhm=p["electrical"]["resistance_mohm"],
                      targetMeshMM=4, frequencyHz=100000, softwareEstimate=True,
                      branchCount=p["electrical"]["branch_count"], nodeCount=p["electrical"]["node_count"],
                      elapsedS=p["electrical"]["elapsed_s"], relativeResidual=p["electrical"]["relative_residual"]) for p in rows]
    model = dict(schemaVersion=1, name="PowerSynth controlled-geometry loop-inductance surrogate", inputOrder=INPUTS,
                 inputSpec=[dict(key="spineWidth", label="SW spine width", unit="mm", minimum=7, maximum=13, step=.001, default=10),
                            dict(key="gap", label="DC− to SW gap", unit="mm", minimum=.5, maximum=2.5, step=.001, default=2)],
                 output=dict(key="inductanceNH", unit="nH", target="Reduced PEEC loop inductance at common 4 mm target mesh"),
                 baseDesign=base, network=network, metrics=all_metrics,
                 training=dict(seed=SEED, architecture=[2, winner["width"], winner["width"], 1], activation="tanh", dtype="float64",
                    selectedSeed=winner["seed"], selectedEpoch=winner["epoch"], maxEpochs=4000, earlyStoppingPatience=500,
                    optimizer="Adam", learningRate=.01, weightDecay=1e-5, scalerFit="training only; population standard deviation",
                    selection="Lowest validation MSE among widths 16/32 and seeds 42/43/44; test excluded until selection frozen",
                    candidates=[{k: v for k, v in c.items() if k != "net"} for c in candidates],
                    baseline=dict(kind="Ridge polynomial", degree=baseline[1], validationMSE=baseline[0],
                       candidates=[dict(degree=b[1], validationMSE=b[0]) for b in baselines],
                       powers=baseline[5], coefficients=baseline[3], intercept=baseline[4], inputScaling="Same training-only input StandardScaler as the MLP",
                       testMAENH=float(np.mean(np.abs(baseline_errors))), testRMSENH=float(np.sqrt(np.mean(baseline_errors**2))),
                       testMaxErrorNH=float(np.max(np.abs(baseline_errors))),
                       testMAPEPercent=float(np.mean(np.abs(baseline_errors / y[split["test"], 0])) * 100), testCount=24,
                       note="Simple validation-selected comparator; browser prediction uses the selected MLP.")),
                 dataset=dict(count=128, splitCounts={k: len(v) for k,v in split.items()}, mesh=MESH, rawFile="dataset.json", csvFile="samples.csv", geometryFile="geometries.json"),
                 provenance=provenance, limitations=["Educational surrogate for a specified numerical estimator; not hardware-validated.",
                    "Continuous interpolation inside a controlled two-parameter slice; other physical quantities remain fixed.",
                    "Input-dependent meshing can produce deterministic target roughness. Sentinel refinement does not bound every sample's error.",
                    "Uniform-current filaments, one thickness cell, DC resistivity; no automatic skin-depth mesh, capacitance, magnetic materials, thermal effects, or external fixture inductance."])
    model["provenance"]["runtimeVersions"] |= {"torch":torch.__version__, "sklearn":sklearn.__version__}
    model["provenance"]["reproductionScriptSHA256"] = digest_file(Path(__file__))
    write_json(OUTPUT / "model.json", model)
    write_json(OUTPUT / "samples.json", summaries)
    write_json(OUTPUT / "geometries.json", [{"id": p["id"], "designHash": p["designHash"], "design": p["design"]} for p in rows])
    write_json(OUTPUT / "split-indices.json", split)
    write_json(OUTPUT / "parity.json", [dict(inputs={k: p[k] for k in INPUTS}, inductanceNH=float(predicted[i,0]), baselineInductanceNH=float(baseline[2][i,0])) for i,p in enumerate(rows)])
    from powersynth_layout import load_design
    from powersynth_layout.mesh import wire_points
    fixtures = [p for p in rows if (p["spineWidth"], p["gap"]) in [(7.,.5),(7.,2.5),(13.,.5),(13.,2.5),(10.,1.5),(10.,2.)]]
    write_json(OUTPUT / "geometry-parity.json", [dict(inputs={k:p[k] for k in INPUTS},
        endpoints={ref: list(load_design(p["design"]).endpoint(ref)[0]) for ref in [*map(lambda t:t["id"],p["design"]["terminals"]),"L5.P","L1.P","D1.S","D2.G","D3.S","D4.G"]},
        wires={w.id:wire_points(load_design(p["design"]),w).tolist() for w in load_design(p["design"]).bond_wires}) for p in fixtures])
    with (OUTPUT / "samples.csv").open("w",newline="",encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(summaries[0])); writer.writeheader(); writer.writerows(summaries)
    write_json(OUTPUT / "provenance.json", model["provenance"])
    write_json(OUTPUT / "failures.json", json.loads((OUTPUT / "progress.json").read_text()).get("failures", []))
    write_json(OUTPUT / "artifact-hashes.json", {p.name:digest_file(p) for p in sorted(OUTPUT.glob("*")) if p.is_file() and p.name not in ("artifact-hashes.json", "progress.json") and not p.name.endswith(".tmp")})
    progress = json.loads((OUTPUT / "progress.json").read_text())
    write_json(OUTPUT / "progress.json", progress | {"status":"complete", "architecture":model["training"]["architecture"], "testMetrics":all_metrics["test"]})
    print(json.dumps(dict(architecture=model["training"]["architecture"], metrics=all_metrics, baseline=model["training"]["baseline"]), indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot-from", type=Path)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--fasthenry", type=Path, default=Path("D:/powersynth/.tools/fasthenry.exe"))
    parser.add_argument("--train-only", action="store_true")
    parser.add_argument("--geometry-only", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.workers <= 4: parser.error("workers must be 1–4")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if args.snapshot_from: snapshot(args.snapshot_from)
    configure_source()
    import numpy, scipy, numba, networkx
    base = json.loads((SOURCE / "tpel2019_2R.json").read_text())
    hashes = {str(p.relative_to(SOURCE)).replace("\\", "/"): digest_file(p) for p in sorted(SOURCE.rglob("*")) if p.is_file() and "__pycache__" not in p.parts}
    versions = dict(python=platform.python_version(), numpy=numpy.__version__, scipy=scipy.__version__, numba=numba.__version__, networkx=networkx.__version__)
    snapshot_hash = canonical_hash(hashes)
    source_hash = canonical_hash(dict(sourceSHA256=snapshot_hash, runtimeVersions=versions))
    samples = make_samples(base)
    write_json(OUTPUT / "sampling-plan.json", [{k:v for k,v in row.items() if k != "design"} for row in samples])
    geometry = geometry_audit(base, samples)
    write_json(OUTPUT / "geometry-audit.json", geometry)
    print(f"Geometry preflight passed: {geometry['checkedCount']} checks, 128 distinct layouts, all 8 wires vertical, fixed fixtures preserved.", flush=True)
    if args.geometry_only: return
    provenance = dict(source=dict(repository="https://github.com/e3da/PowerSynth2-core", revision="88af2fff2467f2e01db1d0ffc6c8c420968d65fc",
                         benchmarkRepository="https://github.com/e3da/PowerSynth2-pkg", benchmarkRevision="a1de7ced949c0fd0105d166767b1de8705eb65ab",
                         localPackage="powersynth-layout 0.2.0 reduced-core adapters", sha256=hashes, snapshotSHA256=snapshot_hash,
                         physicsSHA256=source_hash,
                         physicsRuntimeVersions=dict(versions),
                         attribution="PowerSynth contributors, E3DA and MSCAD laboratories, University of Arkansas. See source/THIRD_PARTY.md and source/LICENSE-GPL-3.0.txt.",
                         status="Paper-linked benchmark with declared physical-pin and wire adaptations; not a Figure 8 hardware replica."),
                      generation=dict(seed=SEED, inputOrder=INPUTS, boundsMM=BOUNDS, sampleCounts={"train":80,"validation":24,"test":24},
                         sampling="24 perimeter training points, domain center, source base, 54 train LHS; independent 24-point validation/test LHS seeds43/44. Realized on required0.001mm lattice; full-geometry dedup before labels.",
                         testScope="Independent interior interpolation points within the two-input rectangle. Boundaries are covered by training samples; this test does not assess unseen boundary geometry or extrapolation.",
                         parameterization="y0=8+gap; T2=(2,y0,40-spineWidth,18-y0); T3=(42-spineWidth,y0,spineWidth,42-y0); D1=(8,y0+1,4,6); D2=(17,y0+1,4,6). Others fixed.",
                         workers=args.workers, blasThreadsPerWorker=1, reusedLegacyLabels=False, mainMesh=MESH),
                      runtimeVersions=versions,
                      softwareChecksOnly=True, hardwareValidated=False)
    if args.train_only:
        samples = json.loads((OUTPUT / "dataset.json").read_text())
        audit = json.loads((OUTPUT / "audit.json").read_text())
        saved_cache = json.loads((OUTPUT / "evaluation-cache.json").read_text())
        if saved_cache["physicsHash"] != source_hash:
            raise RuntimeError("Completed labels used different source/software; refusing to rewrite provenance")
        expected = make_samples(base)
        for stored, planned in zip(samples, expected, strict=True):
            if any(stored[k] != planned[k] for k in ("id", "split", "spineWidth", "gap", "designHash")) or canonical_hash(stored["design"]) != planned["designHash"]:
                raise RuntimeError("Completed dataset differs from the deterministic preassigned geometry split")
            electrical = stored["electrical"]
            if electrical["mesh"] != MESH or not (electrical["inductance_h"] > 0 and electrical["relative_residual"] < 1e-7):
                raise RuntimeError("Completed labels have invalid mesh, inductance, or residual")
            cache_key = canonical_hash(dict(designHash=planned["designHash"], mesh=MESH))
            if electrical != saved_cache["evaluations"].get(cache_key):
                raise RuntimeError("Completed target differs from its pinned evaluation cache")
            stored["requestedInputs"] = planned["requestedInputs"]
    else:
        executable = str(args.fasthenry.resolve()) if args.fasthenry.is_file() else None
        samples, audit = generate(base, samples, source_hash, args.workers, executable)
    audit["geometry"] = geometry
    write_json(OUTPUT / "audit.json", audit)
    train_and_export(base, samples, audit, provenance)


if __name__ == "__main__":
    main()
