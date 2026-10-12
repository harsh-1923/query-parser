"""Constrained BIO decoding: Viterbi, token marginals and span confidence (PLAN 6.1, 6.5).

Legal transitions: I-X may only follow B-X or I-X, and the sequence cannot start with I-*.
Everything is plain torch so the same functions serve training-time eval and the TS parity fixture.
"""

from __future__ import annotations

import torch

from .data import Labels
from .spans import Span, bio_to_spans

NEG = -1e9


def transition_masks(labels: Labels) -> tuple[torch.Tensor, torch.Tensor]:
    """Additive log-space masks: trans[i, j] and start[j], 0 if legal else NEG."""
    c = len(labels)
    trans = torch.full((c, c), NEG)
    start = torch.full((c,), NEG)
    for j, nxt in enumerate(labels.names):
        if not nxt.startswith("I-"):
            start[j] = 0.0
        for i, prev in enumerate(labels.names):
            if not nxt.startswith("I-") or (prev != "O" and prev[2:] == nxt[2:]):
                trans[i, j] = 0.0
    return trans, start


def viterbi(
    logits: torch.Tensor, mask: torch.Tensor, trans: torch.Tensor, start: torch.Tensor
) -> torch.Tensor:
    """Best legal tag sequence. logits (B,T,C), mask (B,T) with padding only at the end.

    Returns (B,T) long; padded positions repeat the last real tag.
    """
    emit = torch.log_softmax(logits, dim=-1)
    b, t, _ = emit.shape
    alpha = start + emit[:, 0]
    back = []
    for i in range(1, t):
        scores = alpha.unsqueeze(2) + trans  # (B, prev, next)
        best, arg = scores.max(dim=1)
        alpha = torch.where(mask[:, i : i + 1], best + emit[:, i], alpha)
        back.append(arg)
    cur = alpha.argmax(dim=-1)
    out = torch.zeros(b, t, dtype=torch.long)
    out[:, t - 1] = cur
    for i in range(t - 1, 0, -1):
        prev = back[i - 1].gather(1, cur.unsqueeze(1)).squeeze(1)
        cur = torch.where(mask[:, i], prev, cur)
        out[:, i - 1] = cur
    return out


def marginals(
    logits: torch.Tensor, mask: torch.Tensor, trans: torch.Tensor, start: torch.Tensor
) -> torch.Tensor:
    """P(tag_t = c | input) under the constrained transition structure (forward-backward).

    Returns (B,T,C); rows for padded positions are zero.
    """
    emit = torch.log_softmax(logits, dim=-1)
    b, t, c = emit.shape
    alphas = [start + emit[:, 0]]
    for i in range(1, t):
        step = torch.logsumexp(alphas[-1].unsqueeze(2) + trans, dim=1) + emit[:, i]
        alphas.append(torch.where(mask[:, i : i + 1], step, alphas[-1]))
    betas = [torch.zeros(b, c)] * t
    for i in range(t - 2, -1, -1):
        step = torch.logsumexp(trans + (emit[:, i + 1] + betas[i + 1]).unsqueeze(1), dim=2)
        betas[i] = torch.where(mask[:, i + 1 : i + 2], step, torch.zeros(b, c))
    alpha = torch.stack(alphas, dim=1)
    beta = torch.stack(betas, dim=1)
    log_z = torch.logsumexp(alphas[-1], dim=-1)  # alphas freeze after the last real token
    marg = torch.exp(alpha + beta - log_z.view(b, 1, 1))
    return marg * mask.unsqueeze(-1)


def span_confidences(
    tag_ids: list[int], marg: torch.Tensor, labels: Labels
) -> list[tuple[Span, float]]:
    """Spans of a decoded tag sequence, each with min token marginal of its predicted tags."""
    spans = bio_to_spans([labels.names[i] for i in tag_ids])
    return [
        (span, float(min(marg[k, tag_ids[k]] for k in range(span[1], span[2] + 1))))
        for span in spans
    ]
