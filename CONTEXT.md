# Converter explorer language

The explorer describes conceptual converter hardware and educational AI applications. Its diagrams and authored response curves do not constitute measured or simulated converter results.

The Design geometry playground is a separate module example. A deterministic four-parameter map varies the switch-node return-spine width, gap above DC− copper, DC− bar height, and low-side die-pair horizontal offset in a paper-linked 45 × 50 mm DBC module. A trained NN emulates the reduced PEEC loop-inductance estimator at a fixed 100 kHz extraction setup. The heatmap and rotatable 3D landscape are two-dimensional slices of this four-input model: the selected axes vary while the other two inputs remain fixed. Fixed-resolution labels, mesh spot checks, NN test errors and shared-graph FastHenry comparisons are distinct evidence; none establishes new hardware validation. Module geometry is separate from the canonical converter assembly and its GLB export. The original two-input dataset and reproduction remain available as a versioned record.

The Control NN playground is a separate research companion: two fixed networks reproduced from ECCE2025 predict modulation performance for a 200 V input, 50 kHz DAB study, with comparisons to 4,633 cleaned PLECS samples. Its current-stress and ZVS predictions are not feedback duty commands or transient-response results for the conceptual 400 V/48 V hardware.

The IGBT RUL playground is another research companion. It uses a source-derived Gaussian BiLSTM and randomly selected recorded held-out windows. RUL is the count of detected cycles until the end of one A17 recording, not calendar or whole-converter life. Its 90% prediction interval describes individual outcomes under the learned Gaussian model; it is not a confidence interval for the mean. Raw Gaussian bounds are not clipped. The window split is within one device and overlaps, so reported test metrics do not establish unseen-device generalization.

## Language

**Output port**:
The low-voltage DC port J2 when the illustrated converter operates in the forward 400 V to 48 V direction. Its role reverses when power flow reverses.

**Output feedback**:
Sensed output voltage and current provided to the controller. Voltage is the regulated quantity in the control story; current supplies load context rather than an independent simultaneous regulation objective.

**Duty command**:
The requested gate-pulse on-time divided by the switching period, D = t_on / T_s. This is a pulse-width command, distinct from an interbridge phase-shift command.

**Control card**:
The physical CTRL1 board that could execute the NN controller and PWM-generation functions. A diagram of those functions is a logical expansion of the card, not a second processor.

**Illustrative transient comparison**:
Authored response curves showing a possible comparison under a stated common disturbance, with no physical units or numerical performance scale. They are not evidence of a trained controller's performance or of general NN superiority.

**Remaining useful life (RUL)**:
Remaining operation from the present condition to a modeled service-ending condition, conditional on assumed future use and current degradation knowledge. The maintenance story depicts wear-out prognosis with uncertainty, rather than an unconditional prediction of all failures.

**Fault diagnosis**:
An assessment of a possible existing fault from observed signals and context. In the maintenance story, no open/short indication can coexist with a deteriorating health trend; diagnosis is distinct from fast hardware protection.

**Predicted health indicators**:
Condition-related signal or learned trends used to support maintenance assessment. They do not by themselves establish component-specific damage or a calibrated RUL.

**Converter maintenance assessment**:
Combining monitored condition, fault and prognostic outputs to recommend inspection or planned service for the converter. Whole-converter scope does not imply complete observation of every component or failure mode.
