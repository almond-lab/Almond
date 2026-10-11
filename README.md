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

## Hyperliquid trading lab

Open `/markets.html` for live, read-only USDC perpetual order books:

| Display market | Exact Hyperliquid API coin | Venue |
| --- | --- | --- |
| BTC/USDC | `BTC` | Native perpetuals |
| S&P500/USDC | `xyz:SP500` | Trade[XYZ] HIP-3 |
| BRENTOIL/USDC | `xyz:BRENTOIL` | Trade[XYZ] HIP-3 |
| GOLD/USDC | `xyz:GOLD` | Trade[XYZ] HIP-3 |

The browser verifies live metadata, including USDC collateral (token 0), before
subscribing to `l2Book` on `wss://api.hyperliquid.xyz/ws`. It displays up to 20
levels per side, cumulative visible depth, midpoint, spread in basis points,
and notional depth imbalance. This is a perpetuals view; BTC spot uses a
different API identifier. Unavailable instruments are explicitly labelled.

Add each strategy's public master-account or subaccount address in the page.
Use actual trading account addresses, not API agent/signing-wallet addresses.
Addresses and optional client-order-ID prefixes are saved only in browser local
storage. Separate subaccounts are preferred. Shared accounts require two
non-overlapping hexadecimal client-ID prefixes; unmatched orders are omitted
instead of guessing their strategy. Changing configuration resets session counts.

Orders come from the public `frontendOpenOrders` endpoint on both native and
`xyz` venues. `orderUpdates` and `openOrders` streams trigger reconciliation;
terminal updates remove quotes immediately. REST snapshots also refresh every
15 seconds. Public `orderStatus` calls enrich immutable client IDs and
time-in-force in bounded batches (24 new orders per account per refresh).
Large accounts may need successive refreshes to finish attribution. Triggers,
market orders, zero-size orders, and assets outside these four are excluded.
The page labels post-only only when `tif` is explicitly `Alo`; other resting
limit orders are not assumed to have been submitted post-only.

Classical and quantum quote badges appear at matching price levels and on the
depth chart. Orders beyond visible depth remain in the table. Strategy cards
cover the selected market: resting count, remaining notional, notional-weighted
passive offset from midpoint, and observed maker-fill events during this page
session. Positive offset is away from midpoint; negative is beyond midpoint.
Maker fills require `crossed=false`. Historical snapshots are excluded, duplicates
are suppressed, and shared/tagged accounts count only fills matched to known
client IDs. Reconnect gaps and unobserved IDs can undercount; this is not a fill
rate, full trade history, P&L report, or quantum-performance measurement.

The socket sends a heartbeat every 20 seconds and reconnects with exponential
backoff capped at 30 seconds. Books with no fresh update for 15 seconds are
marked stale. A REST-only book is labelled as a snapshot. Failed order refreshes
or order snapshots older than 35 seconds are marked stale; cached orders are
excluded from overlays and summary totals. Exported JSON includes freshness,
timestamps, account attribution, quantities, and metric definitions.

No API secret, wallet connection, transaction signing, or exchange write endpoint
is used. Strategy execution remains external. Future measured comparisons need
matched experiment windows, end-to-end decision timings (including quantum job
overhead), reconciled fills, fees, inventory/risk constraints, and strategy-run IDs.

Run `npm test` for attribution, normalization, metric, stale-data, fill, and
snapshot-race tests. Browser QA additionally exercised live streams for all four
markets, responsive layouts, account overlays with mocked exchange data,
cancellations, filtering, reconnects, exports, and accessibility.

Exchange documentation:

- [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)
- [Public info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [Heartbeat and timeout behavior](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats)

## Benchmark scope

The explorer uses illustrative mathematical models, not measured hardware
results. Query-complexity improvement is distinct from wall-clock speedup.
Both systems must meet the same success criterion. Modeled workload timings
include disclosed fixed overhead and verification; they exclude readout, state
preparation, networking, and other real hardware costs. Exports contain the model inputs
and derived comparison; they are not evidence of empirical quantum advantage.

The benchmark explorer remains an illustrative model. Measured provider runs
are separate from the explorer and available through the circuit runner below.

Methodology references:

- [IonQ application benchmarking](https://www.ionq.com/quantum-benchmarks)
- [IBM Quantum: Grover's algorithm](https://quantum.cloud.ibm.com/learning/en/courses/fundamentals-of-quantum-algorithms/grover-algorithm/introduction)

Deploy to Vercel using the checked-in `vercel.json`. Static frontend assets and a protected Node execution function are deployed
together. User-supplied font and logo assets are included for this
project; no additional asset license is granted by this repository.


## Live circuit execution

Open `/quantum.html` to submit IonQ QIS circuits, follow job status, retrieve
probability artifacts, and export the circuit, run ID, circuit hash, and timing.
The Bell starter tests connectivity; it is not a trading strategy. Market context
is metadata only and does not submit orders or change the live market feed.

The path is browser → Vercel `/api/quantum` → IonQ v0.4 API. Qollab can remain
where circuits are authored and reproduced. Its documented browser runtime is
not an external job server; Qollab hackathon credits are not assumed to authorize
this direct IonQ integration.

Set these values in Vercel's server environment settings and redeploy:

- `IONQ_API_KEY`: your provider API credential, never entered in the browser.
- `ALMOND_EXECUTION_TOKEN`: an independently generated random access code of at
  least 32 characters. Enter this app code in the runner to submit or resume jobs.
- `IONQ_BACKEND`: defaults to `simulator`. The ideal simulator returns
  probabilities and ignores requested shots; this is not quantum hardware.
- `ALMOND_ALLOW_QPU`: defaults to `false`. Hardware requires `true` and an
  authorized `qpu.forte-1` or `qpu.forte-enterprise-1` backend.

For local execution, put the same values in an ignored `.env.local` file using
`.env.example` as a guide. Node 24 is used for local development. No credentials
are included in this repository. Missing configuration leaves execution disabled.

This first integration supports 1–8 qubits, 1–256 gates and 1–4096 requested shots.
Supported gates: `h`, `x`, `y`, `z`, `s`, `si`, `t`, `ti`, `rx`, `ry`, `rz`,
`cnot`, and `swap`. Rotations use radians. Qiskit source is not executed on Vercel;
provide a supported IonQ QIS JSON circuit. The server fixes the backend,
validates all inputs, and protects job actions with the app code and origin checks.

Accepted submissions return a signed receipt, valid for 24 hours, restricting
status retrieval to that job. This tab saves the receipt and job in session
storage; it does not save the access code. Exported JSON omits both. Keep the
app code private: anyone with it can submit jobs within these limits. There is
no automatic resubmission after an uncertain provider response. Check the IonQ
dashboard first if submission could not be confirmed. Pausing browser updates
does not cancel a provider job. Lost receipts and older jobs can be checked in
IonQ directly.

Job status polls every four seconds with bounded retries. Completed jobs retrieve
`ionq.result.probabilities.json.v2` artifacts from IonQ and preserve the raw
returned JSON. Browser-observed elapsed time includes network, queueing, and
polling. Provider execution duration is shown separately when returned. Neither
establishes quantum speedup or the latency of an entire trading strategy.

Validation includes service tests for authentication, limits, signed receipts,
provider requests/results, and sanitized errors. Browser tests exercise mocked
job lifecycles separately from the live setup endpoint. No real provider job has
been verified until account credentials are configured and a test run succeeds.

Execution documentation:

- [Qollab runtime environment](https://qollab.xyz/learn/docs/runtime-environment)
- [IonQ v0.4 job submission](https://docs.ionq.com/api-reference/v0.4/jobs/create-job)
- [IonQ job status](https://docs.ionq.com/api-reference/v0.4/jobs/get-job)
- [IonQ result artifacts](https://docs.ionq.com/api-reference/v0.4/jobs/get-job-artifact)


## Market Pulse: market-relevant X posts

Open `/signals.html` for a card deck covering BTC, S&P 500, Brent oil and gold.
Swipe right for a bullish 24-hour view, left for bearish; the buttons and arrow
keys provide the same actions. Choose the affected asset explicitly for a
multi-asset post and select a thesis group. Skip, undo, topic selection, batch ordering, review
filters, JSON export and clear-history controls are included. These are personal
directional preferences, not X likes, expected returns or measured market sentiment. No X write endpoint
or exchange order endpoint is called.

To enable real posts, set `X_BEARER_TOKEN` in Vercel's **Production** server
environment and redeploy. The token must authorize X API v2 recent search, and
the X account must have available API access/credits. Never paste this provider
secret into the page, source code, or chat. Until connected, the deck shows an
explicit setup state with no invented posts.

Optional server settings:

- `X_FEED_ACCESS_TOKEN`: an independent workspace code that guards feed reads.
  Enter this code in the page's collapsed access section; it is kept only in
  memory and cleared when leaving the page. Without a guard, cached posts are
  public to anyone visiting the site.
- `X_FEED_ACCOUNTS`: comma-separated X usernames, up to 20, to limit search to
  trusted sources. The default searches the broader English-language topic
  conversation.

The server exposes GET `/api/x-feed?market=all` (or one exact API coin). It uses
five fixed, bounded queries and retrieves at most 50 recent posts per batch.
Search excludes reposts and replies; normalization also excludes sensitive,
withheld, protected, and malformed results. Authors, timestamps, full text,
entity links, available photos and source permalinks remain visible. Video links
open on X. Author identity and topic matches do not prove factual reliability,
market impact or a quantum/classical strategy result.

Posts refresh at most every five minutes while the page is visible, with manual
refresh available. Server instances cache/coalesce each market's reads for five
minutes; public successful responses also use Vercel's CDN cache. This is periodic
recent search, not a streaming firehose. Most-liked ordering sorts the returned
batch, not all X posts. Deployment or distributed cold starts may perform extra
reads; configure X account spending limits to bound overall API consumption.
Provider errors are sanitized, cached briefly, and shown without stale cards.

Directional views persist in local storage in this browser (up to 500 records).
Legacy agreement/disagreement history is not reinterpreted as bullish/bearish views.
Only post IDs, source links, handles, timestamps, topic labels and choices are
saved; post content and API credentials are not persisted. Undo is available for
this visit. Cross-tab changes block applying portfolio proposals until reload. JSON exports include the local
scope and omit credentials. Clearing history affects only this browser.

Validation covers query/auth limits, caching, normalization, provider failures,
reaction persistence, filters and deliberate swipe thresholds. Browser QA uses
labelled fixtures to exercise the live-card UI separately from the real setup
endpoint; production posts require the configured server credential and valid provider access.

X documentation:

- [Recent search](https://docs.x.com/x-api/posts/search-recent-posts)
- [Search query construction](https://docs.x.com/x-api/posts/search/integrate/build-a-query)
- [API credits and spending limits](https://docs.x.com/x-api/getting-started/pricing)
- [Post display requirements](https://docs.x.com/developer-terms/display-requirements)


## One joint paper portfolio and local QAOA loop

Market Pulse now proposes a single portfolio in fixed order: BTC, xyz:SP500,
xyz:BRENTOIL, xyz:GOLD. Each choice is flat, long a 20% exposure slot, or short a
20% slot; four assets give 81 valid portfolios. These are USDC perpetuals, not
shares or physical commodities. Slots are bounded; swipes never increase them.

Every directional view creates an event with asset, sign, thesis and time.
Evidence has a 24-hour half-life, is capped to ±1 per asset/thesis group and maps
to bounded conviction through tanh(0.5 × capped evidence). Undo removes the
original decaying event. Skips create no event. After **10 new directional
swipes**, the browser automatically freezes beliefs, marks, daily covariance
prior, funding estimates, current quantities, equity and constraints. The
**Optimize now** button runs the same pipeline and starts a new swipe batch.
Stale books or unverified metadata pause optimization and paper fills; positions
are held. New views during a run belong to the next batch and make that result
historical. No proposal is automatically applied.

The module worker simulates an eight-qubit, two-layer QAOA state vector locally.
Each asset uses two bits: (long,short) = 00 flat, 10 long, 01 short; 11 is invalid.
Displayed strings place q0 on the left. Previous four angles warm-start the next
48-evaluation retune; training uses exact CPU expectation values. Then 1,024
seeded pseudorandom shots sample the optimized distribution. The proposal is
only the lowest-cost feasible portfolio that actually appeared in those shots.
If none does, hold: the exact optimizer is never substituted. A separate
exhaustive enumeration of 81 portfolios reports the true cost optimum, sampled
gap, feasible frequency and optimal sampling frequency under the same snapshot.
Eight qubits and CPU simulation establish no quantum speedup.

The dimensionless objective combines mean squared belief mismatch, joint
covariance risk (0.25 × wᵀΣw / 0.01), turnover friction (10 × changed exposure ×
fee/half-spread/slippage), and signed 24-hour funding cost. Invalid encodings get
a fixed uniform-bound penalty, unchanged by belief-only edits. Such edits only
change the affected asset’s individual Ising Z fields/RZ gates; pairwise risk
couplings remain unchanged. The page immediately shows changed coefficients and
cost terms with other frozen inputs held fixed. Results show updated angles,
actual sampled combinations, resources and separate CPU timings. Comparisons of
old and new proposals use the same updated objective.

Σ is an explicit modeled daily prior B Bᵀ + diagonal idiosyncratic variance,
displayed in the page and exported. It is not an estimate of observed market
correlations. The default model fee is 5 bp; live bid/ask spread and a 1 bp
slippage estimate inform optimization. This is a research template, not a
backtested strategy or realized quantum-advantage result.

Paper accounts start at 10,000 USDC and separate collateral balance, quantities,
entries, realized/unrealized P&L and cumulative fees. Reviewing either the sampled
QAOA candidate or the explicitly labelled exact classical reference opens a
confirmation panel. Confirmation rechecks fresh books and consumes ask depth for
buys or bid depth for sells, charging modeled fees on full turnover. Quantities
round down to verified lot precision and fit 20% slots using post-cost equity,
80% gross and conservative 1× initial margin. Full joint fills are atomic; stale
inputs, insufficient visible liquidity, or a 50 bp distance-from-mid execution
breach hold positions. A quote older than 60 seconds or a 50 bp notional change
requires review again. Zero fills are a valid no-change outcome with no fees or
ledger revision. Funding is estimated in the objective; this initial paper
ledger **does not settle funding**, so displayed P&L excludes funding.

Frozen exports include inputs, sampled results, independently checked objective,
and a QIS circuit. Upload `snapshot.json` and `qollab/main.py` into the same
**Python / Qiskit** Qollab project. Qollab supplies `backend`; the script validates
the artifact, calls `backend.run` exactly once, measures the circuit and reports
the best feasible actually returned portfolio against the classical reference.
The repeated optimizer stays in the local browser simulator. A Qollab/IonQ
backend evaluation is a separately frozen one-off; it never follows new swipes
or trains through repeated hardware jobs. No live Qollab/IonQ evaluation has
been verified without a configured project/backend. See `qollab/README.txt`.

Tests verify convex risk input validation, QUBO/finance equivalence for all 81
choices, fixed invalid penalties and belief-only coupling invariance, normalized
complex QAOA amplitudes, independent circuit equivalence, warm-start budgets,
shot-only selection, reversals/fees/lot precision and atomic guarded paper fills.
Browser QA verifies ten-swipe cadence, skip/undo, multi-asset selection, frozen
results, manual confirmation, historical blocking, persistence, accessibility
and mobile layouts. No tests submit hardware jobs or exchange orders.
