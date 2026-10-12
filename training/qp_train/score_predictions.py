"""Score a predictions JSONL against a gold JSONL with the same metrics as evaluate.py.

Used for taggers that aren't PyTorch models (the rule baseline):
    uv run python -m qp_train.score_predictions --gold gold.jsonl --pred pred.jsonl
"""

import argparse
import json

from qp_train.data import Labels, load_jsonl
from qp_train.evaluate import print_report
from qp_train.metrics import score


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--gold", required=True)
    ap.add_argument("--pred", required=True)
    ap.add_argument("--name", default="predictions")
    ap.add_argument("--json", help="write the result dict here")
    args = ap.parse_args()
    gold = load_jsonl(args.gold, Labels.load())
    with open(args.pred) as f:
        pred = [json.loads(line)["tags"] for line in f if line.strip()]
    if len(pred) != len(gold):
        raise SystemExit(f"{len(pred)} predictions for {len(gold)} gold examples")
    result = score(gold, pred)
    print_report(args.name, result)
    if args.json:
        with open(args.json, "w") as f:
            json.dump(result, f, indent=2)


if __name__ == "__main__":
    main()
