"""Frozen, one-off Qollab evaluation of QSwipe's joint portfolio circuit.

Qollab supplies a pre-created Qiskit-compatible ``backend``. Upload the
exported snapshot.json beside this file and press Run once. This file has
exactly one backend.run call: no training loop, API credentials, or direct
provider/network requests. A provider simulator is not a hardware result.
"""
import itertools
import json
import math
import time
import sys
import random
from pathlib import Path

from qiskit import QuantumCircuit, transpile

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


def main(provided_backend, artifact=None, output_name="qollab_result.json", execution_mode="qollab-provided-backend"):
    if provided_backend is None:
        raise RuntimeError("Qollab must supply the pre-created Qiskit backend named 'backend'; this file does not create or authenticate one")
    folder = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()
    path = folder / "snapshot.json"
    if artifact is None:
        if not path.is_file():
            raise FileNotFoundError("Upload the frozen QSwipe export as snapshot.json beside main.py before pressing Run")
        artifact = json.loads(path.read_text(encoding="utf-8"))
    snapshot, objective, shots = validate_artifact(artifact)
    circuit = construct_circuit(artifact)
    classical_started = time.perf_counter()
    exact = classical_reference(snapshot)
    reference_seconds = time.perf_counter() - classical_started
    compile_started = time.perf_counter()
    compiled = transpile(circuit, provided_backend, optimization_level=0)
    compile_seconds = time.perf_counter() - compile_started
    observed_started = time.perf_counter()
    # EXACTLY ONE submission. No retuning, retry, second run, or remote API call.
    job = provided_backend.run(compiled, shots=shots)
    result = job.result()
    observed_seconds = time.perf_counter() - observed_started
    counts = normalized_counts(result.get_counts(0))
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
                            "compiledDepth": compiled.depth(), "backendSubmissions": 1},
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
    output = folder / output_name
    output.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    print(f"Experiment record written to {output.name}")
    return report


if __name__ == "__main__":
    provided = globals().get("backend")
    if "--local" in sys.argv and provided is None:
        from qiskit_aer import AerSimulator
        provided = AerSimulator(seed_simulator=731)
        print("LOCAL AER SIMULATOR · not a QPU or remote provider job")
    main(provided, execution_mode="local-aer-simulator" if "--local" in sys.argv else "qollab-provided-backend")
