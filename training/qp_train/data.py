"""Loading BIO JSONL, byte-encoding tokens, and batching.

Tokens are never re-tokenized: the `tokens` field of each line is used as given.
"""

from __future__ import annotations

import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch

MAX_TOKENS = 48  # queries longer than this are truncated
MAX_BYTES = 16  # bytes kept per token
PAD_BYTE = 0  # byte b is stored as b + 1, so 0 is free for padding
BYTE_VOCAB = 257

LABELS_PATH = Path(__file__).resolve().parents[2] / "eval" / "fixtures" / "labels.json"


class Labels:
    """The BIO label set, read from eval/fixtures/labels.json (never hard-coded)."""

    def __init__(self, names: Sequence[str]):
        self.names = list(names)
        self.id_of = {name: i for i, name in enumerate(self.names)}
        # Roles in label order, e.g. KIND, ACTOR, ...
        self.roles = [n[2:] for n in self.names if n.startswith("B-")]
        self.role_id = {role: i for i, role in enumerate(self.roles)}

    def __len__(self) -> int:
        return len(self.names)

    @classmethod
    def load(cls, path: Path | str = LABELS_PATH) -> Labels:
        return cls(json.loads(Path(path).read_text())["labels"])


@dataclass
class Example:
    text: str
    tokens: list[str]
    offsets: list[tuple[int, int]]
    tags: list[str]
    source: str
    bytes_ids: np.ndarray  # (n, MAX_BYTES) int64, values in 0..256
    tag_ids: np.ndarray  # (n,) int64
    # True for typed-operator tokens (from:priya). The runtime binds them before the tagger runs,
    # so their predicted labels are discarded; scoring does the same.
    operators: list[bool] | None = None

    def __len__(self) -> int:
        return len(self.tokens)


def encode_token(token: str) -> np.ndarray:
    """UTF-8 bytes shifted by +1, truncated/padded with 0 to MAX_BYTES."""
    raw = token.encode("utf-8")[:MAX_BYTES]
    out = np.zeros(MAX_BYTES, dtype=np.int64)
    out[: len(raw)] = np.frombuffer(raw, dtype=np.uint8).astype(np.int64) + 1
    return out


def make_example(row: dict, labels: Labels) -> Example:
    tokens = list(row["tokens"])[:MAX_TOKENS]
    tags = list(row["tags"])[:MAX_TOKENS]
    if len(tokens) != len(tags):
        raise ValueError(f"tokens/tags length mismatch in {row['text']!r}")
    return Example(
        text=row["text"],
        tokens=tokens,
        offsets=[(s, e) for s, e in row["offsets"][:MAX_TOKENS]],
        tags=tags,
        source=row.get("source", ""),
        bytes_ids=np.stack([encode_token(t) for t in tokens]),
        tag_ids=np.array([labels.id_of[t] for t in tags], dtype=np.int64),
        operators=list(row["operators"])[:MAX_TOKENS] if "operators" in row else None,
    )


def load_jsonl(path: Path | str, labels: Labels) -> list[Example]:
    """Read a BIO file. Lines with no tokens are skipped (a model needs at least one token)."""
    examples = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            if row["tokens"]:
                examples.append(make_example(row, labels))
    return examples


@dataclass
class Batch:
    bytes_ids: torch.Tensor  # (B, T, MAX_BYTES) long
    mask: torch.Tensor  # (B, T) bool, True on real tokens
    tags: torch.Tensor  # (B, T) long, 0 (= "O") on padding
    lengths: torch.Tensor  # (B,) long


def collate(examples: Sequence[Example]) -> Batch:
    b = len(examples)
    t = max(len(e) for e in examples)
    bytes_ids = np.zeros((b, t, MAX_BYTES), dtype=np.int64)
    tags = np.zeros((b, t), dtype=np.int64)
    mask = np.zeros((b, t), dtype=bool)
    for i, e in enumerate(examples):
        n = len(e)
        bytes_ids[i, :n] = e.bytes_ids
        tags[i, :n] = e.tag_ids
        mask[i, :n] = True
    return Batch(
        bytes_ids=torch.from_numpy(bytes_ids),
        mask=torch.from_numpy(mask),
        tags=torch.from_numpy(tags),
        lengths=torch.tensor([len(e) for e in examples]),
    )


def iter_batches(
    examples: Sequence[Example],
    batch_size: int,
    *,
    shuffle: bool = False,
    seed: int = 0,
    epoch: int = 0,
) -> Iterator[tuple[list[Example], Batch]]:
    """Yield (examples, batch). Shuffling is a pure function of (seed, epoch)."""
    order = np.arange(len(examples))
    if shuffle:
        order = np.random.default_rng([seed, epoch]).permutation(len(examples))
    for start in range(0, len(order), batch_size):
        chunk = [examples[i] for i in order[start : start + batch_size]]
        yield chunk, collate(chunk)
