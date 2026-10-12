"""The BIO tagger (PLAN 6) and the seq2seq baseline ("gpu-cron style") for spike S1.

Both models share the same encoder and expose the same interface:
    loss(batch) -> scalar tensor
    predict(batch) -> list of BIO tag-id lists (one per example, length = its token count)
so training and evaluation treat them identically.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from .data import BYTE_VOCAB, MAX_TOKENS, PAD_BYTE, Batch, Labels
from .decoding import marginals, transition_masks, viterbi
from .spans import Grammar, bio_to_spans, spans_to_bio


@dataclass(frozen=True)
class TaggerConfig:
    d: int  # model width
    d_b: int  # byte embedding / conv width
    layers: int
    heads: int
    ffn: int  # FFN hidden = ffn * d
    dropout: float = 0.1


@dataclass(frozen=True)
class DecoderConfig:
    d: int
    d_b: int
    enc_layers: int
    dec_layers: int
    heads: int
    ffn: int
    dropout: float = 0.1


TAGGER_CONFIGS = {
    "small": TaggerConfig(d=38, d_b=12, layers=2, heads=2, ffn=2),
    "medium": TaggerConfig(d=64, d_b=16, layers=2, heads=4, ffn=2),
    "large": TaggerConfig(d=64, d_b=24, layers=3, heads=4, ffn=3),
}
DECODER_CONFIGS = {
    "base": DecoderConfig(d=56, d_b=16, enc_layers=1, dec_layers=1, heads=2, ffn=2),
}


def count_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


class ByteEncoder(nn.Module):
    """Token bytes -> vector: byte embedding, Conv1d (kernel 3), masked max-pool, linear."""

    def __init__(self, d_b: int, d: int):
        super().__init__()
        self.embed = nn.Embedding(BYTE_VOCAB, d_b, padding_idx=PAD_BYTE)
        self.conv = nn.Conv1d(d_b, d_b, kernel_size=3, padding=1)
        self.proj = nn.Linear(d_b, d)

    def forward(self, bytes_ids: torch.Tensor) -> torch.Tensor:
        b, t, k = bytes_ids.shape
        flat = bytes_ids.reshape(b * t, k)
        x = self.embed(flat).transpose(1, 2)  # (N, d_b, K)
        x = F.relu(self.conv(x)).transpose(1, 2)  # (N, K, d_b)
        valid = (flat != PAD_BYTE).unsqueeze(-1)
        pooled = x.masked_fill(~valid, -1e4).max(dim=1).values
        pooled = pooled * valid.any(dim=1)  # all-padding tokens -> zero vector
        return self.proj(pooled).reshape(b, t, -1)


class EncoderBlock(nn.Module):
    """Pre-LN bidirectional transformer layer."""

    def __init__(self, d: int, heads: int, ffn: int, dropout: float):
        super().__init__()
        self.ln1 = nn.LayerNorm(d)
        self.attn = nn.MultiheadAttention(d, heads, dropout=dropout, batch_first=True)
        self.ln2 = nn.LayerNorm(d)
        self.ff = nn.Sequential(nn.Linear(d, ffn * d), nn.GELU(), nn.Linear(ffn * d, d))
        self.drop = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        h = self.ln1(x)
        a, _ = self.attn(h, h, h, key_padding_mask=~mask, need_weights=False)
        x = x + self.drop(a)
        return x + self.drop(self.ff(self.ln2(x)))


class Encoder(nn.Module):
    def __init__(self, d: int, d_b: int, layers: int, heads: int, ffn: int, dropout: float):
        super().__init__()
        self.bytes = ByteEncoder(d_b, d)
        self.pos = nn.Embedding(MAX_TOKENS, d)
        self.drop = nn.Dropout(dropout)
        self.blocks = nn.ModuleList(EncoderBlock(d, heads, ffn, dropout) for _ in range(layers))
        self.ln = nn.LayerNorm(d)

    def forward(self, batch: Batch) -> torch.Tensor:
        t = batch.bytes_ids.shape[1]
        x = self.bytes(batch.bytes_ids) + self.pos(torch.arange(t))
        x = self.drop(x)
        for block in self.blocks:
            x = block(x, batch.mask)
        return self.ln(x)


class Tagger(nn.Module):
    """Per-token BIO tagger with constrained Viterbi decoding."""

    def __init__(self, config: TaggerConfig, labels: Labels, label_smoothing: float = 0.0):
        super().__init__()
        self.config, self.labels, self.label_smoothing = config, labels, label_smoothing
        self.encoder = Encoder(
            config.d, config.d_b, config.layers, config.heads, config.ffn, config.dropout
        )
        self.head = nn.Linear(config.d, len(labels))
        trans, start = transition_masks(labels)
        self.register_buffer("trans", trans, persistent=False)
        self.register_buffer("start", start, persistent=False)

    def logits(self, batch: Batch) -> torch.Tensor:
        return self.head(self.encoder(batch))

    def loss(self, batch: Batch) -> torch.Tensor:
        logits = self.logits(batch)
        target = batch.tags.masked_fill(~batch.mask, -100)
        return F.cross_entropy(
            logits.reshape(-1, logits.shape[-1]),
            target.reshape(-1),
            ignore_index=-100,
            label_smoothing=self.label_smoothing,
        )

    @torch.no_grad()
    def predict(self, batch: Batch) -> list[list[int]]:
        ids = viterbi(self.logits(batch), batch.mask, self.trans, self.start)
        return [ids[i, :n].tolist() for i, n in enumerate(batch.lengths.tolist())]

    @torch.no_grad()
    def token_marginals(self, batch: Batch) -> torch.Tensor:
        return marginals(self.logits(batch), batch.mask, self.trans, self.start)


class DecoderBlock(nn.Module):
    """Pre-LN decoder layer: causal self-attention, cross-attention to the encoder, FFN."""

    def __init__(self, d: int, heads: int, ffn: int, dropout: float):
        super().__init__()
        self.ln1 = nn.LayerNorm(d)
        self.self_attn = nn.MultiheadAttention(d, heads, dropout=dropout, batch_first=True)
        self.ln2 = nn.LayerNorm(d)
        self.cross_attn = nn.MultiheadAttention(d, heads, dropout=dropout, batch_first=True)
        self.ln3 = nn.LayerNorm(d)
        self.ff = nn.Sequential(nn.Linear(d, ffn * d), nn.GELU(), nn.Linear(ffn * d, d))
        self.drop = nn.Dropout(dropout)

    def forward(
        self, x: torch.Tensor, enc: torch.Tensor, enc_mask: torch.Tensor, causal: torch.Tensor
    ) -> torch.Tensor:
        h = self.ln1(x)
        a, _ = self.self_attn(h, h, h, attn_mask=causal, need_weights=False)
        x = x + self.drop(a)
        h = self.ln2(x)
        a, _ = self.cross_attn(h, enc, enc, key_padding_mask=~enc_mask, need_weights=False)
        x = x + self.drop(a)
        return x + self.drop(self.ff(self.ln3(x)))


class Decoder(nn.Module):
    """Seq2seq baseline: encoder + small autoregressive decoder emitting span triples.

    Output formulation: `BOS (role start end)* EOS` over the vocabulary
    [roles..., token positions 0..47, BOS, EOS]; see spans.Grammar for the constraints
    (increasing positions, no overlap, end >= start, positions inside the input). Because every
    emitted position indexes an input token, the output is grounded by construction. The
    separator token from the original sketch is dropped: triples have fixed arity, so it is
    redundant. Spans are converted to BIO for scoring. The output projection is tied to the token
    embedding. Decoding is greedy and re-runs the decoder over the whole prefix each step (no KV
    cache), which is cheap at these sizes but slightly pessimistic for latency.
    """

    def __init__(self, config: DecoderConfig, labels: Labels, label_smoothing: float = 0.0):
        super().__init__()
        self.config, self.labels, self.label_smoothing = config, labels, label_smoothing
        self.grammar = Grammar(labels)
        d = config.d
        self.encoder = Encoder(
            d, config.d_b, config.enc_layers, config.heads, config.ffn, config.dropout
        )
        self.tok = nn.Embedding(self.grammar.vocab_size, d)
        self.pos = nn.Embedding(self.grammar.max_steps + 1, d)
        self.drop = nn.Dropout(config.dropout)
        self.blocks = nn.ModuleList(
            DecoderBlock(d, config.heads, config.ffn, config.dropout)
            for _ in range(config.dec_layers)
        )
        self.ln = nn.LayerNorm(d)

    def decode_states(
        self, ys: torch.Tensor, enc: torch.Tensor, enc_mask: torch.Tensor
    ) -> torch.Tensor:
        s = ys.shape[1]
        x = self.drop(self.tok(ys) + self.pos(torch.arange(s)))
        causal = torch.triu(torch.ones(s, s, dtype=torch.bool), diagonal=1)
        for block in self.blocks:
            x = block(x, enc, enc_mask, causal)
        return self.ln(x) @ self.tok.weight.T

    def _gold_spans(self, batch: Batch) -> list[list]:
        names = self.labels.names
        out = []
        for i, n in enumerate(batch.lengths.tolist()):
            tags = [names[t] for t in batch.tags[i, :n].tolist()]
            out.append(bio_to_spans(tags))
        return out

    def loss(self, batch: Batch) -> torch.Tensor:
        g = self.grammar
        targets, masks = [], []
        for spans, n in zip(self._gold_spans(batch), batch.lengths.tolist(), strict=True):
            target = g.encode(spans)
            targets.append(target)
            masks.append(g.masks_for(target, n))
        b, s = len(targets), max(len(t) for t in targets)
        tgt = np.full((b, s), -100, dtype=np.int64)
        allowed = np.ones((b, s, g.vocab_size), dtype=bool)
        dec_in = np.full((b, s), g.eos, dtype=np.int64)
        for i, (t, m) in enumerate(zip(targets, masks, strict=True)):
            tgt[i, : len(t)] = t
            allowed[i, : len(t)] = m
            dec_in[i, : len(t)] = [g.bos, *t[:-1]]
        enc = self.encoder(batch)
        logits = self.decode_states(torch.from_numpy(dec_in), enc, batch.mask)
        logits = logits.masked_fill(~torch.from_numpy(allowed), -1e9)
        return F.cross_entropy(
            logits.reshape(-1, g.vocab_size),
            torch.from_numpy(tgt).reshape(-1),
            ignore_index=-100,
            label_smoothing=self.label_smoothing,
        )

    @torch.no_grad()
    def predict_spans(self, batch: Batch) -> list[list]:
        """Greedy constrained decoding; returns role spans per example."""
        g = self.grammar
        lengths = batch.lengths.tolist()
        b = len(lengths)
        enc = self.encoder(batch)
        ys = torch.full((b, 1), g.bos, dtype=torch.long)
        out: list[list[int]] = [[] for _ in range(b)]
        done = [False] * b
        prev_end, start = [-1] * b, [0] * b
        for step in range(g.max_steps):
            logits = self.decode_states(ys, enc, batch.mask)[:, -1]
            allowed = np.stack(
                [g.allowed_next(step, prev_end[i], start[i], lengths[i]) for i in range(b)]
            )
            logits = logits.masked_fill(~torch.from_numpy(allowed), -1e9)
            chosen = logits.argmax(dim=-1).tolist()
            for i, tok in enumerate(chosen):
                if done[i]:
                    chosen[i] = g.eos
                    continue
                out[i].append(tok)
                if step % 3 == 1:
                    start[i] = tok - g.pos_base
                elif step % 3 == 2:
                    prev_end[i] = tok - g.pos_base
                done[i] = tok == g.eos
            ys = torch.cat([ys, torch.tensor(chosen).unsqueeze(1)], dim=1)
            if all(done):
                break
        return [g.decode(ids) for ids in out]

    @torch.no_grad()
    def predict(self, batch: Batch) -> list[list[int]]:
        ids = self.labels.id_of
        return [
            [ids[t] for t in spans_to_bio(spans, n)]
            for spans, n in zip(self.predict_spans(batch), batch.lengths.tolist(), strict=True)
        ]


def build_model(kind: str, config_name: str, labels: Labels, label_smoothing: float = 0.0):
    if kind == "tagger":
        return Tagger(TAGGER_CONFIGS[config_name], labels, label_smoothing)
    if kind == "decoder":
        return Decoder(DECODER_CONFIGS[config_name], labels, label_smoothing)
    raise ValueError(f"unknown model kind {kind!r}")


def config_to_dict(model: Tagger | Decoder) -> dict:
    return asdict(model.config)
