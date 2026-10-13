"""Summarize the S7 dev-selection runs: span F1 per seed on S02 and GLM, mean and spread.

Run from the repo root: python3 spikes/S07-lexicon-features/summarize-dev.py
"""

import json
import re
import statistics
from pathlib import Path

R = Path("eval/results/s7-dev")
RULES = {"S02": 0.727, "GLM": 0.726}  # eval/results/report.md


def best_epoch(log: Path) -> tuple[int, float, int]:
    rows = [
        (int(m[1]), float(m[2]))
        for m in re.finditer(r"epoch\s+(\d+).*?val F1 ([\d.]+)", log.read_text())
    ]
    ep, f1 = max(rows, key=lambda r: (r[1], -r[0]))
    return ep, f1, rows[-1][0]


out = {}
for system in ("baseline", "feat"):
    for seed in (42, 43, 44):
        e = R / f"{system}-{seed}.eval.json"
        if not e.exists():
            continue
        ds = list(json.loads(e.read_text())["datasets"].values())
        ep, dev, last = best_epoch(R / f"{system}-{seed}.train.log")
        out.setdefault(system, []).append(
            {
                "seed": seed,
                "best_epoch": ep,
                "last_epoch": last,
                "dev": dev,
                "S02": ds[0]["overall"]["f1"],
                "GLM": ds[1]["overall"]["f1"],
            }
        )

print("| System | Seed | Best epoch (stopped) | Dev F1 | S02 | GLM |")
print("|---|---|---|---|---|---|")
for system, rows in out.items():
    for r in rows:
        print(
            f"| {system} | {r['seed']} | {r['best_epoch']} ({r['last_epoch']}) | "
            f"{r['dev']:.3f} | {r['S02']:.3f} | {r['GLM']:.3f} |"
        )
print()
print("| System | n | S02 mean (min–max) | GLM mean (min–max) | Δ rules S02 | Δ rules GLM |")
print("|---|---|---|---|---|---|")
summary = {}
for system, rows in out.items():
    cells, s = [], {}
    for k in ("S02", "GLM"):
        v = [r[k] for r in rows]
        s[k] = {"mean": statistics.mean(v), "min": min(v), "max": max(v), "values": v}
        cells.append(f"{s[k]['mean']:.3f} ({min(v):.3f}–{max(v):.3f})")
    d = [f"{s[k]['mean'] - RULES[k]:+.3f}" for k in ("S02", "GLM")]
    print(f"| {system} | {len(rows)} | {cells[0]} | {cells[1]} | {d[0]} | {d[1]} |")
    summary[system] = {"runs": rows, **s}
(R / "summary.json").write_text(json.dumps({"rules": RULES, **summary}, indent=2) + "\n")
