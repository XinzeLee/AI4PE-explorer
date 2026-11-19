# DAB modulation model reproduction

The Control playground uses two fixed-weight neural networks reproduced from
[Xinze Li's ECCE2025 tutorial](https://github.com/XinzeLee/ECCE2025/tree/1732da388f18b80e3fb6ad2ed0480c53f42c9250),
pinned at commit `1732da388f18b80e3fb6ad2ed0480c53f42c9250`.
These forward models map `[P, Vref, D1, D2]` to current stress (`ipk2pk`, in source
units) and the number of switches meeting the source ZVS criterion. They are a
companion example to the illustrative voltage-feedback controller, with a
different input/output contract. They do not simulate a transient response.

The source study is a 200 V input, 50 kHz DAB with pre-generated PLECS simulation
data. It is separate from the explorer's illustrative 3 kW / 400 V–48 V hardware.
D1 and D2 are dimensionless normalized bridge-voltage pulse-width parameters;
the playground does not invent a radians, degrees or physical time conversion.

## Reproduce the assets

```powershell
python scripts/reproduce-control-nn.py --fetch
# Re-run without network once the pinned sources exist:
python scripts/reproduce-control-nn.py
npm test
```

Requirements are Python, NumPy, pandas, scikit-learn and PyTorch. The committed
artifact records the exact package versions used. No Python or training runtime
is needed by the website. The script trains on CPU with deterministic algorithms,
one PyTorch thread and seed 42 reset before each network. The source notebook did
not fix a Torch seed, so these are reproduced models rather than the original
historical checkpoints.

The script retains the pinned notebook, CSV, README and utility source under
`public/models/control-nn/source/`. `model.json` records their SHA-256 hashes.

## Cleaning, split and model contract

The source notebook's `apply_data_filtering=True` pipeline is preserved in order:

1. Keep `Validity != 0`: 5,291 → 5,291 rows.
2. Sum the eight switch ZVS flags and keep even counts: 5,291 → 4,633.
3. Retain `ipk2pk` within inclusive mean ±3 sample standard deviations, computed
   after the even-count filter: 4,633 → 4,633. Mean 13.3034689725, sample standard
   deviation 5.26624131015, limits −2.49525495794 to 29.1021929030.

All displayed simulation references come from those retained records. A missing
reference does not become a fabricated sample. The NN still estimates that input
within the chosen operating envelope.

Two `train_test_split` calls with `random_state=42` produce 2,779 training, 927
validation and 927 test rows, in the original retained CSV order. Each model's
`StandardScaler` is fit on training inputs only; targets are unscaled.

| Model | Architecture | Hidden activation | Epochs | Selected epoch |
| --- | --- | --- | ---: | ---: |
| Current stress | 4 → 32 → 32 → 1 | ReLU, BatchNorm before activation | 200 | 192 |
| ZVS classification | 4 → 32 → 32 → 3 | Tanh, BatchNorm before activation | 300 | 169 |

Training retains source batch size 1,000, Adam learning rate 0.1, StepLR with
step size 40 and factor 0.5, and per-parameter gradient z-scoring using sample
standard deviation. Scalar gradients remain unchanged, matching the source's
`std > 0` condition for undefined scalar sample standard deviation. Regression
uses MSE, classification uses cross-entropy. Checkpoints are selected only by
validation loss; historical per-epoch test-loss tracking does not select models.

Output class index 0/1/2 maps to ZVS count 4/6/8. This is the source's filtered
classification task, not a classifier for excluded abnormal cases. Network
logits are not presented as calibrated confidence or a protection decision.

## Results and parity

| Held-out metric | Seeded reproduction | Saved historical notebook output |
| --- | ---: | ---: |
| Current-stress RMSE | 0.406340149 | 0.396636 |
| Current-stress R² | 0.994289946 | 0.994559 |
| ZVS accuracy | 96.6558792% | 96.3323% |

`model.json` exports every Linear weight/bias, BatchNorm affine weight/bias,
running mean/variance/epsilon and each model's scaler. `samples.json` contains
the cleaned references. `parity.json` stores Python predictions for all 4,633
cleaned inputs; `split-indices.json` makes the evaluation split auditable.
`training-history.json` records the full source-style training histories.

`src/controlNN.js` evaluates these exported layers locally without a server or
ML dependency. Tests require identical predicted classes across all retained
inputs and current-stress agreement within `1e-4 + 1e-5 × |Python prediction|`.
Tests also verify source hashes, cleaning, train-only scaling, missing references,
grid selection and model-load failures/retry.

## Attribution

Source code author: Xinze Li (`XinzeLee/ECCE2025`). The source README declares
Apache License 2.0; its README and source attribution are retained. The repository
requests citation of:

F. Lin, X. Zhang, X. Li, C. Sun, W. Cai and Z. Zhang, “Automatic Triple Phase-Shift
Modulation for DAB Converter With Minimized Power Loss,” IEEE Transactions on
Industry Applications, 58(3), 3840–3851, 2022,
[doi:10.1109/TIA.2021.3136501](https://doi.org/10.1109/TIA.2021.3136501).
