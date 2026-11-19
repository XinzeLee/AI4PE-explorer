"""Reproduce the pinned IGBT Gaussian BiLSTM and export dependency-free browser assets.

Adapted from the notebook by Xinze Li, Copyright 2026, Apache License 2.0.
Upstream license and attribution are retained in public/models/rul-nn/source/.

Run: python scripts/reproduce-rul-nn.py --fetch
Offline: python scripts/reproduce-rul-nn.py
The 87.7 MB raw MAT stays in .openai/rul-source and is never a browser asset.
Only pinned numerical MAT data is read; the source notebook is never executed.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import platform
import random
import time
import urllib.request
from pathlib import Path

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
import numpy as np
import scipy
import scipy.io
from scipy.signal import argrelextrema
from scipy.stats import norm
import sklearn
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/models/rul-nn"
CACHE = ROOT / ".openai/rul-source"
COMMIT = "0587acf5854b0127f696c13e0367663d24f6ae73"
REPOSITORY = "https://github.com/XinzeLee/Fundamentals_of_AI_for_PE"
SOURCE_PATH = "9_Case_Studies_PE/IGBT_Maintenance"
RAW = f"https://raw.githubusercontent.com/XinzeLee/Fundamentals_of_AI_for_PE/{COMMIT}/{SOURCE_PATH}"
MAT = "april22nd-23rdIgbtIRCG40BC30kd-A17.mat"
MAT_SHA256 = "5d09d7824403a6e647070cbddaa280dc97564514ce6139ce36767fcadd284743"
SOURCE_SHA256 = {MAT: MAT_SHA256,
                 "README.md": "65db24e9566cfb960b71a84a76cf69181b72239749ead1aab95f28f8848f9f2c",
                 "rul_prediction.ipynb": "603a4756bc11b39f034ce011a36160eb31a6a68539ddea1650e77018d2c5c9bf",
                 "LICENSE": "2227afb7015318e7015f08ff58b66e8f7d95769f591c8233d734212d606c42c8",
                 "NOTICE": "4c857abb9638f018213032cd54e477bc76f5452566607af8cf2b486da0e9b260"}
INPUTS = ["node1Voltage", "node2Voltage", "collectorEmitterCurrent", "packageTempurature"]
WINDOW_SIZE = 200


def write_json(path, value):
    path.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_url(filename):
    prefix = RAW if filename not in ["LICENSE", "NOTICE"] else f"https://raw.githubusercontent.com/XinzeLee/Fundamentals_of_AI_for_PE/{COMMIT}"
    return f"{prefix}/{filename}"


def source_manifest():
    return [dict(filename=filename, sha256=sha256(CACHE / filename), bytes=(CACHE / filename).stat().st_size,
                 url=source_url(filename)) for filename in SOURCE_SHA256]


def fetch_sources():
    CACHE.mkdir(parents=True, exist_ok=True)
    for filename in SOURCE_SHA256:
        request = urllib.request.Request(source_url(filename), headers={"User-Agent": "Flux-RUL-NN-Reproduction"})
        with urllib.request.urlopen(request, timeout=120) as response:
            content = response.read()
        (CACHE / filename).write_bytes(content)
        print(f"Fetched pinned {filename} ({len(content):,} bytes)", flush=True)


def extract_windows():
    assert sha256(CACHE / MAT) == MAT_SHA256, "Raw data does not match pinned source."
    mat = scipy.io.loadmat(CACHE / MAT)
    rows = mat["measurement"][0, 0][2][0]
    fields = list(rows[0][2].dtype.names)
    # Identical to the notebook's np.hstack per steady-state record.
    values = np.vstack([np.hstack(row[2][0, 0]) for row in rows])
    x_columns = [fields.index(name) for name in INPUTS]
    signal = values[1600:, fields.index("collectorEmitterCurrent")]
    candidates = argrelextrema(signal, np.less)[0]
    minima = []
    for index in candidates:
        left, right = max(0, index - 7), min(len(signal), index + 8)
        ambient = np.concatenate([signal[left:index], signal[index + 1:right]])
        if len(ambient) and np.all(signal[index] < ambient - 0.01):
            minima.append(int(index))
    windows, targets, metadata = [], [], []
    for cycle_index, minimum in enumerate(minima):
        if minimum - WINDOW_SIZE + 1 < 0:
            continue
        end = minimum + 1600
        start = end - WINDOW_SIZE + 1
        windows.append(values[start:end + 1, x_columns])
        targets.append(len(minima) - cycle_index - 1)
        metadata.append(dict(windowIndex=len(windows) - 1, cycleIndex=cycle_index,
                             startSample=start, endSample=end))
    x, y = np.asarray(windows), np.asarray(targets)
    assert x.shape == (1170, 200, 4)
    all_indices = np.arange(len(x))
    trainval, test = train_test_split(all_indices, test_size=0.15, random_state=42)
    train, validation = train_test_split(trainval, test_size=0.1765, random_state=42)
    splits = {"train": train, "validation": validation, "test": test}
    assert [len(v) for v in splits.values()] == [818, 176, 176]
    details = dict(rawSampleCount=len(rows), minimaCount=len(minima), windowCount=len(x),
                   sliceStart=1600, neighborsEachSide=7, minimumProminence=0.01,
                   firstTarget=int(y.max()), lastTarget=int(y.min()),
                   normalizationCycles=int(y.max()), windowSize=WINDOW_SIZE,
                   targetDefinition="Number of accepted current minima after this endpoint until the end of this recording.",
                   endpointDetection="Retrospective: compares current with up to seven later measurements; no later rows are NN inputs.")
    return x, y, metadata, splits, details


def extraction_audit(x, y, metadata):
    """Small raw-data fixture: all-window hashes and stable per-window sufficient statistics.

    Tests can verify every shipped raw window, reconstruct train-only scaling over all
    818 train windows, and check target labels without distributing the 87.7 MB MAT.
    """
    windows = []
    for index, window in enumerate(x):
        mean = window.mean(axis=0)
        centered_sum_squares = ((window - mean) ** 2).sum(axis=0)
        windows.append(dict(**metadata[index], target=int(y[index]), mean=mean.tolist(),
                            centeredSumSquares=centered_sum_squares.tolist(),
                            rawSha256=hashlib.sha256(np.ascontiguousarray(window, dtype="<f8").tobytes()).hexdigest()))
    return dict(schemaVersion=1, sourceMatSha256=MAT_SHA256, inputOrder=INPUTS, windowSize=WINDOW_SIZE,
                encoding="IEEE754 float64 little-endian, C-order [time][feature], unscaled raw source values",
                allWindowsSha256=hashlib.sha256(np.ascontiguousarray(x, dtype="<f8").tobytes()).hexdigest(),
                windows=windows)


def refresh_audit():
    """Refresh provenance/attribution without retraining or modifying selected weights."""
    for filename, expected in SOURCE_SHA256.items():
        if sha256(CACHE / filename) != expected:
            raise ValueError(f"{filename} does not match the inspected pinned source; fetch it again.")
    x, y, metadata, _, _ = extract_windows()
    write_json(OUTPUT / "extraction-audit.json", extraction_audit(x, y, metadata))
    for filename in SOURCE_SHA256:
        if filename != MAT:
            (OUTPUT / "source" / filename).write_bytes((CACHE / filename).read_bytes())
    provenance = json.loads((OUTPUT / "provenance.json").read_text(encoding="utf-8"))
    provenance["sources"] = source_manifest()
    filename = "extraction-audit.json"
    provenance["artifacts"][filename] = dict(sha256=sha256(OUTPUT / filename), bytes=(OUTPUT / filename).stat().st_size)
    write_json(OUTPUT / "provenance.json", provenance)
    print("Refreshed extraction audit, source attribution, and manifest; trained weights unchanged.", flush=True)


class ProbabilisticBiLSTMRegressor(nn.Module):
    def __init__(self):
        super().__init__()
        self.bilstm1 = nn.LSTM(4, 32, num_layers=1, batch_first=True, bidirectional=True)
        self.ln1 = nn.LayerNorm(64)
        self.bilstm2 = nn.LSTM(64, 16, num_layers=1, batch_first=True, bidirectional=True)
        self.ln2 = nn.LayerNorm(32)
        self.fc1 = nn.Linear(32, 16)
        self.relu = nn.ReLU()
        self.fc_mean = nn.Linear(16, 1)
        self.fc_logvar = nn.Linear(16, 1)

    def forward(self, x):
        x, _ = self.bilstm1(x)
        x = self.ln1(x)
        x, _ = self.bilstm2(x)
        x = self.ln2(x)[:, -1, :]
        x = self.relu(self.fc1(x))
        return self.fc_mean(x), self.fc_logvar(x)


def nll(mean, logvar, target):
    return (0.5 * np.log(2 * np.pi) + 0.5 * logvar + 0.5 * (target - mean).square() / logvar.exp()).mean()


def export_network(model):
    def linear(layer):
        return dict(weight=layer.weight.detach().cpu().tolist(), bias=layer.bias.detach().cpu().tolist())

    def layer_norm(layer):
        return dict(**linear(layer), epsilon=layer.eps)

    def lstm(layer):
        def direction(suffix):
            return {key: getattr(layer, f"{key}_l0{suffix}").detach().cpu().tolist()
                    for key in ["weight_ih", "weight_hh", "bias_ih", "bias_hh"]}
        return dict(inputSize=layer.input_size, hiddenSize=layer.hidden_size,
                    forward=direction(""), reverse=direction("_reverse"),
                    gateOrder=["input", "forget", "cell", "output"])

    return dict(bilstm1=lstm(model.bilstm1), ln1=layer_norm(model.ln1),
                bilstm2=lstm(model.bilstm2), ln2=layer_norm(model.ln2),
                fc1=linear(model.fc1), fcMean=linear(model.fc_mean), fcLogvar=linear(model.fc_logvar))


def train_candidate(seed, device, loaders, started):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    model = ProbabilisticBiLSTMRegressor().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01)
    best_loss, best_epoch, best_state = float("inf"), 0, None
    history = []
    for epoch in range(200):
        if epoch > 0 and epoch % 20 == 0 and optimizer.param_groups[0]["lr"] > 1e-4:
            for group in optimizer.param_groups:
                group["lr"] *= 0.5
        model.train()
        losses = []
        for features, target in loaders["train"]:
            optimizer.zero_grad()
            mean, logvar = model(features)
            loss = nll(mean, logvar, target)
            loss.backward()
            optimizer.step()
            losses.append(loss.item())
        model.eval()
        with torch.no_grad():
            validation_loss = np.mean([nll(*model(features), target).item()
                                       for features, target in loaders["validation"]])
        if not np.isfinite(validation_loss):
            raise ValueError("Training diverged; refusing to export a model.")
        if validation_loss < best_loss:
            best_loss, best_epoch = float(validation_loss), epoch + 1
            # The notebook's state_dict aliases live tensors. Freeze the actual best validation checkpoint.
            best_state = copy.deepcopy(model.state_dict())
        history.append(dict(epoch=epoch + 1, trainNll=float(np.mean(losses)),
                            validationNll=float(validation_loss), learningRate=optimizer.param_groups[0]["lr"]))
        if (epoch + 1) % 10 == 0 or epoch == 0:
            print(f"Seed {seed} epoch {epoch+1}: train={np.mean(losses):.5f} val={validation_loss:.5f} best={best_epoch} elapsed={time.time()-started:.1f}s", flush=True)
    model.load_state_dict(best_state)
    return model.cpu(), history, dict(seed=seed, selectedEpoch=best_epoch, bestValidationNll=best_loss)


def train_and_export(device_name):
    started = time.time()
    for filename, expected in SOURCE_SHA256.items():
        if sha256(CACHE / filename) != expected:
            raise ValueError(f"{filename} does not match the inspected pinned source; fetch it again.")
    torch.set_num_threads(4)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.use_deterministic_algorithms(True)
    device = torch.device(device_name)
    x, y, metadata, splits, preprocessing = extract_windows()
    scaler_x = StandardScaler().fit(x[splits["train"]].reshape(-1, 4))
    scaler_y = StandardScaler().fit(y[splits["train"]].reshape(-1, 1))
    scaled_x = scaler_x.transform(x.reshape(-1, 4)).reshape(x.shape)
    scaled_y = scaler_y.transform(y.reshape(-1, 1))
    # Do not materialize test tensors or evaluate a test input until the model is frozen.
    loaders = {}
    for name in ["train", "validation"]:
        indices = splits[name]
        tensors = (torch.tensor(scaled_x[indices], dtype=torch.float32, device=device),
                   torch.tensor(scaled_y[indices], dtype=torch.float32, device=device))
        loaders[name] = DataLoader(TensorDataset(*tensors), batch_size=200, shuffle=name == "train")
    candidates, best_candidate, model, history = [], None, None, None
    for seed in [0, 1, 2, 3, 4]:
        candidate_model, candidate_history, candidate = train_candidate(seed, device, loaders, started)
        candidates.append(candidate)
        # Candidate and epoch selection use validation NLL only, never test predictions or targets.
        if best_candidate is None or candidate["bestValidationNll"] < best_candidate["bestValidationNll"]:
            best_candidate, model, history = candidate, candidate_model, candidate_history
    best_epoch = best_candidate["selectedEpoch"]
    best_loss = best_candidate["bestValidationNll"]
    selected_seed = best_candidate["seed"]
    print(f"Frozen selection: {best_candidate}; now evaluating untouched test windows.", flush=True)
    # Export CPU float32 reference inference for cross-runtime parity; training may use CUDA.
    model = model.cpu()
    torch.backends.mkldnn.enabled = False
    model.eval()
    cases = []
    with torch.no_grad():
        test_features = torch.tensor(scaled_x[splits["test"]], dtype=torch.float32)
        test_targets = torch.tensor(scaled_y[splits["test"]], dtype=torch.float32)
        mean_scaled, logvar = model(test_features)
        test_nll = float(nll(mean_scaled, logvar, test_targets))
        means = mean_scaled.numpy().astype(np.float64).ravel() * scaler_y.scale_[0] + scaler_y.mean_[0]
        stds = np.exp(logvar.numpy().astype(np.float64).ravel() * 0.5) * scaler_y.scale_[0]
    z90 = float(norm.ppf(0.95))
    targets = y[splits["test"]]
    for position, window_index in enumerate(splits["test"]):
        info = metadata[window_index]
        cases.append(dict(id=f"test-{int(window_index):04d}", split="test", **info,
                          target=int(y[window_index]), targetPercent=float(y[window_index] / y.max() * 100),
                          window=x[window_index].tolist(),
                          referencePrediction=dict(mean=float(means[position]), std=float(stds[position]),
                                                   lower=float(means[position] - z90 * stds[position]),
                                                   upper=float(means[position] + z90 * stds[position]), confidence=0.9)))
    metrics = dict(testCount=len(cases), testMaeCycles=float(np.mean(np.abs(means - targets))),
                   testRmseCycles=float(np.sqrt(np.mean((means - targets) ** 2))),
                   testNllScaled=test_nll,
                   testCoverage90=float(np.mean((targets >= means - z90 * stds) & (targets <= means + z90 * stds))),
                   testMeanIntervalWidth90=float(np.mean(2 * z90 * stds)),
                   interpretation="Window holdout within one recording; overlapping and adjacent windows can occur across splits. Not device-level or prospective validation.")
    features = [dict(key=key, label=label, unit="source units") for key, label in zip(INPUTS,
                ["Node 1 voltage", "Node 2 voltage", "Collector–emitter current", "Package temperature"])]
    model_export = dict(schemaVersion=1, source=dict(repository=REPOSITORY, commit=COMMIT,
                        path=SOURCE_PATH, notebookUrl=f"{REPOSITORY}/blob/{COMMIT}/{SOURCE_PATH}/rul_prediction.ipynb"),
                        inputOrder=INPUTS, features=features, windowSize=WINDOW_SIZE,
                        normalizationCycles=preprocessing["normalizationCycles"],
                        scaler=dict(mean=scaler_x.mean_.tolist(), scale=scaler_x.scale_.tolist()),
                        targetScaler=dict(mean=float(scaler_y.mean_[0]), scale=float(scaler_y.scale_[0])),
                        network=export_network(model), defaultConfidence=0.9, intervalType="prediction", metrics=metrics,
                        training=dict(seed=selected_seed, candidateSeeds=[0, 1, 2, 3, 4], candidateResults=candidates,
                                      selectionCriterion="Lowest validation NLL across candidate seeds and epochs; no test evaluation before selection.",
                                      epochs=200, selectedEpoch=best_epoch, bestValidationNll=best_loss,
                                      checkpoint="deep-copied best validation NLL", batchSize=200,
                                      optimizer="Adam", initialLearningRate=0.01,
                                      learningRateSchedule="Halve every 20 epochs while current LR > 0.0001"))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "source").mkdir(exist_ok=True)
    for filename in SOURCE_SHA256:
        if filename != MAT:
            (OUTPUT / "source" / filename).write_bytes((CACHE / filename).read_bytes())
    write_json(OUTPUT / "model.json", model_export)
    write_json(OUTPUT / "cases.json", cases)
    write_json(OUTPUT / "training-history.json", history)
    write_json(OUTPUT / "extraction-audit.json", extraction_audit(x, y, metadata))
    provenance = dict(schemaVersion=1, repository=REPOSITORY, commit=COMMIT, sourcePath=SOURCE_PATH,
                      sources=source_manifest(),
                      preprocessing=preprocessing, split=dict(method="Two sklearn train_test_split calls, random_state=42; source window split.",
                      indices={name: indices.tolist() for name, indices in splits.items()}),
                      deviations=["Source leaves NN initialization and loader seeds unset. Evaluate fixed seeds [0,1,2,3,4]; choose seed and epoch only by lowest validation NLL.",
                                  "Deep-copy the best validation checkpoint; source best_model_state = model.state_dict() aliases live weights.",
                                  "Percent display uses max extracted target (fixed recording-relative denominator), not max(test targets, test predictions).",
                                  "Call the learned Gaussian range a prediction interval; source labels it a confidence interval."],
                      uncertainty=dict(distribution="Gaussian", parameters="Learned mean and log-variance; Gaussian NLL training.",
                                       interval="mean ± normalQuantile((1+confidence)/2) × exp(logvar/2) × targetScale",
                                       limitations="Conditional model distribution, not confidence interval for mean, not calibrated or guaranteed coverage; negative tails remain untruncated."),
                      environment=dict(python=platform.python_version(), numpy=np.__version__, scipy=scipy.__version__,
                                       sklearn=sklearn.__version__, torch=torch.__version__, device=str(device),
                                       deterministicAlgorithms=True, cudnnTf32=False, matmulTf32=False,
                                       referenceInference="CPU float32, MKLDNN disabled; inverse output scaling in float64."),
                      artifacts={filename: dict(sha256=sha256(OUTPUT / filename), bytes=(OUTPUT / filename).stat().st_size)
                                 for filename in ["model.json", "cases.json", "training-history.json", "extraction-audit.json"]},
                      metrics=metrics)
    write_json(OUTPUT / "provenance.json", provenance)
    print(json.dumps(dict(selectedEpoch=best_epoch, metrics=metrics, elapsedSeconds=time.time()-started), indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="Download the pinned public data and notebook.")
    parser.add_argument("--refresh-audit", action="store_true", help="Refresh extraction checks and attribution without training.")
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu", choices=["cpu", "cuda"])
    args = parser.parse_args()
    if args.fetch:
        fetch_sources()
    if args.refresh_audit:
        refresh_audit()
    else:
        train_and_export(args.device)
