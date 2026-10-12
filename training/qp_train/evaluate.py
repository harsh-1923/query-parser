"""Evaluate a trained run: span P/R/F1, exact match, slices, and single-query latency.

uv run python -m qp_train.evaluate --run runs/tagger-medium --data test.jsonl [--data2 ...]
"""

from __future__ import annotations

import argparse
import json
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np
import torch

from .data import Example, Labels, collate, iter_batches, load_jsonl
from .metrics import score
from .model import Tagger
from .runs import load_run

LATENCY_TOKENS = 10
LATENCY_RUNS = 500
LATENCY_WARMUP = 50


def predict_all(model, examples: list[Example], labels: Labels) -> list[list[str]]:
    out: list[list[str]] = []
    for _, batch in iter_batches(examples, 256):
        out += [[labels.names[i] for i in ids] for ids in model.predict(batch)]
    return out


def percentiles(times: list[float]) -> dict[str, float]:
    arr = np.array(times) * 1000
    return {"p50_ms": float(np.percentile(arr, 50)), "p95_ms": float(np.percentile(arr, 95))}


def time_calls(fn: Callable[[], object]) -> dict[str, float]:
    for _ in range(LATENCY_WARMUP):
        fn()
    times = []
    for _ in range(LATENCY_RUNS):
        start = time.perf_counter()
        fn()
        times.append(time.perf_counter() - start)
    return percentiles(times)


def pick_latency_example(examples: list[Example]) -> Example:
    """A real 10-token query if there is one, else the first example cut or tiled to 10 tokens."""
    for ex in examples:
        if len(ex) == LATENCY_TOKENS:
            return ex
    ex = examples[0]
    reps = -(-LATENCY_TOKENS // len(ex))
    return Example(
        text=ex.text,
        tokens=(ex.tokens * reps)[:LATENCY_TOKENS],
        offsets=(ex.offsets * reps)[:LATENCY_TOKENS],
        tags=(ex.tags * reps)[:LATENCY_TOKENS],
        source=ex.source,
        bytes_ids=np.tile(ex.bytes_ids, (reps, 1))[:LATENCY_TOKENS],
        tag_ids=np.tile(ex.tag_ids, reps)[:LATENCY_TOKENS],
    )


def measure_latency(model, examples: list[Example]) -> dict:
    """Batch 1, one thread, ~10-token query, p50/p95 over 500 runs."""
    previous_threads = torch.get_num_threads()
    torch.set_num_threads(1)
    batch = collate([pick_latency_example(examples)])
    model.eval()
    result: dict[str, dict[str, float]] = {}
    with torch.no_grad():
        if isinstance(model, Tagger):
            result["forward"] = time_calls(lambda: model.logits(batch))
            result["forward_plus_viterbi"] = time_calls(lambda: model.predict(batch))
        else:
            result["full_decode"] = time_calls(lambda: model.predict_spans(batch))
            n_out = sum(3 * len(s) + 1 for s in model.predict_spans(batch))
            result["generated_tokens"] = {"count": float(n_out)}
    torch.set_num_threads(previous_threads)
    return result


def print_report(name: str, result: dict) -> None:
    o = result["overall"]
    print(f"\n== {name}  (n={result['n_examples']}) ==")
    print(
        f"span P {o['p']:.4f}  R {o['r']:.4f}  F1 {o['f1']:.4f}  | "
        f"exact match {result['exact_match']:.4f}  | token acc {result['token_acc']:.4f}"
    )
    print(f"{'role':<14}{'P':>8}{'R':>8}{'F1':>8}{'support':>9}")
    for role, m in result["per_role"].items():
        print(f"{role:<14}{m['p']:>8.3f}{m['r']:>8.3f}{m['f1']:>8.3f}{m['support']:>9}")
    for key, label in (("names_with_cue", "names with cue"), ("names_without_cue", "names no cue")):
        m = result[key]
        print(f"{label:<14}{m['p']:>8.3f}{m['r']:>8.3f}{m['f1']:>8.3f}{m['support']:>9}")
    print(f"{'source':<14}{'P':>8}{'R':>8}{'F1':>8}{'exact':>9}{'support':>9}")
    for src, m in result["per_source"].items():
        print(
            f"{src:<14}{m['p']:>8.3f}{m['r']:>8.3f}{m['f1']:>8.3f}"
            f"{m['exact_match']:>9.3f}{m['support']:>9}"
        )


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--run", required=True)
    p.add_argument("--data", required=True, action="append")
    for i in range(2, 6):
        p.add_argument(f"--data{i}", dest="data", action="append")
    p.add_argument("--no-latency", action="store_true")
    p.add_argument("--out", help="JSON output path (default: <run>/eval.json)")
    args = p.parse_args()

    torch.manual_seed(0)
    labels = Labels.load()
    model, meta = load_run(args.run, labels)
    print(f"{meta['model']}/{meta['config_name']}: {meta['params']:,} params")
    report: dict = {
        "model": meta["model"],
        "config": meta["config_name"],
        "params": meta["params"],
        "datasets": {},
    }
    first_examples = None
    for path in args.data:
        examples = load_jsonl(path, labels)
        first_examples = first_examples or examples
        result = score(examples, predict_all(model, examples, labels))
        report["datasets"][path] = result
        print_report(path, result)
    if not args.no_latency:
        report["latency"] = measure_latency(model, first_examples)
        print("\nlatency (batch 1, 1 thread, 10 tokens, p50/p95 ms):")
        for k, v in report["latency"].items():
            print(f"  {k}: {v}")
    out = Path(args.out or Path(args.run) / "eval.json")
    out.write_text(json.dumps(report, indent=2))
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
