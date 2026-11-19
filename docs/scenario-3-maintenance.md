# Maintenance story

Status: approved and implemented locally. The input context, diagnostic meaning and single-example narrative follow the confirmed choices below.

## One-view flow

**In-situ Vout / Iout waveforms + operating history / conditions → shared supervisory NN → three parallel heads → predictive maintenance for the converter**

One click on **AI for converter maintenance** reveals this view in a brief finite sequence, then holds for inspection. Retain Replay, Back and Reset view, with immediate final states for reduced motion. Use the existing hardware viewer, output-terminal sensing anchors and explorer-state restoration behavior.

## Sequence and content

1. **Observe the converter.** Highlight the existing J2 output connection. Two thin, differently colored sensing lines lead from its voltage/current markers to illustrative **Vout** and **Iout** waveform strips. Show ripple increasing over the authored observation window, while the overall operating level remains comparable. A small **Operating history / conditions** input joins the signal inputs. No new power terminals or detailed sensing circuits are required.
2. **Encode the observations.** Feed the waveform windows and context into one NN graphic labeled **Supervisory maintenance NN**. Present one shared representation branching into three parallel output heads. This depicts a possible multitask architecture, not a running model or a claimed on-device implementation.
3. **Remaining useful life.** Show a qualitative estimate shortening toward a **Modeled service limit**, with an uncertainty band and the note **Under assumed future use**. Define RUL as remaining operation from the present condition to the first modeled service-ending wear-out condition. Do not display an absolute converter lifetime or a precise time-to-failure number.
4. **Open/short-circuit diagnosis.** Show the classes **Normal**, **Possible open circuit**, **Possible short circuit** and **Uncertain**. Select **Normal** for this wear example, with **No open/short indication** as the result. This label describes the hard-fault diagnostic head; it does not declare that aging is absent. Fault diagnosis remains distinct from independent fast hardware protection.
5. **Predicted health indicators.** Show an illustrative increasing ripple/regulation-error trend and a worsening learned condition trend. Use generic indicators supported by the depicted signal/context inputs, rather than claiming component-specific ESR, inductance or thermal-resistance identification from output signals alone.
6. **Plan maintenance for the converter.** Merge all three heads into a single **Predictive maintenance** card: **Inspect degradation trend → Plan service**. Subtly emphasize the whole assembly as the maintenance-assessment scope. Do not imply that the NN has identified every component's condition or predicted every possible failure mode. The recommendation is illustrative and does not execute a service action or a switching/protection command.

The three heads are parallel outputs, not stages that feed into one another. Keep their graphics visible together after the reveal, without extra scenes or trial gates.

## Visual and scientific boundary

- Preserve the simple design/control visual language: hardware on the left, signal-to-network workflow and output cards on the right; a vertically scrolling layout on mobile.
- Maintain the user's unit-free illustrative style. No physical units, numerical axis ticks, RUL durations, fault probabilities or health percentages. Use symbolic labels and qualitative trends.
- Persistent notice: **Illustrative maintenance outputs**.
- Vout/Iout and history are conceptual inputs. No live acquisition, trained NN, calibrated RUL predictor, fault detector or converter simulation runs.
- RUL depends on an end-of-life definition, degradation history, assumed future use and uncertainty. Sudden random faults are not silently included in the wear-out estimate.
- Output voltage/current alone do not establish complete component observability or unique fault location. The whole-converter card expresses assessment and maintenance scope, not demonstrated diagnostic coverage of all 31 components.
- The NN represents supervisory analytics. Its execution may be assigned to a validated supervisory target in a real system; passive converter components do not execute it.
- Keep all 31 separable hardware components and their canonical export. Sensing annotations, network graphics and output cards remain outside the exported hardware root.

## Confirmed decisions

- Two prominent Vout/Iout waveform inputs plus a small operating-history/conditions input.
- Existing-fault diagnosis rather than prediction of future open/short-circuit risk.
- One gradual-degradation example, with no open/short fault indicated.
- Qualitative RUL/health deterioration feeding an inspection and service-planning recommendation.

## Implementation and verification

- The maintenance entry is available in the main navigation and all six maintenance application cards. Hardware inspection leaves the chosen application intact.
- The NN, three heads and recommendation reveal in finite stages. Replay resets those stages and the whole-assembly outline; Back or Escape restores the original explorer snapshot across direct design/control/maintenance switches.
- Desktop presents hardware and outputs together. At widths up to 1000 px, the workflow stacks and scrolls, with separate branch and merge rails retaining the parallel-head structure.
- All 33 tests pass, including waveform means/ripple growth, ordered RUL bands, hard-fault Normal coexisting with wear, existing J2 anchors, and the single assessment outline staying outside the canonical 31-component export. The production build passes.
- Browser checks covered desktop, tablet and mobile layout, moving sensing leaders, finite reveal/replay, hardware selection, AI application restoration, hidden/extracted/exploded parts, camera state, Escape and return focus. The browser console remained clear. Reduced-motion state handling and cleanup were reviewed in code; browser motion-preference emulation was unavailable.

## Sources for terminology and scope

- [NASA: Remaining Useful Life Estimation in Prognosis](https://ntrs.nasa.gov/api/citations/20140010623/downloads/20140010623.pdf): condition-based remaining life, assumed future usage and uncertainty.
- [TI: gate-driver diagnostic/protection discussion](https://www.ti.com/document-viewer/lit/html/SSZT051/GUID-8E18045A-1FE3-4B16-8532-43855AA8D88E): short-circuit faults and dedicated desaturation protection.
- The existing proposed maintenance mappings in `src/aiData.js` distinguish health indicators, fault diagnosis and separately validated RUL estimation. They do not constitute validated whole-converter diagnostic coverage.
