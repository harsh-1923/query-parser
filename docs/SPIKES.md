# Spikes

Short, time-boxed experiments that test the assumptions in [PLAN.md](PLAN.md) before we build on
them. Each spike has a hypothesis, a method, a pass/fail bar set **before** running it, and a
time box. Results go in `docs/spikes/SNN-<name>.md`; the decision it leads to goes in a decision
record if it changes the plan.

Spike code lives in `spikes/SNN-<name>/` and is throwaway: it doesn't need tests or polish, and
nothing in `packages/` may import it.

Suggested order: S2 → S4 → S1 → S3 → S6, with S5, S7, S8 alongside M3–M4.

| # | Question | Blocks | Time box |
|---|---|---|---|
| S1 | Tagger or seq2seq? How small can it be? **Done: tagger (medium, 78k) wins. Round 2 data: 0.744 S02 / 0.636 GLM vs rules 0.727 / 0.726; bar 0.85 not met** ([result](spikes/S01-tagger-vs-seq2seq.md)) | M4 | 2 days |
| S2 | Does the role set cover real queries? **Done: pass with ADR 0002** ([result](spikes/S02-role-coverage.md)) | M2 | ½ day |
| S3 | Can it spot names without cue words, including unseen Indian names? **Interim: not yet (no-cue recall 0.57 on S02); waits on data fixes** ([numbers](spikes/S01-tagger-vs-seq2seq.md#s3-from-the-same-runs-interim)) | M4 | 1 day |
| S4 | Hand-written time grammar or chrono-node? **Done: pass, grammar only ([ADR 0003](decisions/0003-time-grammar-no-chrono.md))** ([result](spikes/S04-time-normalization.md)) | M2 | 1 day |
| S5 | Do alias lists cover kinds and attributes, or do we need embeddings? **Done: fails the bar (85.4% on fresh data); aliases stay, no embeddings in core, `unknownKind` hook** ([result](spikes/S05-kind-attr-vocab.md)) | M2 | ½ day |
| S6 | Is plain-JS CPU inference fast enough on a mid-range phone? **Done: pass (medium 1.2 ms laptop, 8 ms at 6× CPU throttle; no real phone yet)** ([result](spikes/S06-runtime.md)) | M4 | ½ day |
| S7 | How big is the synthetic-to-handwritten gap? | M4 | runs with M3/M4 |
| S8 | Can confidence be calibrated, and do negatives teach "nothing to extract"? | M4 | runs with M4 |

---

## S1: Tagger vs seq2seq, and model size

**Hypothesis.** A BIO tagger with byte-level token encoding reaches ≥ 0.90 span F1 on a
handwritten set at ≤ 150k parameters, and beats a same-size seq2seq model with constrained
decoding on accuracy and latency.

**Method.**
- Generate ~50k examples with a minimal template generator (no paraphrases yet).
- Train three taggers (~30k, ~80k, ~150k params) and one gpu-cron-style decoder (~80k) on CPU.
- Evaluate on `test-llm-written` (S02's 205 queries, re-tagged in BIO) and a held-out-name set
  built from the test name pool in `spikes/names/`.

**Pass.** Some tagger size reaches ≥ 0.85 span F1 on `test-llm-written` from template-only data
(paraphrases in M3 should add the rest), and its single forward pass beats the decoder on latency.

**If it fails.** Try the decoder with a substring-copy constraint; if both fail, revisit the role
set (S2) or increase size.

## S2: Role coverage

**Hypothesis.** ≥ 95% of real search queries can be fully expressed with the 11 roles.

**Method.**
- Collect ~200 queries. No real logs were available, so cheap LLM subagents (Claude Haiku) wrote
  them per product persona (chat, email, tracker, drive, workspace), without being told about roles.
- Hand-tag each with roles. Record every query that needs something the roles can't express.

**Pass.** ≥ 95% fully expressible, and the misses don't cluster into one missing role.

**If it fails.** Add the missing role (ADR) or decide it's out of scope.

## S3: Names without cue words

**Hypothesis.** Byte-level token features plus context find person names in "utkarsh pdfs" and
"rahul's deck" style queries, including name origins and spellings not seen in training, at ≥ 0.85
recall.

**Method.** Train the S1 tagger on the train name pool from `spikes/names/`, test on its disjoint test pool (Indian first names,
transliteration variants, handles, lowercase, typos). Slice by cue/no-cue.

**Pass.** ≥ 0.95 recall with cue words, ≥ 0.85 without.

**If it fails.** Lean on `promoteKnownEntities` (directory lookup on leftover tokens, suggestions
only), and say so in the docs.

## S4: Time normalization

**Hypothesis.** A small hand-written grammar over isolated `TIME` spans covers ≥ 95% of the time
phrases in the S2 query set, in under 10 KB gzipped, deterministically.

**Method.**
- Extract every time phrase from the S2 set, plus a list of 200 written to cover the families in
  PLAN §8.
- Implement the grammar for those families with explicit policies; compare against `chrono-node`
  on the same list (coverage, disagreements, bundle size, behavior around week starts and
  `dayFirst`).

**Pass.** Grammar coverage ≥ 95% with zero wrong answers (an `unsupported` is acceptable, a wrong
range is not).

**If it fails.** Use chrono-node behind the `@qp/time` interface, with our policies applied on top.

## S5: Kind and attribute vocabulary

**Hypothesis.** Alias lists with normalization and edit-distance matching resolve ≥ 95% of `KIND`
and `ATTR` spans in the S2 set; an embedding fallback isn't needed for v1.

**Method.** Write the Xyne Spaces kind/attr aliases, run every `KIND`/`ATTR` span from S2 through
the matcher, inspect misses.

**Pass.** ≥ 95% resolved correctly, misses are fixable by adding aliases.

**If it fails.** Design the `unknownKind` hook around a tiny static-embedding table (not a
runtime model).

## S6: Runtime performance

**Hypothesis.** Plain TypeScript inference for a ≤ 150k-parameter tagger runs a 10-token query in
≤ 5 ms p95 on a laptop and ≤ 20 ms on a mid-range Android phone, including resolution against a
1,000-person directory.

**Method.** Benchmark random weights of the target shape (accuracy doesn't matter here) with
`Float32Array` matmuls and int8 dequantization, in Node, desktop Chrome and a real mid-range phone.

**Pass.** Both budgets met without WebGPU or WASM SIMD.

**If it fails.** Try WASM SIMD; WebGPU only as a last resort, since it rules out React Native and
Node.

## S7: Synthetic-to-handwritten gap

**Hypothesis.** The gap between span F1 on generated test data and on handwritten data is ≤ 10
points once paraphrases and the canonical echo are in the training set.

**Method.** Track both numbers across data-generator versions in M3/M4; slice the gap to find which
template families are missing.

**Pass.** Gap ≤ 10 points.

**If it fails.** Treat the biggest slices as generator bugs (the gpu-cron lesson) before touching
the model.

## S8: Confidence and negatives

**Hypothesis.** Training with ~10% negatives gives ≥ 0.95 negative precision without hurting
positive span F1 by more than 1 point, and temperature scaling yields expected calibration error
≤ 0.05.

**Method.** Train with and without negatives, compare; fit a temperature on `val`, measure ECE on
the handwritten set.

**Pass.** Both thresholds met.

**If it fails.** Use a separate tiny "is this a filter query?" classifier head.
