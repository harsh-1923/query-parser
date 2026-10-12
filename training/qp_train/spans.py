"""Span helpers, and the output grammar of the seq2seq baseline.

Decoder formulation (see Decoder in model.py): the output is a sequence
`BOS (role start end)* EOS` over the vocabulary [roles..., positions 0..47, BOS, EOS], where
`start`/`end` are inclusive token indices into the input. `allowed_next` is the grammar that makes
invalid output unreachable: positions increase, spans never overlap, end >= start, and every
position is inside the input. Outputs are therefore always grounded in the input tokens.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from .data import MAX_TOKENS, Labels

Span = tuple[str, int, int]  # (role, first token, last token), inclusive

MAX_SPANS = 16  # decoder output cap; longer gold annotations are truncated for training


def bio_to_spans(tags: Sequence[str]) -> list[Span]:
    """Spans from BIO tags. A stray I-X (no matching B-X/I-X before it) opens a new span."""
    spans: list[Span] = []
    role, start = None, 0
    for i, tag in enumerate(tags):
        if tag == "O":
            if role is not None:
                spans.append((role, start, i - 1))
            role = None
            continue
        prefix, r = tag[0], tag[2:]
        if prefix == "B" or r != role:
            if role is not None:
                spans.append((role, start, i - 1))
            role, start = r, i
    if role is not None:
        spans.append((role, start, len(tags) - 1))
    return spans


def spans_to_bio(spans: Sequence[Span], n: int) -> list[str]:
    tags = ["O"] * n
    for role, start, end in spans:
        tags[start] = f"B-{role}"
        for i in range(start + 1, end + 1):
            tags[i] = f"I-{role}"
    return tags


class Grammar:
    """Token ids and constraints for the decoder's output sequences."""

    def __init__(self, labels: Labels):
        self.roles = labels.roles
        self.n_roles = len(self.roles)
        self.pos_base = self.n_roles
        self.bos = self.pos_base + MAX_TOKENS
        self.eos = self.bos + 1
        self.vocab_size = self.eos + 1
        self.max_steps = 3 * MAX_SPANS + 1  # generated tokens, including EOS

    def allowed_next(self, step: int, prev_end: int, start: int, n: int) -> np.ndarray:
        """Bool mask over the vocabulary for generated token number `step` (0-based).

        prev_end: end of the previous span (-1 if none); start: start of the span being written
        (only meaningful when step % 3 == 2); n: number of input tokens.
        """
        mask = np.zeros(self.vocab_size, dtype=bool)
        phase = step % 3
        if phase == 0:  # role or EOS
            mask[self.eos] = True
            if prev_end + 1 < n and step < self.max_steps - 1:
                mask[: self.n_roles] = True
        elif phase == 1:  # start in (prev_end, n)
            mask[self.pos_base + prev_end + 1 : self.pos_base + n] = True
        else:  # end in [start, n)
            mask[self.pos_base + start : self.pos_base + n] = True
        return mask

    def encode(self, spans: Sequence[Span]) -> list[int]:
        """Gold output ids: role,start,end triples then EOS (no BOS)."""
        out: list[int] = []
        for role, start, end in spans[:MAX_SPANS]:
            out += [self.roles.index(role), self.pos_base + start, self.pos_base + end]
        return [*out, self.eos]

    def masks_for(self, target: Sequence[int], n: int) -> np.ndarray:
        """Allowed-token masks for each step of a gold target, given the gold prefix."""
        masks = np.zeros((len(target), self.vocab_size), dtype=bool)
        prev_end, start = -1, 0
        for step, tok in enumerate(target):
            masks[step] = self.allowed_next(step, prev_end, start, n)
            if step % 3 == 1:
                start = tok - self.pos_base
            elif step % 3 == 2:
                prev_end = tok - self.pos_base
        return masks

    def decode(self, ids: Sequence[int]) -> list[Span]:
        """Inverse of encode (ids without BOS; stops at EOS)."""
        spans = []
        for i in range(0, len(ids) - 2, 3):
            if ids[i] == self.eos:
                break
            spans.append(
                (self.roles[ids[i]], ids[i + 1] - self.pos_base, ids[i + 2] - self.pos_base)
            )
        return spans
