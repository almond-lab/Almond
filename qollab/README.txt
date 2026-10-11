ALMOND — ONE FROZEN QOLLAB EVALUATION

1. In Market Pulse, run the local joint portfolio optimization and choose
   Export frozen Qollab snapshot. Keep the filename snapshot.json.
2. Upload snapshot.json and this main.py into the same Qollab project folder.
3. Use Qollab's pre-created Qiskit-compatible variable named backend.
   The script intentionally does not create a backend or request API keys.
4. Press Run once. The script validates the frozen export, constructs the
   eight-qubit circuit with radians, measures it, and calls backend.run once.
5. Inspect stdout and qollab_result.json. The lowest-cost feasible portfolio
   must have appeared in the returned shot counts. Invalid 11 encodings are
   discarded. If nothing feasible was returned, hold the current quantities;
   the independent classical reference is never substituted.

The snapshot schema is almond.joint-portfolio.snapshot.v1. The objective and
circuit must agree; editing one without the other fails before submission.
The script independently validates the objective across all 256 encodings
and enumerates the 81 long/flat/short portfolios for a classical reference.

Bit order: Qiskit displays q7...q0; the report reverses that to q0...q7.
Each pair is (long,short): 00 flat, 10 long, 01 short, 11 invalid.
Pairs follow BTC, xyz:SP500, xyz:BRENTOIL, xyz:GOLD. Exposure slots remain
20% with an 80% gross cap in the default frozen model.

This is a single frozen evaluation, not a live optimizer. Newer swipes do
not change the uploaded file or automatically launch a provider job.
No market orders are sent. Covariance, fees, slippage and funding are
modeled estimates. A simulator run is not a hardware run. Objective gap,
sampled feasibility and optimal-sample frequency are reported without any
quantum speedup or realized trading-performance claim.

Requires Qiskit 2 and the backend made available by Qollab. The script's
backend.run(compiled, shots=...) / job.result().get_counts(0) contract expects
a Qiskit-compatible circuit backend, not a primitive-only Sampler interface.
