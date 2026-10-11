# QSwipe

## Your thumb has opinions. Give them a portfolio.

**Swipe the noise. Size the conviction.**

QSwipe turns market conversations into expressed preferences, then uses the **Quantum Approximate Optimization Algorithm (QAOA)** to search for a joint portfolio across Bitcoin, the S&P 500, Brent and Gold.

Built by **Almond** for the [Qollab hackathon](https://qollab.xyz/programs/hackathon).

[Launch QSwipe](https://almond-jade.vercel.app) · [Watch it optimize](https://almond-jade.vercel.app/#optimize) · [Explore the mathematics](https://almond-jade.vercel.app/#circuit) · [Read the Python](https://almond-jade.vercel.app/#code)

## The thesis: attention is already trading. Give it a better interface.

Our starting point is a world that feels permanently caffeinated: dopamine loops, leveraged bets, volatile narratives and the hunt for the next quick gain. A headline becomes a hot take. A hot take becomes a position. Somewhere between the refresh button and the liquidation price, the portfolio is supposed to make sense.

QSwipe puts a new interaction between the conversation and the allocation.

You read a market post. You swipe. You express a view. A quantum optimization algorithm searches combinations of those views alongside modeled risk, trading friction and funding costs. The result is one portfolio across four markets, with an exact classical benchmark sitting next to it.

**The feed supplies the conversation. You supply the conviction. The circuit searches the combinations.**

The bet behind the product is simple: a trading interface can feel as immediate as a social feed while making the portfolio reasoning visible. The swipe is the front door. The mathematics is right upstairs.

## Four markets. One portfolio. Zero spreadsheet foreplay.

| Instrument | Hyperliquid symbol | Available target choices |
| --- | --- | --- |
| Bitcoin | `BTC` | Short 20%, flat, long 20% |
| S&P 500 | `xyz:SP500` | Short 20%, flat, long 20% |
| Brent oil | `xyz:BRENTOIL` | Short 20%, flat, long 20% |
| Gold | `xyz:GOLD` | Short 20%, flat, long 20% |

These are **USDC perpetual contracts**. The output is one joint allocation, such as BTC long, S&P 500 flat, Brent short and Gold long. With three choices per asset, there are **81 valid target portfolios** before the demo constraints.

## Swipe. Solve. See what changed.

1. **Read the room.** Actual market-relevant X posts meet live Hyperliquid order books and reference prices.
2. **Make your call.** Right means bullish over the next 24 hours; left means bearish. Choose the affected asset and thesis group. Skip when you have no view.
3. **Watch conviction move.** Every directional swipe updates the relevant belief and cost terms immediately. Repeated swipes on the same thesis have capped influence; evidence decays with a 24-hour half-life.
4. **Freeze the moment.** Ten new directional swipes, or **Optimize now**, freeze beliefs, prices, risk, funding and current positions into one snapshot.
5. **Let the circuit search.** Previous angles warm-start a fixed-budget local QAOA retune. The circuit distribution supplies sampled portfolio combinations.
6. **Watch the rebalance land.** A successful run automatically applies its best eligible sampled target to the paper account. Positions, simulated fills and fees are visible.

Skips do not count toward the ten-swipe trigger. Undo removes the original directional event. Your swipe expresses a preference; it is not a calibrated return forecast.

**Doomscrolling, with an objective function.**

## A hackathon demo with something to show

The live experiment deliberately requires a **non-flat target different from the current direction vector**. Each successful run therefore changes the paper portfolio, even when the unrestricted model would prefer to sit still.

That constraint is explicit. Both QAOA sample selection and the exact classical reference use it. It is a post-measurement feasibility filter, not an extra gate hidden inside the circuit. Forced changes can increase modeled costs and fees; this mode is designed to make the experiment observable.

If no eligible target is sampled, or fresh quotes and execution checks fail, the app reports the failed run. It never invents a sampled portfolio or quietly swaps in the classical answer.

## Eight qubits. Plenty of opinions.

Each asset gets two bits: `(long, short)`.

| Encoding | Meaning |
| --- | --- |
| `00` | Flat |
| `10` | Long |
| `01` | Short |
| `11` | Invalid; penalized and excluded from allocation |

Eight qubits represent 256 basis states. The economic objective balances four things:

**Preference mismatch + joint risk + turnover friction + signed funding.**

For target direction vector s, conviction vector c and weights w = 0.20s:

```text
C(s) = mean((s − c)²)
     + 0.15 × (H / 24) × wᵀΣw / 0.0004
     + 0.50 × Σᵢ τᵢ |wᵢ − wᵢ_old| / 0.001
     + H × Σᵢ wᵢ fᵢ / 0.001
```

H is the 24-hour horizon; f is estimated hourly funding; τ combines fees, half-spread and modeled slippage. Σ is a declared synthetic daily covariance prior, not measured live correlations. Terms are dimensionless; dollar estimates are reported separately. The binary QUBO adds a 0.5 penalty per invalid `11` pair.

The app maps the QUBO to an Ising Hamiltonian and runs two QAOA layers: Hadamard preparation, cost-phase `Rz`/`Rzz` rotations, and `Rx` mixers. Four shared angles retune within **48 exact state-vector evaluations**, followed by **1,024 sampled shots**. Training includes all 256 outcomes; final selection filters invalid and demo-ineligible states.

The current app executes this quantum algorithm through a **classical browser-local simulator**. QAOA selects the lowest-cost eligible combination actually sampled. It does not guarantee the global optimum.

**Quantum curiosity. Classical receipts.**

The exact reference independently enumerates the 81 ternary targets, applies the same constraints and reports the objective gap. Seeded random baselines compare raw bitstring sampling with sampling from eligible valid targets. Their final draw budgets match QAOA’s shots; QAOA also spends a separate training budget. This is an inspectable research experiment, not a demonstrated quantum speedup or profitability claim.

## The app has six rooms. The circuit has its own.

| Tab | What happens there |
| --- | --- |
| **Swipe** | Market conversations, smooth gestures, convictions and batch progress |
| **Portfolio** | The 10,000 USDC paper account, actual marked position weights, separate conviction scores, fees and ledger |
| **Optimize Portfolio** | Automatic redirects when a run starts; live circuit progress, console toggle, replay and allocation result |
| **How it works** | Six interactive steps, with teaching examples isolated from your account |
| **Quantum Lab** | Rendered LaTeX, the cost function, QUBO/Ising mapping, circuit stages, probabilities and benchmark evidence |
| **Python Code** | Actual executable Qollab source with locally bundled Highlight.js IDE-style syntax coloring, copy controls and downloads |

GC Artum, orange, warm cream and dark surfaces give the interface its Almond identity. Touch, mouse, keyboard controls and optional haptics keep the swipe interaction responsive. The circuit panel lives inside Optimize Portfolio rather than following you around every page. Every completed local solve automatically starts a clearly labelled visual replay, without delaying actual allocation or disguising the fast CPU computation.

## Research spotlight: the QAOA connection

Quantum Lab opens with OpenAI’s September 25, 2026 preprint, [*QAOA attains the SK ground-state energy in the thermodynamic-first limit*](https://github.com/openai/math/blob/main/preprints/QAOA-attains-the-SK-ground-state-energy-in-the-thermodynamic-first-limit-September-25-2026/QAOA-attains-the-SK-ground-state-energy-in-the-thermodynamic-first-limit-September-25-2026.pdf). The result concerns expected energy per spin in the Gaussian, zero-field Sherrington–Kirkpatrick model, with system size tending to infinity before circuit depth increases. It provides no quantitative depth bound or efficient angle-selection procedure.

QSwipe uses the same standard Ising cost–mixer QAOA architecture studied there. Its portfolio objective also has local fields and financial constraints, so the theorem does not establish optimality for this app. We do not implement the paper’s proof construction or its universal deterministic angles.

To make the connection executable, `sk-research.mjs` adds an isolated eight-spin SK companion: seeded standard Gaussian pair couplings with 1/√n scaling, one or two layers, 48 local tuning evaluations and 1,024 final sampled shots. It follows the paper’s positive-energy convention by minimizing the negative Hamiltonian. The lab shows expected energy, best actual sampled energy, the exact 256-state optimum and the sampled gap per spin, with downloadable inputs and results. This finite classical simulation leaves the portfolio untouched and does not test the asymptotic theorem or demonstrate quantum speedup.

## Run it locally

Node 24 or newer. KaTeX is bundled locally; the web app requires no package dependencies.

```sh
git clone https://github.com/almond-lab/QSwipe.git
cd QSwipe
npm run dev
# Open http://127.0.0.1:3000
npm test
npm run build
```

The Vercel build emits static assets, server API functions and both Qollab starter ZIPs. The root page and `/signals.html` open QSwipe. `/markets.html` provides the order-book observatory; `/quantum.html` provides the protected manual IonQ connector.

## Take the circuit to Qollab

**Same frozen problem. A separately executed circuit.**

1. Download the [Python starter](https://almond-jade.vercel.app/qswipe-qollab.zip), or use the [JS / Qiskit visual starter](https://almond-jade.vercel.app/qswipe-qollab-js.zip).
2. Create the matching Qollab project. For Python, paste `qollab/main.py` or upload the kit. Qollab provides the global `backend`; the starter needs Qiskit, not Aer.
3. Use the embedded synthetic teaching snapshot, or export your frozen snapshot from Quantum Lab and include it as `snapshot.json`.
4. Press Run. Inspect returned counts, the sampled portfolio, exact reference and gap.

The Python entry point submits **exactly one backend job per Run**. Qollab calls its typed `main()`; do not add another call at the bottom. It does not retune remotely or act as the Vercel app’s execution API. New swipes do not modify an uploaded snapshot or launch hardware jobs. Backend availability determines whether the frozen evaluation uses a simulator or hardware.

See [Python setup](qollab/README.md) and [JS setup](qollab-js/README.md) for the full runtime contract and local Qiskit instructions.

## Connections and paper execution

Public Hyperliquid order books and metadata need no trading credentials. Configure server secrets in Vercel:

- `X_BEARER_TOKEN` enables X recent search. Optional `X_FEED_ACCESS_TOKEN` guards feed reads; `X_FEED_ACCOUNTS` restricts sources.
- `IONQ_API_KEY` and a ≥32-character `ALMOND_EXECUTION_TOKEN` enable the separate protected provider connector. `IONQ_BACKEND` defaults to simulator; hardware requires explicit `ALMOND_ALLOW_QPU=true`.

X recent search checks for new posts every minute while the page is visible, with a bounded one-minute server cache. Refresh prioritizes the newest unseen post; reviewed and skipped post IDs are remembered across market changes and reloads. Unread posts are merged into a deduplicated backlog, and an exhausted deck stays exhausted until new results arrive or you explicitly revisit it. This is polling, rather than a streaming firehose. Posts retain attribution and source links. Missing credentials produce a connection state, never fabricated content. Provider keys stay server-side and out of exported snapshots.

Paper buys consume ask depth; sells consume bid depth. Quantities round down to verified lot precision, fit 20% slots using post-cost equity, and obey an 80% gross cap with a conservative 1× margin model. Stale inputs, insufficient depth or a 50 bp distance-from-mid breach prevent an atomic rebalance. Funding affects the objective but is not settled in the initial paper ledger, so displayed P&L excludes it.

Browser storage preserves positions and directional events. Changed inputs from another tab clear older proposals and sync the account. Exports freeze the relevant snapshot; existing `almond` storage keys remain for compatibility. No wallets or exchange orders are involved.

## Show your work

JavaScript and Python tests cover the financial objective, QUBO/Ising equivalence, encoding, sampled-only selection, identical demo constraints, warm starts, automatic atomic allocation, stale-input guards and Qollab’s injected-backend contract. Browser checks cover repeated changed allocations, ten-swipe redirects, isolated tabs, rendered equations, executable source, responsive layouts and accessibility.

Primary references: [QAOA paper](https://arxiv.org/abs/1411.4028), [IBM RZZ](https://quantum.cloud.ibm.com/docs/en/api/qiskit/qiskit.circuit.library.RZZGate), [Hyperliquid API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api), [X recent search](https://docs.x.com/x-api/posts/search-recent-posts), [KaTeX](https://katex.org/docs/autorender.html).

---

**QSwipe. Put a little interference between the impulse and the allocation.**
