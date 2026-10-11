# QSwipe · JS / Qiskit visual portfolio runner

Choose JS / Qiskit, then upload and unpack qswipe-qollab-js.zip. Keep index.html, main.js, main.css, portfolio.py, requirements.txt and snapshot.json at the project root (move them out of any archive folder). Do not paste main.js into the Python editor. Press Run and choose Built-in simulator first. The page automatically executes one 1,024-shot frozen circuit and renders the joint portfolio, exact classical optimum, gap, feasibility and sampled distribution. The complete JSON result is exposed in Qollab's console via sendFile.

main.js imports the Python portfolio module with a named namespace import and calls run_portfolio.callPromising(backend, 1024). This is Qollab's documented asynchronous bridge; a plain synchronous Python call fails for IonQ. Python uses the injected backend, never constructs a provider, and submits exactly once per Run. There is no automatic retry or second submission. Change the shots literal to an integer from 1 to 4096 if needed.

snapshot.json is a frozen synthetic teaching example with untrained circuit angles. Replace it with your exported QSwipe frozen snapshot to evaluate your own joint objective and angles. Python reads this literal filename because JS fetch cannot read Qollab project files. If omitted, portfolio.py has an embedded teaching example. The report selects only feasible combinations actually sampled, enumerates all 81 classical choices independently, preserves rare samples, and compares against current Hold. No order is applied. Backend simulation is not hardware evidence or proof of quantum speedup.

This starter uses standard Qiskit gates directly, suitable for the built-in simulator and the documented IonQ pattern. IBM noise-model backends may need explicit transpilation; this starter does not enable it. No Aer, API token or optional library is needed. Run on IonQ only as a separate frozen one-off evaluation; remote execution has not been verified by us.

## Can Vercel call this project as an API?

The JS option provides an interactive visual output, not a hosted HTTP service. Qollab says JS runs entirely in a sandboxed browser iframe. Network reads permit GET (plus OPTIONS); POST/PUT/DELETE, WebSockets, XHR and web workers are blocked. Cross-origin GET requires CORS, preferably Access-Control-Allow-Origin: *, because the frame has origin null and sends no site credentials. No persistent browser storage exists. Publishing does not document an externally callable execution endpoint.

An open Qollab session could read a public frozen snapshot from a Vercel GET endpoint once one is implemented. This starter currently reads the uploaded file; it does not implement a Vercel connection or send results back over the network. Use console JSON export for now. For fully automatic live production execution, use a separate authenticated quantum worker behind Vercel; direct IonQ access needs separate provider credentials. Never embed tokens in published project source.

Sources checked: https://qollab.xyz/learn/docs/js-qiskit-projects and https://qollab.xyz/learn/docs/runtime-environment

Verified in Qollab’s actual JS/Pyodide browser runtime using locally substituted files: built-in simulator completed 1,024 shots and the custom HTML rendered all four positions, objective gap, feasibility and distribution. No public Qollab project was modified. Remote IonQ execution remains unverified.
