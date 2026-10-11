"""QSwipe's reproducible desktop teaching demo: CPU retuning, then one simulator job.

No QPU or remote provider is invoked. The included snapshot is synthetic.
Training uses exact 256-amplitude state vectors, including invalid penalties.
"""
import argparse
import copy
import json
import time
from pathlib import Path

import numpy as np
from qiskit.providers.basic_provider import BasicSimulator
import main as runner


def statevector(costs, angles):
    amplitudes = np.full(256, 1/16, dtype=np.complex128)
    states = np.arange(256)
    for gamma, beta in zip(angles[::2], angles[1::2]):
        amplitudes *= np.exp(-1j * gamma * costs)
        for qubit in range(8):
            zero = states[(states & (1 << qubit)) == 0]
            one = zero | (1 << qubit)
            a, b = amplitudes[zero].copy(), amplitudes[one].copy()
            c, s = np.cos(beta), np.sin(beta)
            amplitudes[zero] = c*a - 1j*s*b
            amplitudes[one] = c*b - 1j*s*a
    probabilities = np.abs(amplitudes)**2
    if not np.isclose(probabilities.sum(), 1, atol=1e-12):
        raise RuntimeError("State-vector normalization failed")
    return float(probabilities @ costs), probabilities


def retune(artifact, seed):
    settings = artifact["snapshot"]["settings"]
    costs = np.array([runner.qubo_cost(artifact["objective"], state) for state in range(256)])
    rng = np.random.default_rng(seed)
    angles = list(artifact["result"]["angles"])
    best, _ = statevector(costs, angles)
    initial, evaluations = best, 1
    started = time.perf_counter()
    while evaluations < settings["evaluationBudget"]:
        proposal = list(angles)
        index = (evaluations-1) % len(angles)
        sweep = (evaluations-1) // (len(angles)*2)
        step = .38 * .8**sweep
        sign = 1 if (evaluations-1) % (len(angles)*2) < len(angles) else -1
        proposal[index] += sign*step
        if evaluations % 9 == 0:
            proposal = list(np.array(proposal) + (rng.random(len(angles))-.5)*.3)
        expected, _ = statevector(costs, proposal)
        evaluations += 1
        if expected < best:
            angles, best = proposal, expected
    return {"angles": [float(x) for x in angles], "expectedCost": best,
            "initialExpectedCost": initial, "evaluations": evaluations,
            "retuneSeconds": time.perf_counter()-started,
            "training": "Exact local NumPy state-vector expectation; not shot training or a QPU"}


def cli():
    parser = argparse.ArgumentParser(description="Reproducible local QSwipe teaching demo; no provider API")
    parser.add_argument("--seed", type=int, default=731)
    parser.add_argument("--no-retune", action="store_true", help="Sample the DOCX's unoptimized illustrative angles")
    args = parser.parse_args()
    folder = Path(__file__).resolve().parent
    artifact = json.loads((folder/"snapshot.json").read_text(encoding="utf-8"))
    runner.validate_artifact(artifact)
    runner.construct_circuit(artifact)
    if not args.no_retune:
        training = retune(artifact, args.seed)
        artifact = copy.deepcopy(artifact)
        artifact["result"] = {**artifact["result"], **training}
        artifact["circuit"]["circuit"] = runner.expected_gates(artifact)
        print(f"CPU training: {training['evaluations']} evaluations; mean {training['initialExpectedCost']:.9f} -> {training['expectedCost']:.9f}")
        # Pass the retuned frozen artifact explicitly; do not overwrite the
        # included teaching snapshot or perform another backend submission.
    runner.evaluate_portfolio(BasicSimulator(seed_simulator=args.seed), artifact=artifact,
                output_name="local_demo_result.json", execution_mode="local-basic-simulator")


if __name__ == "__main__":
    cli()
