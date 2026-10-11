# QSwipe

**A view changes everything.** A preference-aware portfolio playground for the [Qollab hackathon](https://qollab.xyz/programs/hackathon), by Almond.

Read actual market-relevant X posts. Swipe right for a bullish next-24-hours view, left for bearish. Smooth touch and mouse gestures, velocity-aware release, spring-back, keyboard controls, optional haptics, immediate conviction feedback and ten-view snapshot progress make the interaction responsive. Views are preferences, not return forecasts or profit probabilities.

The workspace has three views: **Swipe**, **Portfolio**, and **Quantum lab**. GC Artum, orange, warm cream and dark surfaces continue the supplied brand system. The root page and `/signals.html` both open QSwipe. `/markets.html` keeps the live order-book observatory; `/quantum.html` keeps the protected manual IonQ connector.

## Run the web app

Node 24 or newer, no package dependencies:

```sh
git clone https://github.com/almond-lab/QSwipe.git
cd QSwipe
npm run dev
# http://127.0.0.1:3000
npm test
npm run build
```

The Vercel build emits static assets, API functions and `qswipe-qollab.zip`. Public Hyperliquid books and metadata require no trading credentials. Without server X credentials, the app shows an explicit connection state and never invents posts.

## Execute the circuit on Qollab

The **[qollab/ folder](qollab/README.md)** is independently runnable. It contains a labelled synthetic teaching snapshot, complete Python circuit code, Qollab-only requirements, an optional desktop demo and reproducible example output. The Qollab starter ZIP excludes the desktop helper to avoid confusing it with the `main.py` entry point. A website export is optional.

1. Create a **Python / Qiskit** Qollab project.
2. Paste the complete `qollab/main.py` into the editor, or upload the starter ZIP. It contains an embedded synthetic teaching snapshot, so uploading `snapshot.json` is optional. The requirements contain only Qiskit; remove old Aer requirements.
3. Select a Qiskit-compatible backend. Qollab supplies `backend`; press Run once.
4. Inspect the sampled portfolio, independent exact reference, cost gap, validity, cap feasibility, random baselines and Hold comparison in the console. Download/copy `qollab_result.json` from the console.

Qollab automatically calls the typed `main()` entry point with shots, optional preview filtering and optional backend compilation. The circuit is constructed and printed at the top level; `main()` directly submits to `backend`, polls status and handles both job/result counts APIs. Do not add a bottom-of-file call. `main.py` calls `backend.run` exactly once. It does not train remotely, retry submissions, read provider credentials, or send exchange orders. Hardware availability depends on your Qollab backend; actual remote execution has not been verified here. `job.result().get_counts(0)` is the expected backend contract.

For a local CPU experiment:

```sh
cd qollab
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 local_demo.py --seed 731
# One frozen run without retuning:
python3 local_demo.py --seed 731 --no-retune
```

Qiskit 2.5.2 / NumPy 2.5.4 runs were verified; the updated starter and desktop demo use no Aer. The included sample output is from classical simulation, not hardware. Local retuning uses 48 exact state-vector evaluations and one final built-in BasicSimulator job. Equal-budget random baselines can also find the exact optimum in this small grid.

The corrected starter was also verified in Qollab's actual browser/Pyodide runner on the built-in simulator: automatic entry point, literal snapshot loading, 1,024 returned shots, one submission and console JSON export. Twelve additional Python regression checks cover that runtime contract (`python3 scripts/test-qollab.py` from the repository root in an environment with Qiskit installed).

For your live beliefs, choose **Export my frozen Qollab snapshot** in Quantum lab and replace the teaching `snapshot.json`. New swipes never change an uploaded snapshot or launch remote jobs.

## Preference-aware model

One joint allocation covers BTC, `xyz:SP500`, `xyz:BRENTOIL`, `xyz:GOLD` in that order. Each target is short 20%, flat, or long 20% of frozen equity: 81 valid portfolios and an 80% gross cap. These are USDC perpetual contracts, not shares or physical commodities.

The supplied *Preference Aware Portfolio Cost and the Quantum Circuit* document defines the mathematics. Its teaching normalizations are implemented:

- Preference mismatch: `A = mean((choice - conviction)^2)`.
- Joint risk: `λR R = 0.15 × wᵀΣH w / 0.0004` (2% reference volatility squared).
- Turnover: `λT T = 0.50 × Σ oneWayCost_i |w_i - currentWeight_i| / 0.001`.
- Signed funding: `λF D = Σ horizonFunding_i w_i / 0.001`.
- Invalid pair penalty: `0.5 × Σ longBit_i shortBit_i`.

Every term is dimensionless. Dollar estimates are reported separately. The reference weights are teaching defaults, not calibrated financial recommendations. Σ is the document’s explicitly synthetic daily covariance from volatilities `[4%, 1.2%, 2.5%, 1.5%]` and its listed correlations; it is PSD and not measured live correlations. Execution uses actual spreads plus modeled 5 bp fees and 1 bp slippage; funding uses current hourly estimates over 24 hours.

Each asset uses `(long,short)` bits: `00` flat, `10` long, `01` short, `11` invalid. q0 is the leftmost displayed bit and the least significant integer bit. The QUBO exactly preserves economic costs even for 11; repairing 11 to 00 leaves economic costs unchanged and removes the 0.5 penalty. The Hamiltonian keeps the identity offset in reported costs and drops it only from phase evolution.

QAOA uses eight H gates, then two layers of `Rz(2γh)`, pair `Rzz(2γJ)` banks, and `Rx(2β)`. Pair gates decompose to CX → Rz → CX. Four shared angles retune within 48 evaluations. Training averages **all** 256 outcomes, including invalid encodings. A belief-only edit changes its two local fields and a constant; pair couplings stay fixed. The interactive circuit view distinguishes preparation, phase rotation, first-mixer ideal probabilities and actual final shot frequencies.

Final selection rejects invalid/cap-infeasible outcomes and selects only the lowest-cost feasible portfolio **actually sampled** among 1,024 shots. It never substitutes the exact solver. Independent exhaustive enumeration provides the exact reference, additive gap, validity rate, cap-feasibility rate and optimal sampling frequency. Two reproducible random baselines use the same 1,024 draw budget: uniform raw 256 strings versus uniform valid 81 portfolios. These have different validity rates and are explicitly labelled.

Continuous current marked holdings are an additional **Hold** outside the 81-point target grid. Turnover for Hold is zero. A proposed paper rebalance must improve the same frozen objective by at least **0.0001**; otherwise hold. Cost fit, search quality and future paper P&L are separate questions. No quantum speedup, profit forecast or global-optimum guarantee is claimed.

## Cadence and paper execution

Every directional event updates bounded conviction and current cost fields immediately. Evidence has a 24-hour half-life, caps repeated influence at ±1 per asset/thesis, and uses tanh saturation with weight 0.5 and zero initial priors. The document’s weight-0.8 bullish worked example is reproduced separately in tests and the teaching snapshot.

**Ten** new directional views trigger a browser-local solve, preserving the user’s explicit cadence over the document’s three-view illustration. Skips do not count. Undo removes the original decaying event. **Optimize now** uses the same pipeline and starts a new batch. Previous angles warm-start the next fixed-budget retune. Each solve freezes beliefs, prices, covariance, positions, equity, funding, costs and constraints. New views, account changes or a snapshot older than five minutes make results historical and block applying them. Remote Qollab/IonQ runs remain manually frozen one-off evaluations.

Paper accounts start at 10,000 USDC. Review and confirmation are required for fills. Buys consume ask depth, sells consume bid depth; reversals charge full closing/opening turnover. Quantities round down to verified lot precision and fit 20% slots using post-cost equity, 80% gross and conservative 1× margin. Stale inputs, insufficient depth or a 50 bp distance-from-mid breach hold positions atomically. Confirmation expires after 60 seconds or a >50 bp quote-notional change. No-change results incur no fills, fees or revision. Funding is estimated in the objective but **not settled by the initial paper ledger**; displayed P&L excludes funding.

Private browser storage preserves paper positions and directional events. Legacy generic agreement reactions are not reinterpreted as market direction. Cross-tab changes block proposals until reload. Exports contain no provider credentials. Existing browser session keys and artifact schemas retain their `almond` prefix for compatibility.

## Server connections

Set secrets only in Vercel’s server environment, then deploy:

- `X_BEARER_TOKEN`: live X recent-search access. Optional `X_FEED_ACCESS_TOKEN` guards reads; optional `X_FEED_ACCOUNTS` restricts up to 20 source accounts.
- `IONQ_API_KEY` and a ≥32-character `ALMOND_EXECUTION_TOKEN`: protected manual provider connector. `IONQ_BACKEND` defaults to simulator; `ALMOND_ALLOW_QPU=true` is an explicit hardware opt-in.

X queries are bounded to five market queries / 50 posts per batch, cached and coalesced for five minutes. This is periodic recent search, not a streaming firehose. Actual text, attribution, source links and available media remain visible; X likes stay separate from user convictions. Provider errors are sanitized. Do not place provider keys in client code or exported snapshots.

## Validation

Automated tests cover the document’s worked costs and fields, all-256-state direct/QUBO/Ising equivalence, PSD validation, invalid repairs, continuous Hold, exact enumeration, normalized complex amplitudes, independently reconstructed circuits, seeded random benchmarks, budget limits, sampled-only selection, guarded atomic paper fills, feed normalization, auth and caching. Browser checks cover touch/mouse, vertical reading, tabs, ten-view cadence, historical results, manual confirmation, accessible stage controls, keyboard use and responsive layouts. Tests never submit exchange orders or provider hardware jobs.

Primary references: [QAOA paper](https://arxiv.org/abs/1411.4028), [IBM RZZ](https://quantum.cloud.ibm.com/docs/en/api/qiskit/qiskit.circuit.library.RZZGate), [Hyperliquid API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api), [X recent search](https://docs.x.com/x-api/posts/search-recent-posts).
