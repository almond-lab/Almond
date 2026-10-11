# QSwipe · Qollab-native joint portfolio experiment

This starter follows Qollab's browser runtime and uses the **pre-created `backend`**. It needs Qiskit and the Python standard library only. **No Qiskit Aer, provider setup, API key, or optional Libraries toggle is required.** The included `snapshot.json` is a labelled synthetic teaching example; prices, beliefs and cost estimates are hypothetical.

## Run on Qollab

1. Create a **Python / Qiskit** project. Paste the complete `main.py` into its code editor; the embedded synthetic teaching snapshot makes this single file runnable. Alternatively, upload and unpack the starter ZIP.
2. Keep `main.py` at the project root. `snapshot.json` is optional: upload it to override the embedded example with your own frozen export. Do not upload the whole website repository: its `index.html` and `main.js` would select a different runtime.
3. Replace the old `requirements.txt` with the one in this starter. It contains only `qiskit>=2.5.2,<3.0.0`. Remove any old `qiskit-aer` / `qiskit_aer` line. Leave optional libraries off.
4. Press **Run**, select **Built-in simulator**, and leave **Shots** at 1024. Keep **Compile For Backend** off for this simulator or IonQ; turn it on for an IBM noise-model simulator.
5. Read the joint sampled portfolio, exact reference, cost gap, validity, cap feasibility and Hold comparison in the console. The console also receives `qollab_result.json` through Qollab's `sendFile` API.

The script constructs and prints a global `circuit` before the run, matching the supplied Qollab example. Qollab then automatically calls the typed `main(shots, excludeLowProbabilityValues, lowProbabilityThreshold, compileForBackend)` function. Do **not** add a bottom-of-file `main()` call: that would submit twice. `main()` calls the injected `backend.run()` directly, once, polls `JobStatus`, and stops on DONE, ERROR or CANCELLED. It uses `job.get_counts()` when available, otherwise standard Qiskit `job.result().get_counts()`. It does not create a backend, retry or silently switch to simulation. Optional compilation uses optimization level 0.

The literal `"snapshot.json"` in the code lets Qollab discover and load an uploaded data file. If absent, the labelled synthetic teaching artifact embedded in `main.py` is used. Uploaded Python files can import each other normally. Files written during a run are temporary; `sendFile` exposes the report in the console rather than relying on persistent disk storage.

Verified on 11 October 2026 in Qollab's actual browser/Pyodide runtime with the corrected source supplied locally to the browser: both uploaded-snapshot and standalone-paste paths work. The standalone run used the embedded snapshot, reached `JobStatus.DONE`, returned 1,024 shots and exposed the JSON report in the console. No public project was changed or IonQ job submitted. The teaching angles are untrained, so a poor sampled proposal can correctly fail the Hold comparison. Remote hardware execution remains unverified.

**Exclude Low Probability Values** defaults to off. If enabled, it filters only the printed counts preview. All returned shots, including rare low-cost portfolios, are retained in the scientific report and candidate selection.

For your own frozen website experiment, export the QSwipe snapshot, rename it `snapshot.json`, and replace the teaching file. New website swipes never modify that uploaded snapshot or submit a Qollab job. The backend selected in Qollab determines whether the one-off run is local simulation, remote simulation, or hardware. The IonQ one-job-per-Run rule remains respected.

## Desktop teaching demo (optional)

Use Python 3.10 or newer:

```sh
python -m venv .venv
# macOS/Linux:
. .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python local_demo.py --seed 731
# Sample the document's original untrained angles instead:
python local_demo.py --seed 731 --no-retune
```

`local_demo.py` uses NumPy (a Qiskit dependency) for 48 exact CPU state-vector retuning evaluations, then one seeded Qiskit **BasicSimulator** job for 1,024 shots. It requires no Aer and writes `local_demo_result.json` in your current directory. It is a desktop CLI helper, not the Qollab entry point. The frozen teaching snapshot is unchanged. Results are classical simulation, not a QPU run or speedup evidence. Fixed seeds reproduce counts on the same dependency versions; timings vary by machine.

## Runtime compatibility and sources

We inspected the Code tabs of [Musiq](https://qollab.xyz/u/doraking/musiq), [Quantum Market Game Theory Simulator](https://qollab.xyz/u/q-aad/quantum-market-game-theory-sim), [Entangled Body](https://qollab.xyz/u/lukeshim/entangled-body), and [QCFlows: Multi-file Example](https://qollab.xyz/u/qollab/qcflows-multifile). Their patterns inform this starter; no project source is copied.

Qollab's [runtime docs](https://qollab.xyz/learn/docs/runtime-environment) describe Pyodide, the typed `main()` convention, literal data-file discovery and `sendFile`. [Python / Qiskit projects](https://qollab.xyz/learn/docs/python-qiskit-projects) documents the injected backend. [Upload docs](https://qollab.xyz/learn/docs/upload-your-files) explain top-level entry points and archive extraction. [Transpilation](https://qollab.xyz/learn/docs/transpilation) explains optimization levels and device compilation.

Qiskit is always installed; NumPy, SciPy and Matplotlib are Pyodide-provided packages loaded on import. Additional packages need a pure-Python wheel or a compatible Pyodide/WebAssembly build. Desktop compiled wheels are not sufficient. The Libraries menu offers curated packages, including a PQCA bundle that lists a pinned Aer build; that does not make an arbitrary desktop Aer requirement portable or necessary for this project. General project networking permits cross-origin GET requests, not POST, WebSocket or a server listener. This starter needs no outside data service.

## Mathematics and worked numbers

Four choices are jointly optimized: BTC, `xyz:SP500`, `xyz:BRENTOIL`, and `xyz:GOLD`. Each is short, flat, or long with an active slot of 20% equity. The default gross cap is 80%. This is a preference objective, not an expected-return forecast.

The attached document's teaching defaults are:

- Preference mismatch: average `(weight / 0.20 − conviction)²`.
- Risk: `0.15 × portfolio variance / 0.0004`; covariance is daily and scales by horizon / 24 hours.
- Turnover: `0.50 × estimated one-way execution fraction / 0.001`.
- Funding: `signed funding fraction / 0.001` over 24 hours.
- Invalid pair penalty: fixed `P = 0.5` per `11` pair.
- Minimum eligible improvement over current marked holdings: `0.0001` in objective units. Eligibility is not an automatic trade instruction.

The synthetic covariance uses daily volatilities `[4%, 1.2%, 2.5%, 1.5%]` and the document's six stated correlations. One-way execution rates are `[5, 3, 5, 4]` bp; long funding over 24 hours is `[1, 0.5, −0.8, 0.3]` bp. These are all-in teaching rates, not actual account fees. Reference prices `[70000, 6000, 80, 3000]` are illustrative USDC marks. Holdings start at zero.

The BTC example updates `0.35` to `tanh(atanh(0.35) + 0.8) = 0.8228060541`; the other convictions are `[0.80, −0.72, 0.67]`. Under the same updated objective:

| Candidate | Preference | Weighted risk | Weighted turnover | Weighted funding | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| `[flat, long, short, long]` | 0.226077 | 0.011945 | 0.120000 | 0.032000 | 0.390023 |
| `[long, long, short, long]` | 0.064674 | 0.035394 | 0.170000 | 0.052000 | 0.322069 |

The reduction is `0.0679540191`. This demonstrates a preference change, not future profit. The included angles `[γ₀, β₀, γ₁, β₁] = [0.71, 0.33, 1.12, 0.52]` are **unoptimized**: their ideal mean cost is `2.7839890682` and their valid probability is only `16.45523935%`. The local demo retunes them; it does not advertise those illustrative angles as good optimization.

## Evidence and constraints

`main.py` validates the frozen QUBO against an independent financial calculation for all 256 strings, and compares the exported circuit against its coefficients and radians. It independently enumerates all **81** valid portfolios as the classical reference.

A candidate must have appeared in the returned shot counts and pass both encoding validity and the gross cap. The report separates validity from feasibility, gives the additive objective gap, and includes two equally budgeted seeded random baselines: uniform raw 256 strings and uniform valid 81 portfolios. Raw uniform bits have expected validity `81/256 ≈ 31.64%`; valid-grid random draws are always encoding-valid. Tighter gross caps remain external feasibility filters, not an encoded Hamiltonian constraint.

The current marked holdings are evaluated continuously as an extra **Hold** option outside the 81-point grid. If there is no feasible sampled candidate, hold; the exact classical reference is never silently substituted. No order is sent by these files. Portfolio P&L, prices, actual fills and settled funding are separate from this preference score.

Bit order is explicit: Qiskit displays `q7…q0`; reports display `q0…q7`. Each pair is `(long, short)`: `00` flat, `10` long, `01` short, `11` invalid. Replacing an invalid `11` with `00` preserves its zero financial exposure and reduces cost by exactly `0.5`; it does not make every invalid cost larger than every valid cost.

JSON schema prefixes remain `almond.joint-portfolio.*.v1` for compatibility with existing exports; the project and documentation are named QSwipe. New exports must include the document's `moneyNormalization` and `minimumImprovement` settings. The runner rejects mismatched old objectives rather than silently applying different mathematics.
