# Groups every disagreement with gold on the LLM-written test sets into failure patterns, for the
# rule tagger and the trained tagger side by side. Run from training/: uv run python ../eval/failures.py

import json
from collections import defaultdict

from qp_train.data import Labels, load_jsonl
from qp_train.evaluate import mask_operators, predict_all
from qp_train.metrics import spans_of
from qp_train.runs import load_run

labels = Labels.load()
model, _ = load_run("runs/s1b/tagger-medium", labels)
CUES = {
    "from",
    "by",
    "to",
    "with",
    "mentioning",
    "cc",
    "assigned",
    "sent",
    "for",
    "shared",
    "in",
    "on",
}


def show(tokens, spans):
    return " ".join(
        f"{r}[{' '.join(tokens[s : e + 1])}]" for r, s, e in sorted(spans, key=lambda x: x[1])
    )


out = defaultdict(list)
for name, path, rules in [
    ("S02", "../eval/datasets/llm-written/v0/bio.jsonl", "../eval/results/s1b/rules-v0.pred.jsonl"),
    ("GLM", "../eval/datasets/llm-written/v1/bio.jsonl", "../eval/results/s1b/rules-v1.pred.jsonl"),
]:
    exs = load_jsonl(path, labels)
    mp = predict_all(model, exs, labels)
    rp = [mask_operators(ex, json.loads(l)["tags"]) for ex, l in zip(exs, open(rules))]
    for ex, m, r in zip(exs, mp, rp):
        g = spans_of(ex.tags)
        for sysname, p in (("rules", r), ("model", m)):
            P = spans_of(p)
            for role, s, e in g - P:
                prev = ex.tokens[s - 1].lower() if s > 0 else ""
                over = [x for x in P if x[1] <= e and s <= x[2]]
                pr = over[0][0] if over else "none"
                cue = "cue" if prev in CUES else "nocue"
                key = (
                    f"miss {role}"
                    + (
                        f" ({cue})"
                        if role in ("ACTOR", "RECIPIENT", "PARTICIPANT", "MENTION")
                        else ""
                    )
                    + f" -> {pr}"
                )
                out[(sysname, key)].append((name, ex.text, show(ex.tokens, g), show(ex.tokens, P)))
            for role, s, e in P - g:
                over = [x for x in g if x[1] <= e and s <= x[2]]
                if not over:
                    out[(sysname, f"spurious {role}")].append(
                        (name, ex.text, show(ex.tokens, g), show(ex.tokens, P))
                    )
for sysname in ("rules", "model"):
    print(f"\n######## {sysname}")
    items = sorted(
        ((k[1], v) for k, v in out.items() if k[0] == sysname), key=lambda kv: -len(kv[1])
    )
    for key, v in items[:24]:
        print(f"\n{len(v):3d}  {key}")
        seen = set()
        for name, text, g, p in v:
            if text in seen:
                continue
            seen.add(text)
            print(f"      [{name}] {text}\n            gold {g}\n            pred {p}")
            if len(seen) >= 3:
                break
