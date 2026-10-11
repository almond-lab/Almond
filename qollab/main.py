# NOTE: 'backend' is pre-created as a global variable by Qollab.

"""Frozen, one-off Qollab evaluation of QSwipe's joint portfolio circuit.

Qollab supplies a pre-created Qiskit-compatible ``backend``. Paste this whole
file and press Run. Optionally upload snapshot.json to override the embedded
synthetic teaching snapshot with a frozen website export. This file has
exactly one backend.run call: no training loop, API credentials, or direct
provider/network requests. A provider simulator is not a hardware result.
"""
import itertools
import json
import math
import time
import random
from pathlib import Path

from qiskit import QuantumCircuit, transpile
from qiskit.providers.jobstatus import JobStatus

COINS = ("BTC", "xyz:SP500", "xyz:BRENTOIL", "xyz:GOLD")
EPS = 1e-10
SCHEMA = "almond.joint-portfolio.snapshot.v1"


def finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    return float(value)


def choices_for(state):
    """Integer bit q is 2**q. Each asset uses (long, short); 11 is invalid."""
    choices = []
    for asset in range(4):
        pair = (state >> (2 * asset)) & 3
        if pair == 3:
            return None
        choices.append(1 if pair == 1 else -1 if pair == 2 else 0)
    return choices


def state_for(choices):
    return sum((1 if choice == 1 else 2 if choice == -1 else 0) << (2 * i)
               for i, choice in enumerate(choices))


def displayed_bits(state):
    """Reverse Qiskit's MSB-first display so q0 is the leftmost displayed bit."""
    return format(state, "08b")[::-1]


def finance(snapshot, choices):
    """Independent financial objective, not a lookup of the sampled QUBO cost."""
    settings = snapshot["settings"]
    weights = [choice * settings["slot"] for choice in choices]
    old_weights = [quantity * price / snapshot["equity"]
                   for quantity, price in zip(snapshot["holdings"], snapshot["prices"])]
    rates = snapshot["executionRates"]
    turnover_fraction = sum(
        abs(weight - old) * (rate["feeRate"] + rate["spreadBps"] / 20000
                             + rate["slippageBps"] / 10000)
        for weight, old, rate in zip(weights, old_weights, rates)
    )
    funding_fraction = sum(weight * rate * settings["horizonHours"]
                           for weight, rate in zip(weights, snapshot["fundingRates"]))
    variance = sum(weights[i] * snapshot["covariance"][i][j] * weights[j]
                   for i in range(4) for j in range(4))
    variance = max(0.0, variance * settings["horizonHours"] / 24)
    belief = settings["beliefWeight"] * sum(
        (choice - conviction) ** 2
        for choice, conviction in zip(choices, snapshot["convictions"])
    ) / 4
    risk = settings["riskWeight"] * variance / settings["riskNormalization"]
    turnover = settings["turnoverWeight"] * turnover_fraction / settings["moneyNormalization"]
    funding = settings["fundingWeight"] * funding_fraction / settings["moneyNormalization"]
    return {
        "beliefMismatch": belief, "jointRisk": risk, "turnoverCost": turnover,
        "funding": funding, "invalidEncoding": 0, "total": belief + risk + turnover + funding,
        "weights": weights, "gross": sum(abs(weight) for weight in weights),
        "turnoverDollars": turnover_fraction * snapshot["equity"],
        "fundingDollars": funding_fraction * snapshot["equity"],
        "portfolioVariance": variance, "portfolioVolatility": math.sqrt(variance),
    }


def qubo_cost(objective, state):
    total = objective["offset"]
    total += sum(coefficient for bit, coefficient in enumerate(objective["linear"])
                 if state & (1 << bit))
    total += sum(pair["coefficient"] for pair in objective["pairs"]
                 if state & (1 << pair["i"]) and state & (1 << pair["j"]))
    return total


def validate_artifact(artifact):
    if artifact.get("schema") != SCHEMA:
        raise ValueError(f"Expected the exported {SCHEMA} schema")
    snapshot, objective = artifact["snapshot"], artifact["objective"]
    settings = snapshot["settings"]
    if "moneyNormalization" not in settings or "minimumImprovement" not in settings:
        raise ValueError("This export uses older normalization. Export a fresh QSwipe snapshot or use the included teaching snapshot.")
    for key in ("prices", "holdings", "convictions", "fundingRates"):
        if len(snapshot[key]) != 4:
            raise ValueError(f"{key} requires four entries in COINS order")
        snapshot[key] = [finite(value, f"{key}[{i}]") for i, value in enumerate(snapshot[key])]
    snapshot["equity"] = finite(snapshot["equity"], "equity")
    if snapshot["equity"] <= 0 or any(price <= 0 for price in snapshot["prices"]):
        raise ValueError("Equity and all reference prices must be positive")
    if any(abs(score) > 1 for score in snapshot["convictions"]):
        raise ValueError("Convictions must be bounded in [-1,1]")
    for key in ("slot", "grossLimit", "horizonHours", "beliefWeight", "riskWeight",
                "turnoverWeight", "fundingWeight", "riskNormalization", "moneyNormalization", "minimumImprovement"):
        settings[key] = finite(settings[key], key)
    if not 0 < settings["slot"] <= .2 or not 0 < settings["grossLimit"] <= .8:
        raise ValueError("Slot / gross limit must remain within the 20% / 80% model limits")
    if settings["horizonHours"] <= 0 or settings["riskNormalization"] <= 0 or settings["moneyNormalization"] <= 0:
        raise ValueError("Horizon and normalization scales must be positive")
    if settings["minimumImprovement"] < 0:
        raise ValueError("Minimum improvement cannot be negative")
    if any(settings[key] < 0 for key in ("beliefWeight", "riskWeight", "turnoverWeight", "fundingWeight")):
        raise ValueError("Objective weights cannot be negative")
    if len(snapshot["executionRates"]) != 4:
        raise ValueError("Four per-asset execution rate estimates are required")
    for rate in snapshot["executionRates"]:
        for key in ("feeRate", "spreadBps", "slippageBps"):
            rate[key] = finite(rate[key], key)
            if rate[key] < 0:
                raise ValueError("Execution rates cannot be negative")
    covariance = snapshot["covariance"]
    if len(covariance) != 4 or any(len(row) != 4 for row in covariance):
        raise ValueError("Covariance must be a symmetric 4x4 PSD modeled prior")
    for i in range(4):
        for j in range(4):
            covariance[i][j] = finite(covariance[i][j], "covariance")
            if abs(covariance[i][j] - covariance[j][i]) > 1e-10:
                raise ValueError("Covariance must be symmetric")
    lower = [[0.0] * 4 for _ in range(4)]
    for i in range(4):
        for j in range(i + 1):
            residual = covariance[i][j] - sum(lower[i][k] * lower[j][k] for k in range(j))
            if i == j:
                if residual < -1e-12:
                    raise ValueError("Covariance must be positive semidefinite")
                lower[i][j] = math.sqrt(max(0.0, residual))
            elif lower[j][j] > 1e-12:
                lower[i][j] = residual / lower[j][j]
            elif abs(residual) > 1e-12:
                raise ValueError("Covariance must be positive semidefinite")
    objective["offset"] = finite(objective["offset"], "QUBO offset")
    objective["invalidPenalty"] = finite(objective["invalidPenalty"], "invalid penalty")
    if len(objective["linear"]) != 8 or len(objective["pairs"]) != 28:
        raise ValueError("Expected eight linear fields and 28 unique pair couplings")
    objective["linear"] = [finite(value, "linear coefficient") for value in objective["linear"]]
    seen = set()
    for pair in objective["pairs"]:
        i, j = pair["i"], pair["j"]
        if not isinstance(i, int) or not isinstance(j, int) or not 0 <= i < j < 8 or (i, j) in seen:
            raise ValueError("QUBO pairs must be unique ordered qubit pairs")
        seen.add((i, j))
        pair["coefficient"] = finite(pair["coefficient"], "pair coefficient")
    # Validate the exported QUBO against an independent finance implementation
    # for all 256 states, including the explicit invalid-11 penalty.
    if not math.isclose(objective["invalidPenalty"], settings.get("invalidPenalty", .5), rel_tol=0, abs_tol=1e-12) or objective["invalidPenalty"] <= 0:
        raise ValueError("Fixed positive invalid penalty must match the frozen settings")
    for state in range(256):
        raw_choices = [((state >> (2 * i)) & 1) - ((state >> (2 * i + 1)) & 1)
                       for i in range(4)]
        base = finance(snapshot, raw_choices)["total"]
        invalid_count = sum(((state >> (2 * i)) & 3) == 3 for i in range(4))
        expected = base + invalid_count * objective["invalidPenalty"]
        actual = qubo_cost(objective, state)
        if not math.isfinite(actual) or not math.isclose(expected, actual, rel_tol=1e-10, abs_tol=1e-9):
            raise ValueError(f"Exported QUBO disagrees with the frozen financial objective at state {state}")
        if invalid_count:
            repaired = state
            for asset in range(4):
                if ((state >> (2 * asset)) & 3) == 3:
                    repaired &= ~(3 << (2 * asset))
            if not math.isclose(actual - qubo_cost(objective, repaired), invalid_count * objective["invalidPenalty"], rel_tol=1e-10, abs_tol=1e-9):
                raise ValueError("Repairing 11 to 00 must preserve finances and remove the fixed penalty")
    shots = settings.get("localShots", 1024)
    if not isinstance(shots, int) or isinstance(shots, bool) or not 1 <= shots <= 4096:
        raise ValueError("Requested shots must be an integer from 1 to 4096")
    return snapshot, objective, shots


def expected_gates(artifact):
    objective = artifact["objective"]
    angles = artifact["result"]["angles"]
    layers = artifact["snapshot"]["settings"]["layers"]
    if layers not in (1, 2) or len(angles) != 2 * layers:
        raise ValueError("Expected one or two frozen gamma/beta layers")
    angles = [finite(angle, "angle in radians") for angle in angles]
    fields = [-coefficient / 2 for coefficient in objective["linear"]]
    for pair in objective["pairs"]:
        fields[pair["i"]] -= pair["coefficient"] / 4
        fields[pair["j"]] -= pair["coefficient"] / 4
    gates = [{"gate": "h", "target": qubit} for qubit in range(8)]
    for layer in range(layers):
        gamma, beta = angles[2 * layer:2 * layer + 2]
        for target, field in enumerate(fields):
            if abs(field) > 1e-12:
                gates.append({"gate": "rz", "target": target, "rotation": 2 * gamma * field})
        for pair in objective["pairs"]:
            if abs(pair["coefficient"]) > 1e-12:
                controlled = {"gate": "cnot", "control": pair["i"], "target": pair["j"]}
                gates.extend([controlled.copy(), {"gate": "rz", "target": pair["j"],
                                                  "rotation": gamma * pair["coefficient"] / 2}, controlled.copy()])
        gates.extend({"gate": "rx", "target": target, "rotation": 2 * beta} for target in range(8))
    return gates


def construct_circuit(artifact):
    exported = artifact["circuit"]
    if exported.get("qubits") != 8 or exported.get("gateset") != "qis":
        raise ValueError("The exported circuit must be an eight-qubit QIS circuit")
    gates, expected = exported["circuit"], expected_gates(artifact)
    if len(gates) != len(expected):
        raise ValueError("Exported circuit does not match the frozen QUBO and angles")
    for supplied, required in zip(gates, expected):
        for key, value in required.items():
            if key == "rotation":
                if not math.isclose(finite(supplied.get(key), "rotation"), value, rel_tol=1e-11, abs_tol=1e-11):
                    raise ValueError("Circuit rotations do not match the frozen radians")
            elif supplied.get(key) != value:
                raise ValueError("Exported circuit does not match the frozen QUBO and angles")
        if set(supplied) != set(required):
            raise ValueError("Unsupported extra fields in the exported gate")
    circuit = QuantumCircuit(8, 8, name="QSwipe frozen joint portfolio")
    for gate in gates:
        if gate["gate"] == "h":
            circuit.h(gate["target"])
        elif gate["gate"] == "rz":
            circuit.rz(gate["rotation"], gate["target"])
        elif gate["gate"] == "rx":
            circuit.rx(gate["rotation"], gate["target"])
        elif gate["gate"] == "cnot":
            circuit.cx(gate["control"], gate["target"])
    circuit.measure(range(8), range(8))
    return circuit


def classical_reference(snapshot):
    """Exhaustive 3**4 finance evaluation, independent of the sampled circuit."""
    best = None
    for choices in itertools.product((0, 1, -1), repeat=4):
        breakdown = finance(snapshot, choices)
        if breakdown["gross"] > snapshot["settings"]["grossLimit"] + EPS:
            continue
        candidate = {"state": state_for(choices), "choices": list(choices),
                     "cost": breakdown["total"], "breakdown": breakdown}
        if best is None or candidate["cost"] < best["cost"] - EPS or (
                abs(candidate["cost"] - best["cost"]) <= EPS and candidate["state"] < best["state"]):
            best = candidate
    return best


def normalized_counts(counts):
    result = {}
    for label, count in counts.items():
        if not isinstance(count, (int, float)) or isinstance(count, bool) or count < 0 or int(count) != count:
            raise ValueError("Backend must return nonnegative integer shot counts")
        compact = str(label).replace(" ", "")
        # Qiskit displays the highest-index classical bit first. Parsing that
        # string as an integer gives q0 at bit zero, then display is reversed.
        state = int(compact, 16) if compact.startswith("0x") else int(compact, 2)
        if not 0 <= state < 256:
            raise ValueError("Returned count has more than eight measured bits")
        result[state] = result.get(state, 0) + int(count)
    return result


def evaluate_counts(snapshot, objective, counts, exact):
    shots = sum(counts.values())
    selected, valid_samples, feasible_samples, optimal_samples, distribution = None, 0, 0, 0, []
    for state in sorted(counts):
        count = counts[state]
        if count == 0:
            continue
        choices = choices_for(state)
        breakdown = finance(snapshot, choices) if choices is not None else None
        feasible = choices is not None and breakdown["gross"] <= snapshot["settings"]["grossLimit"] + EPS
        cost = qubo_cost(objective, state)
        distribution.append({"state": state, "bitstringQ0First": displayed_bits(state), "choices": choices,
                             "count": count, "frequency": count / shots if shots else 0,
                             "cost": cost, "feasible": feasible})
        if choices is not None:
            valid_samples += count
        if not feasible:
            continue
        feasible_samples += count
        if abs(cost - exact["cost"]) <= EPS:
            optimal_samples += count
        if selected is None or cost < selected["cost"] - EPS or (
                abs(cost - selected["cost"]) <= EPS and state < selected["state"]):
            selected = {"state": state, "bitstringQ0First": displayed_bits(state), "choices": choices,
                        "cost": cost, "count": count, "breakdown": breakdown}
    return {"selected": selected, "exact": exact, "distribution": distribution,
            "gap": max(0, selected["cost"] - exact["cost"]) if selected else None,
            "metrics": {"returnedShots": shots, "validSamples": valid_samples,
                        "validityRate": valid_samples / shots if shots else 0, "feasibleSamples": feasible_samples,
                        "feasibleRate": feasible_samples / shots if shots else 0,
                        "optimalFrequency": optimal_samples / shots if shots else 0},
            "holdReason": None if selected else "No feasible returned candidate. Hold current quantities; no exact fallback."}


def evaluate_held(snapshot):
    weights = [q * price / snapshot["equity"] for q, price in zip(snapshot["holdings"], snapshot["prices"])]
    normalized = [weight / snapshot["settings"]["slot"] for weight in weights]
    breakdown = finance(snapshot, normalized)
    return {"cost": breakdown["total"], "breakdown": breakdown, "weights": weights,
            "offGrid": any(min(abs(value-grid) for grid in (-1, 0, 1)) > EPS for value in normalized)}


def random_baselines(snapshot, objective, exact, shots, seed=731):
    valid = [state for state in range(256) if choices_for(state) is not None]
    outcomes = {}
    for name, pool in (("rawBits", list(range(256))), ("validPortfolios", valid)):
        rng, counts = random.Random(f"{seed}:{name}"), {}
        for _ in range(shots):
            state = rng.choice(pool)
            counts[state] = counts.get(state, 0) + 1
        outcomes[name] = {"name": "Uniform raw 256 bitstrings" if name == "rawBits" else "Uniform valid 81 portfolios",
                          "expectedValidityRate": 81/256 if name == "rawBits" else 1,
                          **evaluate_counts(snapshot, objective, counts, exact)}
    return outcomes


def report_portfolio(artifact, circuit, counts, shots, compile_seconds=0.0, observed_seconds=0.0,
                     output_name="qollab_result.json", execution_mode="qollab-provided-backend"):
    snapshot, objective, _ = validate_artifact(artifact)
    classical_started = time.perf_counter()
    exact = classical_reference(snapshot)
    reference_seconds = time.perf_counter() - classical_started
    outcome = evaluate_counts(snapshot, objective, counts, exact)
    held = evaluate_held(snapshot)
    improvement = held["cost"]-outcome["selected"]["cost"] if outcome["selected"] else None
    minimum = snapshot["settings"]["minimumImprovement"]
    hold_comparison = {"heldCost": held["cost"], "candidateCost": outcome["selected"]["cost"] if outcome["selected"] else None,
                       "improvement": improvement, "minimumImprovement": minimum,
                       "eligible": improvement is not None and improvement >= minimum, "held": held}
    baselines = random_baselines(snapshot, objective, exact, outcome["metrics"]["returnedShots"])
    report = {"schema": "almond.joint-portfolio.qollab-result.v1", "snapshotId": snapshot["id"],
              "snapshotVersion": snapshot["version"], "executionMode": execution_mode,
              "syntheticInputs": bool(snapshot.get("synthetic", False)), "historicalAtExport": artifact.get("historical", False),
              "coins": list(COINS), "bitOrder": "q0 leftmost; each pair long,short; 11 invalid",
              "requestedShots": shots, "timing": {"compilationSeconds": compile_seconds,
                    "observedSubmissionAndResultSeconds": observed_seconds,
                    "classicalReferenceSeconds": reference_seconds},
              "resources": {"qubits": 8, "submittedGateCountExcludingMeasurement": len(artifact["circuit"]["circuit"]),
                            "submittedDepth": circuit.depth(),
                            "compilationApplied": compile_seconds > 0, "backendSubmissions": 1},
              **outcome, "holdComparison": hold_comparison, "randomBaselines": baselines,
              "methodology": "Frozen modeled objective; backend-produced samples. Backend may be a simulator or hardware. No quantum speedup or trading-performance claim."}
    print(f"QSWIPE / FROZEN QOLLAB RUN · snapshot {snapshot['id']} · v{snapshot['version']}")
    print("Exactly one backend submission. No local retuning or automatic trading.")
    print("Bit display: q0 first, (long, short) pairs in BTC / S&P 500 / Brent / Gold order; 11 invalid.")
    print(f"Returned / requested shots: {outcome['metrics']['returnedShots']} / {shots}")
    print(f"Valid encoding rate: {outcome['metrics']['validityRate']:.4%}")
    print(f"Feasible sample rate: {outcome['metrics']['feasibleRate']:.4%}")
    print(f"Exact-optimal returned frequency: {outcome['metrics']['optimalFrequency']:.4%}")
    if outcome["selected"]:
        selected = outcome["selected"]
        print(f"Best actually returned portfolio: {dict(zip(COINS, selected['choices']))}")
        print(f"Q0-first bits: {selected['bitstringQ0First']} · returned count {selected['count']}")
        print(f"Sampled objective: {selected['cost']:.10f}; independent 81-portfolio reference: {exact['cost']:.10f}")
        print(f"Observed objective gap: {outcome['gap']:.10f} (dimensionless; not a speedup)")
    else:
        print(outcome["holdReason"])
        print(f"Classical reference remains separate: {exact['cost']:.10f}")
    print(f"Current marked Hold objective: {held['cost']:.10f}; minimum improvement: {minimum:.6f}")
    print(f"Eligible versus Hold: {hold_comparison['eligible']} (no automatic trade is applied)")
    for name, baseline in baselines.items():
        print(f"Random baseline {name}: {baseline['metrics']['returnedShots']} draws; validity {baseline['metrics']['validityRate']:.4%}; feasibility {baseline['metrics']['feasibleRate']:.4%}; gap {baseline['gap']}")
    print(f"Compilation: {compile_seconds:.4f}s; observed submission/result: {observed_seconds:.4f}s; classical reference: {reference_seconds:.6f}s")
    print("Covariance, friction and funding are frozen estimates. Observed elapsed includes the backend job lifecycle; backend type is determined by Qollab.")
    payload = json.dumps(report, indent=2, allow_nan=False)
    # Pyodide files are temporary; sendFile exposes the result in the console.
    try:
        from js import sendFile
    except ImportError:
        Path(output_name).write_text(payload, encoding="utf-8")
        print(f"Experiment record written to {output_name}")
    else:
        sendFile(output_name, "application/json", payload)
        print(f"Experiment record available in the console: {output_name}")
    return report


# A self-contained teaching example makes pasting just this file runnable.
# An uploaded snapshot.json overrides it; these embedded inputs are synthetic.
TEACHING_ARTIFACT_JSON = r'''{"schema":"almond.joint-portfolio.snapshot.v1","project":"QSwipe","mode":"synthetic-teaching-example","historical":false,"snapshot":{"id":"qswipe-synthetic-doc-after-btc","version":1,"createdAt":1791676800000,"synthetic":true,"dataSource":"Hypothetical teaching inputs from attached Preference Aware Portfolio Cost and Quantum Circuit document; prices are illustrative, not exchange quotes","convictions":[0.8228060541124633,0.8,-0.72,0.67],"prices":[70000,6000,80,3000],"equity":10000,"holdings":[0,0,0,0],"covariance":[[0.0016,0.00018771359999999998,0.00022063,1.455e-05],[0.0001877136,0.000144,9.254100000000002e-05,3.58416e-05],[0.00022063,9.254100000000001e-05,0.0006250000000000001,4.21275e-05],[1.455e-05,3.58416e-05,4.21275e-05,0.000225]],"covarianceLabel":"Synthetic DOCX covariance: daily volatility [4%,1.2%,2.5%,1.5%] with stated teaching correlations","fundingRates":[4.166666666666667e-06,2.0833333333333334e-06,-3.3333333333333337e-06,1.25e-06],"executionRates":[{"feeRate":0.0005,"spreadBps":0,"slippageBps":0,"allIn":true},{"feeRate":0.0003,"spreadBps":0,"slippageBps":0,"allIn":true},{"feeRate":0.0005,"spreadBps":0,"slippageBps":0,"allIn":true},{"feeRate":0.0004,"spreadBps":0,"slippageBps":0,"allIn":true}],"settings":{"slot":0.2,"grossLimit":0.8,"horizonHours":24,"decayHalfLifeHours":24,"evidenceWeight":0.5,"thesisCap":1,"localShots":1024,"layers":2,"evaluationBudget":48,"beliefWeight":1,"riskWeight":0.15,"turnoverWeight":0.5,"fundingWeight":1,"riskNormalization":0.0004,"moneyNormalization":0.001,"invalidPenalty":0.5,"minimumImprovement":0.0001,"feeRate":0.0005,"spreadBps":2,"slippageBps":1}},"result":{"angles":[0.71,0.33,1.12,0.52],"note":"Unoptimized illustrative DOCX angles, not a successful optimization or hardware run"},"bitOrder":"q0 leftmost; each pair long,short in BTC/SP500/Brent/Gold order","objective":{"linear":[-0.06740302705623166,0.7154030270562317,-0.10784000000000003,0.6721600000000001,0.653375,-0.03462499999999999,-0.03562500000000002,0.622375],"pairs":[{"i":0,"j":1,"coefficient":-0.14800000000000013},{"i":0,"j":2,"coefficient":0.005631407999999999},{"i":0,"j":3,"coefficient":-0.005631407999999999},{"i":0,"j":4,"coefficient":0.0066189},{"i":0,"j":5,"coefficient":-0.0066189},{"i":0,"j":6,"coefficient":0.00043649999999999993},{"i":0,"j":7,"coefficient":-0.00043649999999999993},{"i":1,"j":2,"coefficient":-0.005631407999999999},{"i":1,"j":3,"coefficient":0.005631407999999999},{"i":1,"j":4,"coefficient":-0.0066189},{"i":1,"j":5,"coefficient":0.0066189},{"i":1,"j":6,"coefficient":-0.00043649999999999993},{"i":1,"j":7,"coefficient":0.00043649999999999993},{"i":2,"j":3,"coefficient":-0.06432000000000004},{"i":2,"j":4,"coefficient":0.00277623},{"i":2,"j":5,"coefficient":-0.00277623},{"i":2,"j":6,"coefficient":0.0010752479999999998},{"i":2,"j":7,"coefficient":-0.0010752479999999998},{"i":3,"j":4,"coefficient":-0.00277623},{"i":3,"j":5,"coefficient":0.00277623},{"i":3,"j":6,"coefficient":-0.0010752479999999998},{"i":3,"j":7,"coefficient":0.0010752479999999998},{"i":4,"j":5,"coefficient":-0.11875000000000013},{"i":4,"j":6,"coefficient":0.0012638249999999999},{"i":4,"j":7,"coefficient":-0.0012638249999999999},{"i":5,"j":6,"coefficient":-0.0012638249999999999},{"i":5,"j":7,"coefficient":0.0012638249999999999},{"i":6,"j":7,"coefficient":-0.0867500000000001}],"offset":0.5710774506710306,"invalidPenalty":0.5},"circuit":{"format":"ionq.circuit.v0","qubits":8,"gateset":"qis","circuit":[{"gate":"h","target":0},{"gate":"h","target":1},{"gate":"h","target":2},{"gate":"h","target":3},{"gate":"h","target":4},{"gate":"h","target":5},{"gate":"h","target":6},{"gate":"h","target":7},{"gate":"rz","target":0,"rotation":0.10039614920992453},{"gate":"rz","target":1,"rotation":-0.45539614920992444},{"gate":"rz","target":2,"rotation":0.09940000000000004},{"gate":"rz","target":3,"rotation":-0.4544000000000001},{"gate":"rz","target":4,"rotation":-0.42173999999999995},{"gate":"rz","target":5,"rotation":0.06674000000000004},{"gate":"rz","target":6,"rotation":0.05609000000000005},{"gate":"rz","target":7,"rotation":-0.41108999999999996},{"gate":"cnot","control":0,"target":1},{"gate":"rz","target":1,"rotation":-0.052540000000000045},{"gate":"cnot","control":0,"target":1},{"gate":"cnot","control":0,"target":2},{"gate":"rz","target":2,"rotation":0.0019991498399999997},{"gate":"cnot","control":0,"target":2},{"gate":"cnot","control":0,"target":3},{"gate":"rz","target":3,"rotation":-0.0019991498399999997},{"gate":"cnot","control":0,"target":3},{"gate":"cnot","control":0,"target":4},{"gate":"rz","target":4,"rotation":0.0023497095},{"gate":"cnot","control":0,"target":4},{"gate":"cnot","control":0,"target":5},{"gate":"rz","target":5,"rotation":-0.0023497095},{"gate":"cnot","control":0,"target":5},{"gate":"cnot","control":0,"target":6},{"gate":"rz","target":6,"rotation":0.00015495749999999995},{"gate":"cnot","control":0,"target":6},{"gate":"cnot","control":0,"target":7},{"gate":"rz","target":7,"rotation":-0.00015495749999999995},{"gate":"cnot","control":0,"target":7},{"gate":"cnot","control":1,"target":2},{"gate":"rz","target":2,"rotation":-0.0019991498399999997},{"gate":"cnot","control":1,"target":2},{"gate":"cnot","control":1,"target":3},{"gate":"rz","target":3,"rotation":0.0019991498399999997},{"gate":"cnot","control":1,"target":3},{"gate":"cnot","control":1,"target":4},{"gate":"rz","target":4,"rotation":-0.0023497095},{"gate":"cnot","control":1,"target":4},{"gate":"cnot","control":1,"target":5},{"gate":"rz","target":5,"rotation":0.0023497095},{"gate":"cnot","control":1,"target":5},{"gate":"cnot","control":1,"target":6},{"gate":"rz","target":6,"rotation":-0.00015495749999999995},{"gate":"cnot","control":1,"target":6},{"gate":"cnot","control":1,"target":7},{"gate":"rz","target":7,"rotation":0.00015495749999999995},{"gate":"cnot","control":1,"target":7},{"gate":"cnot","control":2,"target":3},{"gate":"rz","target":3,"rotation":-0.022833600000000013},{"gate":"cnot","control":2,"target":3},{"gate":"cnot","control":2,"target":4},{"gate":"rz","target":4,"rotation":0.00098556165},{"gate":"cnot","control":2,"target":4},{"gate":"cnot","control":2,"target":5},{"gate":"rz","target":5,"rotation":-0.00098556165},{"gate":"cnot","control":2,"target":5},{"gate":"cnot","control":2,"target":6},{"gate":"rz","target":6,"rotation":0.0003817130399999999},{"gate":"cnot","control":2,"target":6},{"gate":"cnot","control":2,"target":7},{"gate":"rz","target":7,"rotation":-0.0003817130399999999},{"gate":"cnot","control":2,"target":7},{"gate":"cnot","control":3,"target":4},{"gate":"rz","target":4,"rotation":-0.00098556165},{"gate":"cnot","control":3,"target":4},{"gate":"cnot","control":3,"target":5},{"gate":"rz","target":5,"rotation":0.00098556165},{"gate":"cnot","control":3,"target":5},{"gate":"cnot","control":3,"target":6},{"gate":"rz","target":6,"rotation":-0.0003817130399999999},{"gate":"cnot","control":3,"target":6},{"gate":"cnot","control":3,"target":7},{"gate":"rz","target":7,"rotation":0.0003817130399999999},{"gate":"cnot","control":3,"target":7},{"gate":"cnot","control":4,"target":5},{"gate":"rz","target":5,"rotation":-0.04215625000000005},{"gate":"cnot","control":4,"target":5},{"gate":"cnot","control":4,"target":6},{"gate":"rz","target":6,"rotation":0.00044865787499999996},{"gate":"cnot","control":4,"target":6},{"gate":"cnot","control":4,"target":7},{"gate":"rz","target":7,"rotation":-0.00044865787499999996},{"gate":"cnot","control":4,"target":7},{"gate":"cnot","control":5,"target":6},{"gate":"rz","target":6,"rotation":-0.00044865787499999996},{"gate":"cnot","control":5,"target":6},{"gate":"cnot","control":5,"target":7},{"gate":"rz","target":7,"rotation":0.00044865787499999996},{"gate":"cnot","control":5,"target":7},{"gate":"cnot","control":6,"target":7},{"gate":"rz","target":7,"rotation":-0.030796250000000035},{"gate":"cnot","control":6,"target":7},{"gate":"rx","target":0,"rotation":0.66},{"gate":"rx","target":1,"rotation":0.66},{"gate":"rx","target":2,"rotation":0.66},{"gate":"rx","target":3,"rotation":0.66},{"gate":"rx","target":4,"rotation":0.66},{"gate":"rx","target":5,"rotation":0.66},{"gate":"rx","target":6,"rotation":0.66},{"gate":"rx","target":7,"rotation":0.66},{"gate":"rz","target":0,"rotation":0.15837139030297956},{"gate":"rz","target":1,"rotation":-0.7183713903029795},{"gate":"rz","target":2,"rotation":0.15680000000000008},{"gate":"rz","target":3,"rotation":-0.7168000000000002},{"gate":"rz","target":4,"rotation":-0.66528},{"gate":"rz","target":5,"rotation":0.10528000000000007},{"gate":"rz","target":6,"rotation":0.08848000000000009},{"gate":"rz","target":7,"rotation":-0.6484800000000001},{"gate":"cnot","control":0,"target":1},{"gate":"rz","target":1,"rotation":-0.08288000000000008},{"gate":"cnot","control":0,"target":1},{"gate":"cnot","control":0,"target":2},{"gate":"rz","target":2,"rotation":0.00315358848},{"gate":"cnot","control":0,"target":2},{"gate":"cnot","control":0,"target":3},{"gate":"rz","target":3,"rotation":-0.00315358848},{"gate":"cnot","control":0,"target":3},{"gate":"cnot","control":0,"target":4},{"gate":"rz","target":4,"rotation":0.003706584},{"gate":"cnot","control":0,"target":4},{"gate":"cnot","control":0,"target":5},{"gate":"rz","target":5,"rotation":-0.003706584},{"gate":"cnot","control":0,"target":5},{"gate":"cnot","control":0,"target":6},{"gate":"rz","target":6,"rotation":0.00024444},{"gate":"cnot","control":0,"target":6},{"gate":"cnot","control":0,"target":7},{"gate":"rz","target":7,"rotation":-0.00024444},{"gate":"cnot","control":0,"target":7},{"gate":"cnot","control":1,"target":2},{"gate":"rz","target":2,"rotation":-0.00315358848},{"gate":"cnot","control":1,"target":2},{"gate":"cnot","control":1,"target":3},{"gate":"rz","target":3,"rotation":0.00315358848},{"gate":"cnot","control":1,"target":3},{"gate":"cnot","control":1,"target":4},{"gate":"rz","target":4,"rotation":-0.003706584},{"gate":"cnot","control":1,"target":4},{"gate":"cnot","control":1,"target":5},{"gate":"rz","target":5,"rotation":0.003706584},{"gate":"cnot","control":1,"target":5},{"gate":"cnot","control":1,"target":6},{"gate":"rz","target":6,"rotation":-0.00024444},{"gate":"cnot","control":1,"target":6},{"gate":"cnot","control":1,"target":7},{"gate":"rz","target":7,"rotation":0.00024444},{"gate":"cnot","control":1,"target":7},{"gate":"cnot","control":2,"target":3},{"gate":"rz","target":3,"rotation":-0.03601920000000003},{"gate":"cnot","control":2,"target":3},{"gate":"cnot","control":2,"target":4},{"gate":"rz","target":4,"rotation":0.0015546888000000003},{"gate":"cnot","control":2,"target":4},{"gate":"cnot","control":2,"target":5},{"gate":"rz","target":5,"rotation":-0.0015546888000000003},{"gate":"cnot","control":2,"target":5},{"gate":"cnot","control":2,"target":6},{"gate":"rz","target":6,"rotation":0.00060213888},{"gate":"cnot","control":2,"target":6},{"gate":"cnot","control":2,"target":7},{"gate":"rz","target":7,"rotation":-0.00060213888},{"gate":"cnot","control":2,"target":7},{"gate":"cnot","control":3,"target":4},{"gate":"rz","target":4,"rotation":-0.0015546888000000003},{"gate":"cnot","control":3,"target":4},{"gate":"cnot","control":3,"target":5},{"gate":"rz","target":5,"rotation":0.0015546888000000003},{"gate":"cnot","control":3,"target":5},{"gate":"cnot","control":3,"target":6},{"gate":"rz","target":6,"rotation":-0.00060213888},{"gate":"cnot","control":3,"target":6},{"gate":"cnot","control":3,"target":7},{"gate":"rz","target":7,"rotation":0.00060213888},{"gate":"cnot","control":3,"target":7},{"gate":"cnot","control":4,"target":5},{"gate":"rz","target":5,"rotation":-0.06650000000000009},{"gate":"cnot","control":4,"target":5},{"gate":"cnot","control":4,"target":6},{"gate":"rz","target":6,"rotation":0.000707742},{"gate":"cnot","control":4,"target":6},{"gate":"cnot","control":4,"target":7},{"gate":"rz","target":7,"rotation":-0.000707742},{"gate":"cnot","control":4,"target":7},{"gate":"cnot","control":5,"target":6},{"gate":"rz","target":6,"rotation":-0.000707742},{"gate":"cnot","control":5,"target":6},{"gate":"cnot","control":5,"target":7},{"gate":"rz","target":7,"rotation":0.000707742},{"gate":"cnot","control":5,"target":7},{"gate":"cnot","control":6,"target":7},{"gate":"rz","target":7,"rotation":-0.04858000000000006},{"gate":"cnot","control":6,"target":7},{"gate":"rx","target":0,"rotation":1.04},{"gate":"rx","target":1,"rotation":1.04},{"gate":"rx","target":2,"rotation":1.04},{"gate":"rx","target":3,"rotation":1.04},{"gate":"rx","target":4,"rotation":1.04},{"gate":"rx","target":5,"rotation":1.04},{"gate":"rx","target":6,"rotation":1.04},{"gate":"rx","target":7,"rotation":1.04}]},"note":"Entirely synthetic teaching data; no browser export or credentials needed for the local demo. Schema prefix preserved for compatibility."}'''

# NOTE: 'backend' is pre-created as a global variable by Qollab.
# Prepare and display the circuit at the top level, as in Qollab's examples.
if Path("snapshot.json").is_file():
    artifact = json.loads(Path("snapshot.json").read_text(encoding="utf-8"))
    print("Using uploaded frozen snapshot.json")
else:
    artifact = json.loads(TEACHING_ARTIFACT_JSON)
    print("Using embedded synthetic teaching snapshot; no extra file is required")
validate_artifact(artifact)
circuit = construct_circuit(artifact)
print(circuit)


def main(shots: int = 1024, excludeLowProbabilityValues: bool = False, lowProbabilityThreshold: float = 0.05, compileForBackend: bool = False):
    # Qollab calls this automatically. Never add main() at the bottom.
    if isinstance(shots, bool) or not isinstance(shots, int) or not 1 <= shots <= 4096:
        raise ValueError("Shots must be an integer from 1 to 4096")
    if not math.isfinite(lowProbabilityThreshold) or not 0 <= lowProbabilityThreshold <= 1:
        raise ValueError("Low probability threshold must be between 0 and 1")
    if "backend" not in globals() or backend is None:
        print("Qollab must supply the pre-created backend; select a backend in the Run dialog")
        return

    submitted = circuit
    compile_seconds = 0.0
    if compileForBackend:
        # Needed for IBM noise-model backends; standard gates can be submitted
        # directly to Qollab's built-in simulator and IonQ, matching the examples.
        started = time.perf_counter()
        try:
            submitted = transpile(circuit, backend, optimization_level=0)
        except Exception as error:
            print(f"Circuit compilation failed: {error}")
            return
        compile_seconds = time.perf_counter() - started

    started = time.perf_counter()
    try:
        # Exactly one submission. No retry or replacement backend.
        job = backend.run(submitted, shots=shots)
    except AttributeError as error:
        print(f"Provider SDK AttributeError during submission: {error}")
        print("Check Qollab's backend status and error output; no job is retried.")
        return
    except Exception as error:
        print(f"Job submission failed: {error}")
        return

    try:
        # Same status-polling pattern as the supplied Qollab example, with
        # explicit terminal failure handling so a failed job does not hang.
        while True:
            status = job.status()
            print(f"Job status is {status}")
            name = getattr(status, "name", str(status)).upper().split(".")[-1]
            if status == JobStatus.DONE or name == "DONE":
                break
            if status in (JobStatus.ERROR, JobStatus.CANCELLED) or name in ("ERROR", "FAILED", "CANCELLED", "CANCELED"):
                print("Job ended without a result. No portfolio is proposed and no retry is submitted.")
                return
            time.sleep(10)

        # Some Qollab examples expose counts on the job. Standard Qiskit jobs
        # expose them on job.result(); support both without submitting again.
        if callable(getattr(job, "get_counts", None)):
            returned_counts = job.get_counts()
        else:
            returned_counts = job.result().get_counts()
        counts = normalized_counts(returned_counts)
    except Exception as error:
        print(f"Job status/result retrieval failed: {error}")
        return

    report = report_portfolio(artifact, submitted, counts, shots, compile_seconds,
                              time.perf_counter() - started)
    # Filtering affects the printed preview only. Every returned shot remains
    # in the scientific comparison, including rare low-cost portfolios.
    preview = {format(state, "08b"): count for state, count in counts.items()}
    if excludeLowProbabilityValues:
        cutoff = sum(counts.values()) * lowProbabilityThreshold
        preview = {bits: count for bits, count in preview.items() if count > cutoff}
    print(f"Counts preview (Qiskit q7..q0 order): {preview}")
    return report

# Qollab invokes main() automatically. There is intentionally no call here.
