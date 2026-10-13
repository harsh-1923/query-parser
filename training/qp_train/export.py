"""Export a trained tagger for the TS runtime (@qp/model), plus its parity fixture.

    uv run python -m qp_train.export --run runs/s7-dev/feat-42 --name s7-feat-42 \
        --parity ../eval/datasets/generated/s7/v0-all.jsonl

Writes:
- packages/model/weights/<name>.json: config, labels and the tensor table (name, shape, offset);
- packages/model/weights/<name>.bin: every tensor as little-endian float32, in table order;
- eval/fixtures/model-parity/<name>.json: logits, tags and confidences for --cases inputs from
  --parity, which the TS test must reproduce (AGENTS rule 6).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from .data import MAX_BYTES, MAX_TOKENS, Labels, collate, load_jsonl
from .runs import load_run

ROOT = Path(__file__).resolve().parents[2]


def export(run: Path, name: str, parity: Path, cases: int, note: str) -> None:
    labels = Labels.load()
    model, meta = load_run(run, labels)
    sd = model.state_dict()
    keys = [k for k in sd if k not in ("trans", "start")]
    table, chunks, offset = [], [], 0
    for k in keys:
        a = sd[k].detach().cpu().numpy().astype("<f4")
        table.append({"name": k, "shape": list(a.shape), "offset": offset})
        chunks.append(a.tobytes())
        offset += a.size
    out = ROOT / "packages" / "model" / "weights"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{name}.bin").write_bytes(b"".join(chunks))
    manifest = {
        "name": name,
        "format": "qp-tagger-f32-v1",
        "config": {
            **meta["hparams"],
            **model.config.__dict__,
            "config_name": meta["config_name"],
        },
        "maxTokens": MAX_TOKENS,
        "maxBytes": MAX_BYTES,
        "labels": labels.names,
        "params": int(offset),
        "bestEpoch": meta.get("best_epoch"),
        "valSpanF1": meta.get("val_span_f1"),
        "note": note,
        "tensors": table,
    }
    manifest["config"].pop("train", None)
    manifest["config"].pop("val", None)
    (out / f"{name}.json").write_text(json.dumps(manifest, indent=2) + "\n")

    examples = load_jsonl(parity, labels)[:cases]
    rows = []
    with torch.no_grad():
        for e in examples:
            batch = collate([e])
            logits = model.logits(batch)[0]
            tags = model.predict(batch)[0]
            marg = model.token_marginals(batch)[0]
            rows.append(
                {
                    "tokens": e.tokens,
                    **({"feats": e.feats.tolist()} if e.feats is not None else {}),
                    "logits": [[round(float(v), 5) for v in row] for row in logits.tolist()],
                    "tags": [labels.names[t] for t in tags],
                    "confidence": [round(float(marg[i, t]), 5) for i, t in enumerate(tags)],
                }
            )
    fx = ROOT / "eval" / "fixtures" / "model-parity"
    fx.mkdir(parents=True, exist_ok=True)
    (fx / f"{name}.json").write_text(json.dumps({"model": name, "cases": rows}) + "\n")
    print(f"{name}: {offset} params, {len(rows)} parity cases")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--run", required=True, type=Path)
    p.add_argument("--name", required=True)
    p.add_argument("--parity", required=True, type=Path, help="BIO JSONL with inputs for parity")
    p.add_argument("--cases", type=int, default=40)
    p.add_argument("--note", default="")
    a = p.parse_args()
    export(a.run, a.name, a.parity, a.cases, a.note)


if __name__ == "__main__":
    main()
