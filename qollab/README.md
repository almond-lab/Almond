# QSwipe · portable joint portfolio experiment

This folder runs independently of the website. It includes a **synthetic teaching snapshot**, a local CPU/Aer demo, and a one-off Qollab runner. No credentials or provider account are needed for the local demo. The included prices, convictions, covariance and cost estimates are hypothetical.

## Local Python run

Use Python 3.10 or newer:

```sh
python -m venv .venv
# macOS/Linux:
. .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python local_demo.py --seed 731
```

`local_demo.py` retunes four QAOA angles with **48 exact CPU state-vector evaluations**, including invalid samples in the expectation. It then makes **one local Aer simulator submission** for 1,024 shots. It writes `local_demo_result.json`. This is classical simulation of a quantum circuit, not a QPU run or a speedup result.

To inspect the document's unoptimized illustrative angles instead:

```sh
python local_demo.py --seed 731 --no-retune
# Alternatively, one frozen local sample without retuning:
python main.py --local
```

The teaching `snapshot.json` is unchanged by these commands. A fixed seed reproduces the local sample distribution on the same dependency versions. Timings can vary by machine and are not a computational-speedup benchmark.

## Run once on Qollab

1. Upload `main.py` and `snapshot.json` together into a Qollab project. The included snapshot is enough for a teaching run; no browser export is required.
2. Qollab must expose a pre-created Qiskit-compatible variable called `backend`.
3. Press Run once. `main.py` calls `backend.run(compiled, shots=...)` **exactly once**. It never trains remotely, retries a submission, connects directly to a provider, or reads API credentials.
4. Inspect stdout and `qollab_result.json`. Whether the job is a simulator or hardware execution depends on the backend Qollab supplied.

The backend must support Qiskit's circuit `run` and `job.result().get_counts(0)` contract. A primitive-only Sampler interface requires a separate adapter. If Qollab executes files by importing rather than running them as scripts, invoke `main(backend)` once after importing the module.

To evaluate your own frozen website experiment, replace the synthetic snapshot with an export named `snapshot.json`. New swipes do not modify that file or submit provider jobs automatically.

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
