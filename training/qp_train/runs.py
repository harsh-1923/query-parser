"""Saving and loading training runs (config.json + best.pt)."""

from __future__ import annotations

import json
from pathlib import Path

import torch

from .data import Labels
from .model import Decoder, Tagger, build_model, count_params


def save_run(run_dir: Path, model: Tagger | Decoder, kind: str, config_name: str, extra: dict):
    run_dir.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), run_dir / "best.pt")
    meta = {"model": kind, "config_name": config_name, "params": count_params(model), **extra}
    (run_dir / "config.json").write_text(json.dumps(meta, indent=2))


def load_run(run_dir: Path | str, labels: Labels | None = None) -> tuple[Tagger | Decoder, dict]:
    run_dir = Path(run_dir)
    meta = json.loads((run_dir / "config.json").read_text())
    model = build_model(meta["model"], meta["config_name"], labels or Labels.load())
    model.load_state_dict(torch.load(run_dir / "best.pt", weights_only=True))
    model.eval()
    return model, meta
