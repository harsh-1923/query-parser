# training

Python (PyTorch, CPU, managed with `uv`) for spike S1: train the BIO tagger and the seq2seq
baseline, evaluate them identically, and later export int8 weights into `packages/model`.
Not part of the pnpm workspace. Python 3.12.

## Setup

```sh
cd training
uv sync
uv run pytest
uv run ruff check . && uv run ruff format .
```

## Train

```sh
uv run python -m qp_train.train --model tagger --config medium \
  --train ../eval/datasets/generated/v0/train.jsonl \
  --val ../eval/datasets/generated/v0/val.jsonl \
  --epochs 30 --batch 128 --lr 3e-3 --seed 42 --out runs/tagger-medium
```

AdamW, linear warmup then cosine decay, gradient clipping, optional `--label-smoothing`, early
stopping on val span F1 (`--patience`, default 5). Runs are deterministic for a given seed and
`--threads`. Each epoch logs loss, val token accuracy, val span F1 and seconds; `runs/<name>/`
gets `best.pt`, `config.json` and `log.jsonl`.

## Evaluate

```sh
uv run python -m qp_train.evaluate --run runs/tagger-medium \
  --data ../eval/datasets/generated/v0/test-generated.jsonl \
  --data2 ../eval/datasets/llm-written/v0/bio.jsonl
```

Prints, per file: span P/R/F1 (exact role and boundaries) overall and per role, exact-match
sequence rate, names with vs without a cue word (cue = previous token in from/by/to/with/
mentioning/cc/assigned), and per `source` prefix. Then single-query latency (batch 1, 1 thread,
10 tokens, p50/p95 over 500 runs). Everything is also written to `runs/<name>/eval.json`.
`--no-latency` skips the timing.

## Models

Data is read as given (`tokens`, never re-tokenized); labels come from
`eval/fixtures/labels.json`. Each token is up to 16 UTF-8 bytes (+1, 0 = pad); queries are capped
at 48 tokens.

Tagger: byte embedding, Conv1d (k=3), masked max-pool, linear to `d`; learned position embedding;
`L` pre-LN bidirectional transformer layers; linear head to 23 logits. Decoding is Viterbi with
illegal BIO transitions masked (`decoding.py`), which also provides token marginals and
min-marginal span confidence.

| Config | d | d_b | layers | heads | ffn x | Params |
|---|---|---|---|---|---|---|
| tagger `small` | 38 | 12 | 2 | 2 | 2 | 30,759 |
| tagger `medium` | 64 | 16 | 2 | 4 | 2 | 77,623 |
| tagger `large` | 64 | 24 | 3 | 4 | 3 | 139,399 |
| decoder `base` | 56 | 16 | 1 enc + 1 dec | 2 | 2 | 79,264 |

Decoder baseline: same encoder, plus a small autoregressive transformer decoder that emits
`BOS (role start end)* EOS` over the vocabulary [roles, positions 0..47, BOS, EOS]. A grammar
(`spans.py`) allows only increasing, non-overlapping positions with end >= start, inside the
input, so output is always grounded; it is applied in training (teacher-forced masks) and in
greedy decoding. Spans are converted to BIO for scoring. No KV cache, so decoder latency is
slightly pessimistic.

## Tests

`tests/fixtures/toy.jsonl` is a 400-line templated dataset (`make_toy.py`, seeded) used by the
tests; it is not real data.
