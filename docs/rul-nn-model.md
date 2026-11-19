# IGBT remaining-life neural network

The playground runs a reproduced Gaussian BiLSTM on real, retained test windows from the IGBT accelerated-aging recording used in [the source notebook](https://github.com/XinzeLee/Fundamentals_of_AI_for_PE/blob/0587acf5854b0127f696c13e0367663d24f6ae73/9_Case_Studies_PE/IGBT_Maintenance/rul_prediction.ipynb). It does not synthesize waveforms, interpolate saved predictions, or add arbitrary uncertainty bands. Changing the selected test window runs the exported recurrent network locally in JavaScript.

## Source and extraction

The source repository is `XinzeLee/Fundamentals_of_AI_for_PE`, pinned to commit `0587acf5854b0127f696c13e0367663d24f6ae73`. Its `9_Case_Studies_PE/IGBT_Maintenance` directory contains the notebook, README, and `april22nd-23rdIgbtIRCG40BC30kd-A17.mat`. The directory has no trained-weight checkpoint. The README attributes the recording to the [NASA IGBT accelerated-aging dataset](https://data.nasa.gov/dataset/insulated-gate-bipolar-transistor-igbt-accelerated-aging).

The MAT file SHA-256 is `5d09d7824403a6e647070cbddaa280dc97564514ce6139ce36767fcadd284743`. All input file hashes and URLs are recorded in `public/models/rul-nn/provenance.json`. Exact copies of the small source notebook and README, plus the upstream root `LICENSE` and `NOTICE`, are retained in its `source/` directory. The original 87,693,717-byte MAT stays in the ignored local cache `.openai/rul-source/`; it is not downloaded by the browser or bundled into the site.

The source author is **Xinze Li, Copyright 2026**. Its retained notice licenses executable code under Apache License 2.0 and non-code educational content under CC BY-NC 4.0. The browser inference and reproduction script explicitly identify their adaptation from the source notebook. The source README separately attributes the underlying dataset to NASA.

The reproduction follows the notebook's steady-state extraction:

1. Read the 41,752 steady-state records. Preserve source feature spelling and order: `node1Voltage`, `node2Voltage`, `collectorEmitterCurrent`, `packageTempurature`.
2. Starting at original row 1600, find strict local minima of collector–emitter current with SciPy `argrelextrema`.
3. Retain a candidate only when it is at least 0.01 below every available neighbor in a seven-sample window on each side. This gives 1,175 accepted minima.
4. Take the 200 measurements ending at each accepted minimum, skipping five endpoints that lack 200 measurements after the slice start. This gives 1,170 windows of shape `200 × 4`.
5. Label each window with the number of accepted minima after that endpoint until the end of the recording: targets range from 1,169 to zero cycles.

The displayed RUL unit is **detected cycles remaining in this recording**. This is a source-derived proxy, not a separately verified physical end-of-life measurement. The horizontal waveform axis is sample index, not an assumed uniformly sampled time. Raw channel values use source units; the notebook and MAT report do not supply explicit calibration units for these fields. Optional percentages use a fixed denominator of 1,169 cycles, the maximum extracted target. The source plot instead normalizes using the maximum of its test targets and predictions; the playground avoids that test-dependent denominator.

## Split and limits

The source split is preserved exactly: `train_test_split(..., test_size=0.15, random_state=42)`, then a second split on the remainder with `test_size=0.1765, random_state=42`. It produces 818 training, 176 validation, and 176 test windows. All original window indices are stored in the provenance asset. Both feature and target `StandardScaler` objects are fit on training windows only.

This is a random window holdout within a single device recording. Nearby windows can overlap across partitions. It does not establish performance on unseen devices, a future segment, or a prospective maintenance system. The endpoint detector itself uses up to seven future measurements to confirm a minimum. The 200 NN input rows contain history only, but selection of that endpoint is retrospective. Bidirectionality uses the complete retained history window, not measurements after its endpoint. The playground presents offline examples and does not claim causal, real-time detection.

## Reproduced network and training

The model follows the notebook:

| Stage | Shape or behavior |
|---|---|
| Input | 200 samples × 4 standardized signals |
| BiLSTM 1 | 32 hidden units per direction, one layer |
| Layer normalization | 64 channels, epsilon `1e-5` |
| BiLSTM 2 | 16 hidden units per direction, one layer |
| Layer normalization | 32 channels, epsilon `1e-5` |
| Time selection | Last aligned sequence output (`out[:, -1, :]`) |
| Dense | 32 → 16, ReLU |
| Two Gaussian heads | Separate 16 → 1 mean and log-variance |

Training uses Gaussian negative log likelihood, Adam with learning rate 0.01, batches of 200, and all 200 epochs. Every 20 epochs the learning rate halves while its current value exceeds `1e-4`. The source mentions early stopping, but its executable loop runs all 200 epochs; the reproduction does the same.

The following changes are explicit:

- The source leaves neural-network initialization and batch-order seeds unset. A bounded, fixed search uses seeds `[0, 1, 2, 3, 4]`, each with the same architecture and 200-epoch recipe. The seed and checkpoint are selected solely by the lowest validation NLL. Test tensors and predictions are first evaluated after this selection is frozen. All candidate validation results are exported in `model.json`.
- An initial seed-42 diagnostic had poor validation fit (best scaled validation NLL about 1.329). It motivated checking a fixed set of initializations; that diagnostic is not a search candidate. Neither its test results nor any candidate test results are used to choose a model.
- The notebook assigns `best_model_state = model.state_dict()`, which aliases live tensors and therefore does not preserve its intended best checkpoint. The reproduction uses `copy.deepcopy` to freeze the actual best validation checkpoint.
- Python, NumPy, and PyTorch seeds are fixed for each candidate. PyTorch deterministic algorithms are enabled. cuDNN and matrix-multiplication TF32 are disabled. Training can use CUDA; reference predictions are computed with the selected unchanged weights on CPU in float32, with MKLDNN disabled. Output inverse scaling uses float64.

The asset records the selected seed, epoch, candidate validation results, measured held-out metrics, and exact library versions. These are a deterministic local reproduction, not the source notebook's original trained parameters or its published numerical results. Library and device changes can affect an optimization trajectory even with fixed seeds.

The committed export selected **seed 4, epoch 193**, with scaled validation NLL **−0.273300**. The five seeds' best validation NLL values were respectively 0.951491, 1.100277, 0.537980, 0.389674, and −0.273300. After freezing that selection, the 176 test windows gave:

| Metric | Measured result |
|---|---:|
| Mean absolute error | 51.217 detected cycles |
| Root mean squared error | 66.034 detected cycles |
| Gaussian NLL in scaled target space | −0.348719 |
| Empirical coverage of nominal 90% interval | 157/176 = 89.20% |
| Mean 90% interval width | 202.559 detected cycles |

These figures describe this random within-recording split and carry the overlap and endpoint limitations above. The Python export used Python 3.11, NumPy 1.26.4, SciPy 1.17.1, scikit-learn 1.9.0, and PyTorch 2.11.0 with CUDA training; full exact versions are in provenance.

## What the interval means

The network learns `μ` and `log(σ²)` in standardized target space. In detected cycles:

```text
mean = mean_scaled × target_scale + target_mean
std = exp(log_variance / 2) × target_scale
90% prediction interval = mean ± 1.6448536269514722 × std
```

The notebook labels this a “confidence interval.” Its calculation is a central interval of the learned conditional Gaussian **prediction distribution**, not a confidence interval for an estimated mean. The playground uses “90% prediction interval.” It reports held-out empirical coverage as a measured result; the nominal 90% level does not guarantee calibration. The learned variance does not include a separately estimated uncertainty over weights. Gaussian tails and numeric bounds are retained even when they extend below zero; silently truncating them would change the source distribution.

## Browser implementation and verification

`src/rulNN.js` implements both forward and reverse LSTM recurrences using PyTorch's gate order (input, forget, cell, output), realigns reverse outputs to each original timestep, applies per-timestep layer normalization, and selects the final aligned timestep exactly as the notebook does. It then evaluates the dense Gaussian heads and reverses training target scaling. There is no runtime PyTorch, ONNX, remote prediction service, or model download beyond the small local JSON assets.

`loadRULNN({ signal })` loads and validates weights, 176 complete test windows, and provenance. `sampleRULCases(bundle, count, rng)` samples distinct retained test cases without replacement. `predictRUL(bundle, caseOrWindow, confidence = 0.9)` runs inference and returns the mean, learned standard deviation, raw bounds, interval probability, and cycle unit. The case's ground truth and saved parity reference do not enter inference. Abort signals are passed through to asset fetches.

`extraction-audit.json` is a compact fixture generated directly from the pinned raw MAT. It retains a Float64LE byte hash for all 1,170 extracted raw windows together, per-window byte hashes, endpoint indices, labels, and per-channel means and centered sums of squares. This permits checking all shipped raw curves and independently reconstructing training-only scaling without shipping the full source MAT.

`tests/rul-nn.test.mjs` checks every retained window against independent PyTorch reference inference, verifies aggregate test metrics, checks interval math and negative tails, proves labels and saved reference predictions do not affect inference, validates split indices and artifact hashes, and tests distinct random sampling and malformed model/input rejection. It byte-checks all 176 raw waveforms against the extraction fixture and reconstructs the feature and target scalers from only the 818 training indices. It also checks abort propagation and recovery after asset-fetch failure. Across all 176 windows, the native JavaScript implementation's maximum absolute mean/bound difference from PyTorch CPU reference is below 0.000448 cycles; its maximum standard-deviation difference is below 0.000027 cycles. Eight dedicated tests pass.

## Reproduce

The Python environment requires NumPy, SciPy, scikit-learn, and PyTorch. Run from the project root:

```powershell
python scripts/reproduce-rul-nn.py --fetch
npm test
```

`--fetch` fills the local pinned-source cache before training. A subsequent invocation without it is fully offline. The default device is CUDA when available, otherwise CPU; `--device cpu` or `--device cuda` selects it explicitly. `--refresh-audit` regenerates the compact extraction fixture, retained source attribution, and manifest without retraining or changing model weights. The script reads numeric MAT data and implements the inspected training recipe; it never executes the downloaded notebook. Committed JSON exports make Python and source data unnecessary for running the website.
