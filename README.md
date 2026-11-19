# Explore the Application of Artificial Intelligence in Power Electronics

Explore the basics of artificial intelligence for power electronics through an interactive 3D converter and hands-on neural-network examples. The site connects physical hardware to three areas where AI can support engineering: **design, control, and maintenance**.

## Explore the 3D model

<a href="https://xinzelee.github.io/AI4PE-explorer/"><img src="docs/images/play-3d-model.svg" width="320" alt="Play the interactive 3D model"></a>

[![The 3D power converter explorer, showing the converter and its components](docs/images/explorer.png)](https://xinzelee.github.io/AI4PE-explorer/)

Rotate and zoom the conceptual dual-active-bridge converter, select its components, and separate or reassemble the hardware. Explore its semiconductors, capacitors, magnetics, gate drivers, control board, heatsink, and EMI filter.

## Three ways to learn

| Case study | What you can explore |
| --- | --- |
| **Design** | See a conceptual AI-assisted design workflow, then change power-module geometry and explore a neural-network estimate of loop inductance in 2D and 3D. |
| **Control** | Follow an illustrated control workflow with triple-phase-shift waveforms, then use a companion DAB neural-network example to predict current stress and zero-voltage-switching counts. |
| **Maintenance** | Explore how operating signals can inform condition monitoring, then inspect recorded IGBT waveforms with a neural-network estimate of remaining life and a 90% prediction interval. |

The converter hardware and workflow diagrams are educational illustrations. The interactive neural-network playgrounds are separate research examples using fixed, locally evaluated models; their predictions are not measurements or validation of the pictured converter.

## Run locally

Install Node.js 22.12 or later, open a terminal in the project directory, and run:

```sh
npm ci
npm run dev -- --port 4173
```

Open the address printed in the terminal, usually [http://127.0.0.1:4173/](http://127.0.0.1:4173/). Drag to orbit the model, scroll to zoom, and click a component to learn about it. The application and its neural-network inference run in the browser; no separate inference server is required.

## Publish on GitHub Pages

This project includes a GitHub Actions workflow for building and hosting the interactive site. See the [GitHub Pages guide](docs/github-pages.md) for deployment and future updates.

## Sources and further reading

- [Fundamentals of AI for Power Electronics](https://github.com/XinzeLee/Fundamentals_of_AI_for_PE)
- [ECCE2025 DAB tutorial and data](https://github.com/XinzeLee/ECCE2025)
- Model details and source attribution: [Design](docs/design-nn-4d-model.md) · [Control](docs/control-nn-model.md) · [Maintenance](docs/rul-nn-model.md)

Created by **Xinze Li**. The project includes third-party materials with their own license notices; see the linked model records for details.
