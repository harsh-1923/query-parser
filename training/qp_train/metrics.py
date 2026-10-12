"""Span-level scoring: exact role + token boundaries."""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Sequence

from .data import Example
from .spans import Span, bio_to_spans

NAME_ROLES = {"ACTOR", "RECIPIENT", "PARTICIPANT", "MENTION"}
CUE_WORDS = {"from", "by", "to", "with", "mentioning", "cc", "assigned"}


class SpanCounts:
    """True/false positive and false negative span counts, per role."""

    def __init__(self) -> None:
        self.tp: dict[str, int] = defaultdict(int)
        self.fp: dict[str, int] = defaultdict(int)
        self.fn: dict[str, int] = defaultdict(int)

    def add(self, gold: set[Span], pred: set[Span]) -> None:
        for span in gold & pred:
            self.tp[span[0]] += 1
        for span in pred - gold:
            self.fp[span[0]] += 1
        for span in gold - pred:
            self.fn[span[0]] += 1

    @staticmethod
    def prf(tp: int, fp: int, fn: int) -> dict[str, float]:
        p = tp / (tp + fp) if tp + fp else 0.0
        r = tp / (tp + fn) if tp + fn else 0.0
        f = 2 * p * r / (p + r) if p + r else 0.0
        return {"p": p, "r": r, "f1": f, "support": tp + fn}

    def overall(self) -> dict[str, float]:
        return self.prf(sum(self.tp.values()), sum(self.fp.values()), sum(self.fn.values()))

    def per_role(self) -> dict[str, dict[str, float]]:
        roles = sorted(set(self.tp) | set(self.fp) | set(self.fn))
        return {r: self.prf(self.tp[r], self.fp[r], self.fn[r]) for r in roles}


def spans_of(tags: Sequence[str]) -> set[Span]:
    return set(bio_to_spans(tags))


def source_prefix(source: str) -> str:
    return re.split(r"[:/]", source, maxsplit=1)[0]


def has_cue(tokens: Sequence[str], start: int) -> bool:
    return start > 0 and tokens[start - 1].lower() in CUE_WORDS


def score(examples: Sequence[Example], pred_tags: Sequence[Sequence[str]]) -> dict:
    """Overall, per-role, exact-match, name-cue slice and per-source results."""
    total = SpanCounts()
    cue, nocue = SpanCounts(), SpanCounts()
    by_source: dict[str, SpanCounts] = defaultdict(SpanCounts)
    exact = 0
    exact_by_source: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    token_correct = token_total = 0
    for ex, pred in zip(examples, pred_tags, strict=True):
        gold_set, pred_set = spans_of(ex.tags), spans_of(pred)
        total.add(gold_set, pred_set)
        src = source_prefix(ex.source)
        by_source[src].add(gold_set, pred_set)
        ok = list(pred) == ex.tags
        exact += ok
        exact_by_source[src][0] += ok
        exact_by_source[src][1] += 1
        token_correct += sum(g == p for g, p in zip(ex.tags, pred, strict=True))
        token_total += len(ex.tags)
        # Name slices: a span belongs to the slice given by the token before it.
        for target in (cue, nocue):
            want_cue = target is cue
            g = {s for s in gold_set if s[0] in NAME_ROLES and has_cue(ex.tokens, s[1]) == want_cue}
            p = {s for s in pred_set if s[0] in NAME_ROLES and has_cue(ex.tokens, s[1]) == want_cue}
            target.add(g, p)
    n = max(len(examples), 1)
    return {
        "n_examples": len(examples),
        "token_acc": token_correct / max(token_total, 1),
        "overall": total.overall(),
        "per_role": total.per_role(),
        "exact_match": exact / n,
        "names_with_cue": cue.overall(),
        "names_without_cue": nocue.overall(),
        "per_source": {
            s: {**c.overall(), "exact_match": exact_by_source[s][0] / exact_by_source[s][1]}
            for s, c in sorted(by_source.items())
        },
    }
