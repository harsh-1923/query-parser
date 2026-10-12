"""Error analysis: where a trained run disagrees with gold, by error type and role confusion.

uv run python -m qp_train.errors --run runs/s1/tagger-medium --data gold.jsonl [--show 25]
"""

import argparse
from collections import Counter

from qp_train.data import Labels, load_jsonl
from qp_train.evaluate import predict_all
from qp_train.metrics import spans_of
from qp_train.runs import load_run


def classify(gold: set, pred: set) -> tuple[Counter, list[str]]:
    kinds: Counter = Counter()
    notes = []
    matched_pred = set()
    for g in gold:
        if g in pred:
            matched_pred.add(g)
            continue
        role, s, e = g
        same_span = [p for p in pred if p[1] == s and p[2] == e]
        overlap = [p for p in pred if p[1] < e and s < p[2]]
        if same_span:
            kinds[f"role {role}→{same_span[0][0]}"] += 1
            matched_pred.add(same_span[0])
        elif any(p[0] == role for p in overlap):
            kinds[f"boundary {role}"] += 1
            matched_pred.update(p for p in overlap if p[0] == role)
        elif overlap:
            kinds[f"role {role}→{overlap[0][0]} (+boundary)"] += 1
            matched_pred.update(overlap)
        else:
            kinds[f"missed {role}"] += 1
    for p in pred - matched_pred:
        kinds[f"spurious {p[0]}"] += 1
    return kinds, notes


def show(tokens: list[str], spans: set) -> str:
    ordered = sorted(spans, key=lambda x: x[1])
    return " ".join(f"{r}[{' '.join(tokens[s : e + 1])}]" for r, s, e in ordered)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--show", type=int, default=25)
    args = ap.parse_args()
    labels = Labels.load()
    model, _ = load_run(args.run, labels)
    examples = load_jsonl(args.data, labels)
    preds = predict_all(model, examples, labels)
    total: Counter = Counter()
    shown = 0
    for ex, tags in zip(examples, preds, strict=True):
        gold_tags = ex.tags
        gold, pred = spans_of(gold_tags), spans_of(tags)
        kinds, _ = classify(gold, pred)
        total.update(kinds)
        if kinds and shown < args.show:
            shown += 1
            print(f"- {' '.join(ex.tokens)}")
            print(f"    gold {show(ex.tokens, gold)}")
            print(f"    pred {show(ex.tokens, pred)}")
    print("\nerror types:")
    for k, n in total.most_common(30):
        print(f"  {n:4d}  {k}")


if __name__ == "__main__":
    main()
