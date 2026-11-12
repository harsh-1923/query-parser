# 0004: Fine-tune a small pretrained model instead of training a tagger from scratch

Status: proposed · Date: 2026-11-12 · Evidence: [S01](../spikes/S01-tagger-vs-seq2seq.md),
[S07](../spikes/S07-lexicon-features.md), [prior art](../prior-art.md), design review on 2026-11-12

## Context

The tagger in PLAN §6 is a ~78k-parameter transformer trained from scratch on generated data. It
reads bytes and has no prior knowledge of English: everything it knows comes from our templates
and paraphrases.

It has not cleared the bar:

- S1 round 2: span F1 0.744 on S02 and 0.636 on GLM, against the rule tagger's 0.727 and 0.726.
  Bar was 0.85.
- S7: adding the rule labels and alias lists as inputs helps (about 0.78 S02 / 0.75 GLM), but on
  GLM it only ties the rules within noise. Checkpoint selection stops at epoch 2–5 because the
  model mostly learns to copy the rule labels.
- The most common error in [failure-modes.md](../failure-modes.md) is a kind word inside a longer
  topic ("vendor **call**", "sprint retro **notes**"). Telling those apart takes knowledge of what
  words mean, which a model that has only seen our templates doesn't have.

A design review on 2026-11-12 recommended the usual fix: start from a model that was pretrained on
a large amount of text, fine-tune it on our task with LoRA, build the benchmark before training,
and stay under about 2B parameters so it runs in a browser on WebGPU.

The same review proposed routing hard queries to a hosted LLM inside the SDK. We are not doing
that: falling back to an LLM is the application's decision, made from the confidence we return.

## Options

1. **Keep the from-scratch tagger** and push data and features further (S7 follow-ups).
2. **Fine-tune a small pretrained encoder as a BIO tagger** (candidate A). Same task formulation as
   today, with a pretrained encoder instead of the byte encoder. Candidates: Ettin encoder 17M/32M,
   the EmbeddingGemma 2 text encoder (270M).
3. **Fine-tune a small pretrained decoder LLM to write the parse** (candidate B), with constrained
   decoding so the output is valid and every value is a substring of the query. Candidates:
   LFM2.5-1.2B, Qwen3-0.6B.
4. **Call a hosted LLM from the SDK** when the local model is unsure.

## Decision

Options 2 and 3 as candidates, chosen by the benchmark; not 1, not 4.

- **Benchmark first.** No candidate is trained until the benchmark in PLAN §10 exists, with a
  private handwritten holdout that is never trained on.
- **A before B.** Extraction is a tagging task, and A keeps the runtime small and the grounding
  rule (AGENTS rule 4) true by construction. B is tried if A misses the target.
- **LoRA SFT first.** No reinforcement learning until SFT has plateaued on the benchmark.
- **The SDK never calls an LLM.** It returns a calibrated confidence per span and per query
  (PLAN §4, §6.5). An application that wants a fallback compares that confidence with its own
  threshold and calls whatever it likes. That keeps rule 3 (no network in `packages/`) intact.
- **The current tagger and the rules stay** as baselines to beat and as fallbacks for environments
  without WebGPU.

## Consequences

- **Size and speed goals change** (PLAN §1 goals 2 and 6). Weights go from ~310 KB to tens of MB
  (A) or about 0.5–1 GB (B). Latency goes from ~1 ms to whatever the benchmark measures; it is
  reported, not assumed.
- **`@qp/model` gains a runtime dependency** for pretrained inference (ONNX Runtime Web through
  Transformers.js, or WebLLM for B). Per AGENTS rule 5, the PR that adds it says why.
- **Training moves to a GPU** (a rented GPU or Colab). `training/` keeps `uv`; LoRA SFT and export
  to ONNX replace the from-scratch trainer once a candidate wins.
- **Calibration becomes a release gate,** not a nice-to-have: S8 moves up, and ECE is reported next
  to span F1 for every candidate.
- **TS ↔ Python parity** (rule 6) still applies: each exported candidate gets a parity fixture.
- **S1 and S7 are closed** as the from-scratch line of work. Their code stays in `spikes/` and
  `training/` until a pretrained candidate replaces it.
- Supersedes nothing yet. If candidate B wins, it partly supersedes PLAN §6.1's "tagger, not text
  generation" and needs its own record.
