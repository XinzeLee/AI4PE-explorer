# AI converter-design workflow

The design view is a single conceptual animation launched with **AI for converter design**. Other application descriptions remain available through AI opportunities.

## One-click pipeline

Distinct semiconductor, magnetic, thermal-heatsink and EMI-filter highlights connect through thin diagram strings to a neural-network surrogate. The strings represent encoded component design choices and operating conditions, not physical wires. The surrogate leads to **performance / multiphysics field estimates**, then an optimizer and a compact **2D efficiency–power-density Pareto diagram**. A return connection from the optimizer to the design inputs indicates another candidate evaluation. The sequence is finite; it does not run a continuing optimization or require scene-by-scene advancement.

The neural network represents a surrogate that could estimate losses, temperatures or fields. Engineering calculations can derive efficiency from losses and density from rated power and package volume. Feasibility checks precede objective comparison. The modeling block describes estimates; it does not display a computed multiphysics solution.

## Scientific and display boundary

`src/converterDesignData.js` defines four hardware groups, their anchors and colors, plus 17 authored feasible candidates. The SVG in `src/DesignPareto.jsx` plots normalized efficiency and power density on fixed zero-to-one axes. Twelve gray points are dominated; five colored points trade higher efficiency against higher density. Both objectives are maximized.

A point is dominated when another feasible point is no worse in both objectives and strictly better in at least one. Equal objective vectors do not dominate each other. The highlighted front is nondominated **among the shown candidates**, not a proven global optimum. Its dashed connecting line is a visual guide only and does not establish evaluated intermediate designs.

The persistent notice is **Conceptual workflow · illustrative feasible candidates**. Expandable detail states that coordinates are authored and no trained model, physics solver or optimizer was executed. There are no absolute efficiency, density or lifetime predictions and no claim of measured or simulated converter results.

## Components, accessibility and verification

`DESIGN_GROUPS` maps Q1–Q8, T1/L1, HS1 and EMI1/LCM1/CX1/CX2 to the retained 31-part assembly. The separate HV busbars remain part of the assembly but are not a fifth conceptual input group. Existing component separation, canonical GLB export and What–Which–How descriptions remain available outside the workflow.

The native SVG has an accessible title/description, direct axis labels and a text legend. Front points expose their normalized coordinates to keyboard and screen-reader users; optional Enter/Space activation reports a selected point without changing hardware geometry. `reveal=false` shows empty axes until the parent animation reveals the diagram.

`npm test` covers two-objective dominance, ties, invalid/infeasible records, immutable filtering, front changes, conceptual target mappings and the retained 31-part inventory. Existing geometry tests remain responsible for canonical assembly/export behavior. Browser validation separately verifies the integrated animation, strings, responsive layout, reduced motion and existing explorer interactions.
