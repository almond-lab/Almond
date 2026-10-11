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

Qollab circuit execution is a future integration: this template does not submit
quantum jobs or require API credentials. It links to Qollab's hackathon page.

Methodology references:

- [IonQ application benchmarking](https://www.ionq.com/quantum-benchmarks)
- [IBM Quantum: Grover's algorithm](https://quantum.cloud.ibm.com/learning/en/courses/fundamentals-of-quantum-algorithms/grover-algorithm/introduction)

Deploy to Vercel using the checked-in `vercel.json`. The site is static and runs
without a backend. User-supplied font and logo assets are included for this
project; no additional asset license is granted by this repository.
