"""Reproduce the pinned ECCE2025 forward DAB NNs and export browser assets.

Run: python scripts/reproduce-control-nn.py --fetch
Subsequent offline runs: python scripts/reproduce-control-nn.py
No test-set values are used to select checkpoints or hyperparameters.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import platform
import random
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
import torch
from sklearn.metrics import accuracy_score, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


COMMIT = "1732da388f18b80e3fb6ad2ed0480c53f42c9250"
REPOSITORY = "https://github.com/XinzeLee/ECCE2025"
RAW = f"https://raw.githubusercontent.com/XinzeLee/ECCE2025/{COMMIT}"
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/models/control-nn"
SOURCE = OUTPUT / "source"
INPUTS = ["P", "Vref", "D1", "D2"]
ZVS_FLAGS = [f"{side}_t{switch}" for side in ["vp", "vs"] for switch in range(1, 5)]
SEED = 42


def write_json(path, value):
    path.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")


def fetch_sources():
    SOURCE.mkdir(parents=True, exist_ok=True)
    for filename in ["ECCE2025_tutorial.ipynb", "DAB_TPS.csv", "README.md", "utils.py"]:
        request = urllib.request.Request(f"{RAW}/{filename}", headers={"User-Agent": "Flux-Control-NN-Reproduction"})
        with urllib.request.urlopen(request, timeout=60) as response:
            content = response.read()
        (SOURCE / filename).write_bytes(content)
        print(f"Fetched pinned {filename} ({len(content):,} bytes)", flush=True)


def clean_data():
    raw = pd.read_csv(SOURCE / "DAB_TPS.csv", index_col=0)
    valid = raw.loc[raw.Validity != 0].copy()
    valid["total_ZVS"] = valid[ZVS_FLAGS].sum(axis=1)
    even = valid.loc[valid.total_ZVS % 2 == 0]
    mean, std = float(even.ipk2pk.mean()), float(even.ipk2pk.std())
    cleaned = even.loc[even.ipk2pk.between(mean - 3 * std, mean + 3 * std, inclusive="both")]
    counts = dict(rawCount=len(raw), validCount=len(valid), evenZvsCount=len(even), cleanedCount=len(cleaned),
                  applyDataFiltering=True, currentStressMean=mean, currentStressStd=std,
                  lowerThreshold=mean - 3 * std, upperThreshold=mean + 3 * std,
                  standardDeviation="pandas sample standard deviation (ddof=1)")
    assert [len(raw), len(valid), len(even), len(cleaned)] == [5291, 5291, 4633, 4633]
    assert sorted(cleaned.total_ZVS.unique()) == [4, 6, 8]
    return cleaned, counts


class DABNetwork(nn.Module):
    def __init__(self, activation, outputs):
        super().__init__()
        act = nn.ReLU() if activation == "relu" else nn.Tanh()
        self.model = nn.Sequential(
            nn.Linear(4, 32), nn.BatchNorm1d(32), act,
            nn.Linear(32, 32), nn.BatchNorm1d(32), act,
            nn.Linear(32, outputs),
        )

    def forward(self, x):
        return self.model(x)


def export_layers(model):
    result = []
    # Source regression is scripted; module types are retained in original_name.
    # Sequential reuses the activation instance, as in the source notebook.
    # children() deduplicates it for eager modules; _modules preserves both slots.
    for layer in model.model._modules.values():
        name = getattr(layer, "original_name", layer.__class__.__name__)
        if name == "Linear":
            result.append(dict(type="linear", weight=layer.weight.detach().tolist(), bias=layer.bias.detach().tolist()))
        elif name == "BatchNorm1d":
            result.append(dict(type="batchnorm", weight=layer.weight.detach().tolist(), bias=layer.bias.detach().tolist(),
                               mean=layer.running_mean.tolist(), variance=layer.running_var.tolist(), epsilon=layer.eps))
        elif name in ["ReLU", "Tanh"]:
            result.append(dict(type=name.lower()))
        else:
            raise ValueError(f"Unexpected module {name}")
    return result


def train_network(cleaned, splits, kind):
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    classification = kind == "classification"
    activation, epochs = ("tanh", 300) if classification else ("relu", 200)
    x = cleaned[INPUTS].to_numpy()
    y = cleaned.total_ZVS.to_numpy() if classification else cleaned.ipk2pk.to_numpy()
    if classification:
        y = np.array([{4: 0, 6: 1, 8: 2}[int(v)] for v in y])
    scaler = StandardScaler().fit(x[splits["train"]])
    loaders = {}
    for name, indices in splits.items():
        features = torch.tensor(scaler.transform(x[indices]), dtype=torch.float32)
        target = torch.tensor(y[indices], dtype=torch.long if classification else torch.float32)
        if not classification:
            target = target.reshape(-1, 1)
        loaders[name] = DataLoader(TensorDataset(features, target), batch_size=1000, shuffle=name == "train")
    model = DABNetwork(activation, 3 if classification else 1)
    if not classification:
        model = torch.jit.script(model)
    criterion = nn.CrossEntropyLoss() if classification else nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.1)
    scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=40, gamma=0.5)
    best_loss, best_epoch, best_state = float("inf"), 0, None
    history = []
    for epoch in range(epochs):
        model.train()
        train_loss = 0
        for features, target in loaders["train"]:
            optimizer.zero_grad()
            loss = criterion(model(features), target)
            loss.backward()
            for parameter in model.parameters():
                if parameter.grad is not None:
                    # torch.std uses correction=1, matching the source notebook.
                    # A single output bias has undefined sample std, so source leaves it unchanged.
                    grad = parameter.grad
                    grad_std = grad.std() if grad.numel() > 1 else torch.tensor(float("nan"))
                    if grad_std > 0:
                        parameter.grad = (grad - grad.mean()) / grad_std
            optimizer.step()
            train_loss += loss.item()
        scheduler.step()
        model.eval()
        scores = {}
        with torch.no_grad():
            for name in ["validation", "test"]:
                scores[name] = sum(criterion(model(features), target).item() for features, target in loaders[name]) / len(loaders[name])
        history.append(dict(epoch=epoch + 1, trainLoss=train_loss / len(loaders["train"]),
                            validationLoss=scores["validation"], testLoss=scores["test"]))
        if scores["validation"] < best_loss:
            best_loss, best_epoch = scores["validation"], epoch + 1
            best_state = copy.deepcopy(model.state_dict())
        if (epoch + 1) % 20 == 0:
            print(f"{kind}: {epoch + 1}/{epochs}; validation {scores['validation']:.6f}", flush=True)
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        predictions = model(torch.tensor(scaler.transform(x), dtype=torch.float32)).numpy()
    test = splits["test"]
    if classification:
        metrics = dict(accuracy=float(accuracy_score(y[test], predictions[test].argmax(axis=1))))
    else:
        metrics = dict(rmse=float(np.sqrt(mean_squared_error(y[test], predictions[test, 0]))),
                       r2=float(r2_score(y[test], predictions[test, 0])))
    exported = dict(layers=export_layers(model), scaler=dict(mean=scaler.mean_.tolist(), scale=scaler.scale_.tolist()))
    training = dict(architecture=[4, 32, 32, 3 if classification else 1], activation=activation, epochs=epochs,
                    bestEpoch=best_epoch, bestValidationLoss=best_loss)
    return exported, training, metrics, predictions, history


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="Fetch exact public sources at the pinned commit first")
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if args.fetch:
        fetch_sources()
    cleaned, preprocessing = clean_data()
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    indices = np.arange(len(cleaned))
    temporary, test = train_test_split(indices, test_size=0.2, random_state=42)
    train, validation = train_test_split(temporary, test_size=0.25, random_state=42)
    splits = dict(train=train, validation=validation, test=test)
    regression, regression_training, regression_metrics, stress, regression_history = train_network(cleaned, splits, "regression")
    classification, classification_training, classification_metrics, logits, classification_history = train_network(cleaned, splits, "classification")
    source_hashes = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(SOURCE.iterdir()) if path.is_file()}
    metadata = dict(
        source=dict(repository=REPOSITORY, commit=COMMIT, notebookUrl=f"{REPOSITORY}/blob/{COMMIT}/ECCE2025_tutorial.ipynb",
                    datasetUrl=f"{REPOSITORY}/blob/{COMMIT}/DAB_TPS.csv", sha256=source_hashes,
                    study=dict(Vin=200, switchingFrequencyHz=50000), dataKind="PLECS simulation",
                    attribution="Xinze Li / XinzeLee, ECCE2025 tutorial; Apache-2.0 per source README"),
        preprocessing=preprocessing,
        training=dict(seed=SEED, seedPolicy="Reset seed 42 before each network", device="CPU", deterministic=True,
                      inputOrder=INPUTS, split={name: len(value) for name, value in splits.items()},
                      splitRandomState=42, batchSize=1000, optimizer="Adam", initialLearningRate=0.1,
                      scheduler=dict(name="StepLR", stepSize=40, gamma=0.5), gradientNormalization="Per-parameter z-score (sample std)",
                      checkpointSelection="Lowest validation loss", regression=regression_training, classification=classification_training,
                      environment=dict(python=platform.python_version(), torch=torch.__version__, numpy=np.__version__,
                                       pandas=pd.__version__, sklearn=sklearn.__version__)),
        metrics=dict(regression=regression_metrics, classification=classification_metrics),
        historical=dict(regression=dict(rmse=0.396636, r2=0.994559), classification=dict(accuracy=0.963323),
                        label="Saved notebook results; not this seeded reproduction"),
    )
    write_json(OUTPUT / "model.json", dict(schemaVersion=1, inputOrder=INPUTS, classMapping=[4, 6, 8],
                                           regression=regression, classification=classification, metadata=metadata))
    samples = [dict(P=float(row.P), Vref=float(row.Vref), D1=float(row.D1), D2=float(row.D2),
                    stress=float(row.ipk2pk), zvs=int(row.total_ZVS)) for row in cleaned.itertuples()]
    write_json(OUTPUT / "samples.json", samples)
    parity = [dict(inputs={key: row[key] for key in INPUTS}, stress=float(stress[i, 0]),
                   logits=[float(v) for v in logits[i]], zvs=[4, 6, 8][int(logits[i].argmax())]) for i, row in enumerate(samples)]
    write_json(OUTPUT / "parity.json", parity)
    write_json(OUTPUT / "training-history.json", dict(regression=regression_history, classification=classification_history))
    write_json(OUTPUT / "split-indices.json", {name: value.tolist() for name, value in splits.items()})
    print(json.dumps(dict(counts=preprocessing, metrics=metadata["metrics"], training=metadata["training"]), indent=2), flush=True)


if __name__ == "__main__":
    main()
