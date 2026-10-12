"""Train the tagger or the decoder baseline on CPU.

    uv run python -m qp_train.train --model tagger --config medium \
        --train train.jsonl --val val.jsonl --epochs 30 --out runs/tagger-medium
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import numpy as np
import torch

from .data import Example, Labels, iter_batches, load_jsonl
from .metrics import SpanCounts, spans_of
from .model import DECODER_CONFIGS, TAGGER_CONFIGS, build_model, count_params
from .runs import save_run


def set_determinism(seed: int, threads: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(threads)
    torch.use_deterministic_algorithms(True)


def evaluate_model(model, examples: list[Example], labels: Labels, batch_size: int = 256) -> dict:
    """Token accuracy and micro span F1 under constrained decoding."""
    model.eval()
    counts = SpanCounts()
    correct = total = 0
    for chunk, batch in iter_batches(examples, batch_size):
        for ex, pred in zip(chunk, model.predict(batch), strict=True):
            names = [labels.names[i] for i in pred]
            counts.add(spans_of(ex.tags), spans_of(names))
            correct += int((np.array(pred) == ex.tag_ids).sum())
            total += len(ex)
    return {"token_acc": correct / max(total, 1), "span_f1": counts.overall()["f1"]}


def lr_at(step: int, total: int, warmup: int, peak: float) -> float:
    if step < warmup:
        return peak * (step + 1) / warmup
    progress = (step - warmup) / max(total - warmup, 1)
    return peak * 0.5 * (1 + math.cos(math.pi * progress))


def train(args: argparse.Namespace) -> dict:
    set_determinism(args.seed, args.threads)
    labels = Labels.load()
    train_set = load_jsonl(args.train, labels)
    val_set = load_jsonl(args.val, labels)
    model = build_model(args.model, args.config, labels, args.label_smoothing)
    n_params = count_params(model)
    print(
        f"{args.model}/{args.config}: {n_params:,} params, {len(train_set)} train, "
        f"{len(val_set)} val",
        flush=True,
    )

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    steps_per_epoch = math.ceil(len(train_set) / args.batch)
    total_steps = steps_per_epoch * args.epochs
    warmup = max(1, int(args.warmup_frac * total_steps))

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    log_file = open(out / "log.jsonl", "w")  # noqa: SIM115
    best_f1, best_epoch, step = -1.0, 0, 0
    hparams = {k: v for k, v in vars(args).items() if k not in {"out"}}
    for epoch in range(1, args.epochs + 1):
        started = time.perf_counter()
        model.train()
        loss_sum, n_batches = 0.0, 0
        for _, batch in iter_batches(
            train_set, args.batch, shuffle=True, seed=args.seed, epoch=epoch
        ):
            for group in opt.param_groups:
                group["lr"] = lr_at(step, total_steps, warmup, args.lr)
            loss = model.loss(batch)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), args.clip)
            opt.step()
            loss_sum += loss.item()
            n_batches += 1
            step += 1
        val = evaluate_model(model, val_set, labels)
        record = {
            "epoch": epoch,
            "loss": loss_sum / max(n_batches, 1),
            "val_token_acc": val["token_acc"],
            "val_span_f1": val["span_f1"],
            "seconds": time.perf_counter() - started,
        }
        log_file.write(json.dumps(record) + "\n")
        log_file.flush()
        print(
            f"epoch {epoch:3d}  loss {record['loss']:.4f}  val acc {val['token_acc']:.4f}  "
            f"val F1 {val['span_f1']:.4f}  {record['seconds']:.1f}s",
            flush=True,
        )
        if val["span_f1"] > best_f1:
            best_f1, best_epoch = val["span_f1"], epoch
            save_run(
                out,
                model,
                args.model,
                args.config,
                {"hparams": hparams, "best_epoch": epoch, "val_span_f1": best_f1},
            )
        elif epoch - best_epoch >= args.patience:
            print(f"early stop: no val F1 gain for {args.patience} epochs", flush=True)
            break
    log_file.close()
    return {"best_val_span_f1": best_f1, "best_epoch": best_epoch, "params": n_params}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--model", choices=["tagger", "decoder"], default="tagger")
    p.add_argument(
        "--config",
        default=None,
        help=f"tagger: {list(TAGGER_CONFIGS)}; decoder: {list(DECODER_CONFIGS)}",
    )
    p.add_argument("--train", required=True)
    p.add_argument("--val", required=True)
    p.add_argument("--epochs", type=int, default=20)
    p.add_argument("--batch", type=int, default=128)
    p.add_argument("--lr", type=float, default=3e-3)
    p.add_argument("--weight-decay", type=float, default=0.01)
    p.add_argument("--warmup-frac", type=float, default=0.05)
    p.add_argument("--clip", type=float, default=1.0)
    p.add_argument("--label-smoothing", type=float, default=0.0)
    p.add_argument("--patience", type=int, default=5)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--out", required=True)
    args = p.parse_args()
    args.config = args.config or ("base" if args.model == "decoder" else "medium")
    train(args)


if __name__ == "__main__":
    main()
