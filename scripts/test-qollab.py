"""Integration checks for Qollab's injected-backend and automatic-main contract.

Run with a Python environment containing qollab/requirements.txt. No Aer needed.
"""
import ast
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from qiskit.providers.basic_provider import BasicSimulator

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "qollab/main.py").read_text()
SNAPSHOT = (ROOT / "qollab/snapshot.json").read_text()


class CountingBackend:
    def __init__(self, fail=False):
        self.base = BasicSimulator(seed_simulator=731)
        self.calls = []
        self.fail = fail

    def __getattr__(self, name):
        return getattr(self.base, name)

    def run(self, circuit, **options):
        self.calls.append(options)
        if self.fail:
            raise RuntimeError("selected backend failed")
        return self.base.run(circuit, **options)


class RuntimeContract(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.old_cwd = Path.cwd()
        os.chdir(self.folder.name)
        Path("snapshot.json").write_text(SNAPSHOT)
        self.device = CountingBackend()
        self.namespace = {"__name__": "__main__", "backend": self.device}
        self.out = io.StringIO()
        # Load top to bottom exactly as Qollab does. It calls main separately.
        with contextlib.redirect_stdout(self.out):
            exec(compile(SOURCE, "main.py", "exec"), self.namespace)

    def tearDown(self):
        os.chdir(self.old_cwd)
        self.folder.cleanup()

    def test_script_load_submits_nothing(self):
        self.assertEqual(self.device.calls, [])
        self.assertEqual(self.namespace["main"].__annotations__, {"shots": int})

    def test_auto_main_submits_once_and_exports_console_report(self):
        downloads = []
        bridge = types.ModuleType("js")
        bridge.sendFile = lambda *args: downloads.append(args)
        with patch.dict(sys.modules, {"js": bridge}), contextlib.redirect_stdout(self.out):
            report = self.namespace["main"](256)
        self.assertEqual(self.device.calls, [{"shots": 256}])
        self.assertEqual(report["metrics"]["returnedShots"], 256)
        self.assertEqual(report["resources"]["backendSubmissions"], 1)
        self.assertEqual(len(downloads), 1)
        name, mime, data = downloads[0]
        self.assertEqual((name, mime), ("qollab_result.json", "application/json"))
        self.assertEqual(json.loads(data), report)
        self.assertFalse(Path(name).exists())
        if report["selected"]:
            self.assertGreater(report["selected"]["count"], 0)

    def test_desktop_output_is_written_without_js_bridge(self):
        with patch.dict(sys.modules, {"js": None}), contextlib.redirect_stdout(self.out):
            report = self.namespace["main"]()
        self.assertEqual(json.loads(Path("qollab_result.json").read_text()), report)
        self.assertEqual(self.device.calls, [{"shots": 1024}])

    def test_selected_backend_failure_never_falls_back_or_retries(self):
        self.device.fail = True
        with self.assertRaisesRegex(RuntimeError, "selected backend failed"):
            self.namespace["main"]()
        self.assertEqual(len(self.device.calls), 1)
        self.assertFalse(Path("qollab_result.json").exists())

    def test_invalid_shot_count_is_rejected_before_submission(self):
        for value in (0, 4097, True, 1.5):
            with self.assertRaisesRegex(ValueError, "Shots"):
                self.namespace["main"](value)
        self.assertEqual(self.device.calls, [])

    def test_missing_injected_backend_does_not_create_one(self):
        del self.namespace["backend"]
        with self.assertRaisesRegex(RuntimeError, "pre-created"):
            self.namespace["main"]()
        self.assertEqual(self.device.calls, [])

    def test_snapshot_path_can_be_discovered_by_qollab(self):
        strings = {node.value for node in ast.walk(ast.parse(SOURCE))
                   if isinstance(node, ast.Constant) and isinstance(node.value, str)}
        self.assertIn("snapshot.json", strings)

    def test_packaged_code_and_requirements_have_no_aer_dependency(self):
        for name in ("main.py", "local_demo.py", "requirements.txt"):
            text = (ROOT / "qollab" / name).read_text()
            self.assertNotIn("qiskit_aer", text)
            self.assertNotIn("qiskit-aer", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
