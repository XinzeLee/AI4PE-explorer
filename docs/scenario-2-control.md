# Control story

Status: implemented locally after approval of variable-duty control and a load-step comparison against PI. All displayed response and timing graphics are illustrative, without physical units or numerical performance scales.

## Simple interaction

One click on **AI for converter control** reveals a single hardware-and-diagram view, then holds for inspection. Reuse the brief finite reveal and return-to-explorer behavior of the design overview; no scene gates or trials.

## Confirmed flow

1. Highlight J2 as the output for the illustrated forward operation. Label its existing positive/negative connections. Add conceptual voltage-sense and current-sense markers, with two distinct thin feedback lines. No additional power terminals are necessary.
2. Feed Vout, Iout and the voltage reference into a compact **NN-based controller** graphic. Output a bounded **Duty command D = t_on / T_s**. The task is output-voltage regulation, with current as load/context feedback.
3. Show **Symmetric variable-duty PWM** with visibly changing pulse widths. The NN and PWM graphics are logical functions running on CTRL1. A thin callout connects this expanded view to the highlighted physical card; the diagram does not imply an external NN processor delivering PWM into the card.
4. Continue the actuation path from CTRL1 through the gate drivers to the semiconductor bridges, then back to the sensed output. Keep this continuation visually subordinate to the requested feedback, NN and PWM graphics.
5. Reveal an **Illustrative transient response** chart for a load-current increase, with NN and conventional PI output-voltage responses overlaid on the same axes. Both start from and settle to the same voltage reference. A smaller dip/faster recovery for the NN is a hypothetical authored example, not a general performance claim.

## PWM interpretation

Retain the DAB power stage and use symmetric variable-duty modulation rather than presenting variable-duty control as conventional single-phase-shift control. For the limited timing illustration, a fixed nonzero interbridge phase is assumed.

Representative gate commands have equal width D*T_s, with 0 < D < 0.5, separated by half a switching period. Complementary gates include dead time. The ideal bridge voltage contains balanced positive/negative pulses and zero intervals. Update paired widths together at cycle boundaries. Representative waveforms are not a complete firmware implementation or a validated converter operating map.

This timing construction is supported by the D_B = 0 case in [Shubnaya et al., IET Power Electronics, section 4](https://ietresearch.onlinelibrary.wiley.com/doi/10.1049/pel2.12757). It establishes a suitable conceptual waveform construction; it does not validate this site's NN or transient curves.

## Comparison boundary

- Same converter, voltage reference, initial conditions, disturbance, sampling and actuation limits for both illustrated controllers.
- Label the response axes **Time** and **Output voltage**. Omit physical units, numeric ticks and quantitative performance readouts. Label the common target **Reference** and mark the disturbance **Load step**; an optional load-current cue also has no units or numeric scale.
- PWM sketches show pulse-width changes with symbolic **D** and high/low states, without physical time units, switching-frequency values or percentages.
- Persistent **Illustrative response comparison** notice. Expandable text explains that no trained NN, circuit simulation or real-time controller executes.
- No numerical improvement percentages, measured settling times, or claims that the NN always outperforms conventional control.
- Sensing markers denote measurement functions; the existing model has no detailed sensor or ADC circuits.

## Confirmed choices

- Variable-duty control, shown as changing pulse widths.
- Load step versus a conventional PI controller.
- Illustrative graphics without units or numeric performance scales.

## Implementation and verification

`src/converterControlData.js` defines the hardware groups, symmetric pulse patterns and authored NN/PI response shapes. `ControlSignals.jsx` and `ControlResponse.jsx` render accessible SVG sketches. `ConverterControlOverview.jsx` connects them to the existing viewer through projected J2/CTRL1 anchors. The sensing markers and diagram are outside the canonical hardware export; all 31 named components remain available in the explorer.

The finite reveal changes the paired pulse widths twice, reveals the comparison, and holds. Replay repeats that illustration. Reduced motion shows the final state immediately and clears pending timers when the preference changes. Closing or pressing Escape restores the preceding explorer state; switching directly between design and control preserves the original snapshot.

Automated checks cover paired PWM widths, half-cycle symmetry, modeled complementary dead time, ideal pulse-area balance, shared response reference/event, hardware target validity, projected terminal/card anchors, rapid story switching and canonical export geometry. Browser checks cover desktop/mobile layout, all three primary leaders, orbit tracking, hardware picking, state restoration and preservation of the selected AI application.
