# Qollab Hackathon

This repository is for the [Qollab hackathon](https://qollab.xyz/programs/hackathon).

A responsive landing page and interactive template for comparing a classical
baseline with Grover's quantum search algorithm, styled with Almond's supplied
logo, GC Artum fonts, and Obsidian / Ember / Warm White palette.

The page includes animated orbital visuals with a pause control, benchmark
scenario presets, an interactive scaling sweep, keyboard chart navigation, and
reduced-motion support. The comparison export includes its model assumptions.

## Run locally

Run `npm run dev` and open `http://127.0.0.1:3000`.
Run `npm run build` to create the deployable static site in `dist/`.
No npm dependencies are required.

## Benchmark scope

The explorer uses illustrative mathematical models, not measured hardware
results. Query-complexity improvement is distinct from wall-clock speedup.
Both systems must meet the same success criterion. Modeled workload timings
include disclosed fixed overhead and verification; they exclude readout, state
preparation, networking, and other real hardware costs. Exports contain the model inputs
and derived comparison; they are not evidence of empirical quantum advantage.

Qollab circuit execution is a future integration: this template does not submit
quantum jobs or require API credentials. It links to Qollab's hackathon page.

Methodology references:

- [IonQ application benchmarking](https://www.ionq.com/quantum-benchmarks)
- [IBM Quantum: Grover's algorithm](https://quantum.cloud.ibm.com/learning/en/courses/fundamentals-of-quantum-algorithms/grover-algorithm/introduction)

Deploy to Vercel using the checked-in `vercel.json`. The site is static and runs
without a backend. User-supplied font and logo assets are included for this
project; no additional asset license is granted by this repository.
