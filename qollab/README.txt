QSWIPE — PORTABLE JOINT PORTFOLIO EXPERIMENT

See README.md for setup, the worked example, and methodology.

Local Python:
  python -m pip install -r requirements.txt
  python local_demo.py --seed 731

Qollab:
  Upload main.py and snapshot.json together. Qollab supplies backend.
  Press Run once. The script submits backend.run exactly once.

Included snapshot.json is SYNTHETIC teaching data, not live exchange data.
Local retuning and Aer sampling are classical simulation, not hardware.
The runner never applies a market order or automatically launches jobs.
