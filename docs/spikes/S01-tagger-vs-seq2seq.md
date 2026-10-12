# S01: Tagger vs seq2seq, and model size — result

Date: 2026-10-12 · Status: **fail on accuracy, pass on architecture**; round 2 closes most of the gap
(see [Round 2](#round-2-generator-v1--paraphrases)) · Decision: the BIO tagger (medium, ~78k params)
is the model; data is the bottleneck

## Question

Can a tiny model trained only on template-generated data tag real queries? How small can it be, and
is a per-token tagger better than a seq2seq model with constrained decoding?

Pass bar, set before running: some tagger reaches **≥ 0.85 span F1 on `test-llm-written`** from
template-only data, and its forward pass beats the decoder on latency.

## What was run

- **Data.** `@qp/datagen` v0, seed 42.
  - 50,000 train, 2,000 val and 3,000 `test-generated` examples from 85 templates.
  - 17 templates are held out for `test-generated`, and that split uses the disjoint test name pool.
  - Kinds and states come from the curated S05 v1 vocabulary; topics, containers and groups come
    from kimi-k3 lexicons.
  - There are no paraphrases yet (PLAN §9.2 step 4).
- **Test set.** S02's 205 queries converted to BIO under [`eval/ANNOTATION.md`](../../eval/ANNOTATION.md).
  204 remain; [`normalization.log`](../../eval/datasets/llm-written/v0/normalization.log) lists
  every change.
- **Models** ([`training/`](../../training/)). All trained on CPU for up to 30 epochs, with early
  stopping on val F1 and seed 42.
  - Three byte-level transformer taggers with constrained Viterbi: small (30,759 params), medium
    (77,623) and large (139,399).
  - One seq2seq decoder (79,264) that emits (role, start, end) triples under a grammar that keeps
    output grounded in the input.
- **Rule baseline.** The M2 rule tagger, scored by the same code on the same BIO file
  ([`eval/rule-predict.ts`](../../eval/rule-predict.ts)).

## Results

From [`eval/results/s1/`](../../eval/results/s1/):

| Model | Params | Val F1 | `test-generated` F1 | **S02 F1** | S02 exact match | p50 latency, Python CPU 1 thread, 10 tokens |
|---|---|---|---|---|---|---|
| Rule tagger | – | – | – | **0.716** | 43.6% | – |
| Tagger small | 30,759 | 0.973 | 0.798 | 0.556 | 25.0% | 0.20 ms |
| Tagger medium | 77,623 | 0.995 | 0.852 | **0.580** | 29.4% | 0.21 ms |
| Tagger large | 139,399 | 0.998 | 0.855 | 0.572 | 26.5% | 0.27 ms |
| Seq2seq | 79,264 | 0.982 | 0.635 | 0.440 | 18.6% | 1.12 ms |

**The bar is not met.** The best model reaches 0.58 on S02, below both the 0.85 bar and the rule
baseline (0.716). The latency half passes: the tagger's forward pass plus Viterbi is about 5× faster
than the decoder.

### What the numbers say

1. **Tagger beats seq2seq clearly:** +14 points on S02, +22 on held-out templates, ~5× faster. That
   question is settled.
2. **Size isn't the limit.** Going from 31k to 139k params moves S02 F1 by 2–3 points; medium and
   large are tied. Medium is the sweet spot.
3. **The models learned the templates, not the language.**
   - Val F1 is 0.99, held-out templates 0.85, and real queries 0.58.
   - The error analysis ([`errors-tagger-medium-s02.txt`](../../eval/results/s1/errors-tagger-medium-s02.txt))
     shows position-driven mistakes. In "latest version **of** the pitch deck" the word "of" is
     tagged KIND; "q2" and "draft" are missed in an unfamiliar order.
   - Totals: 44 spurious KIND, 35 missed TOPIC, 21 missed KIND, 21 missed ATTR, 20 spurious ACTOR.
4. **The generator under-samples what real queries contain.**
   - States appear in 7% of generated sentences against 23% of S02 queries.
   - Real topics are longer and sit next to kinds ("budget sheet v3 final"), which no template does.
   - Kinds at the end of a query ("tokenization pdf ppt") are rare in the templates.

### S3 from the same runs (interim)

Names with and without a cue word, for the medium tagger:

| | With cue: R / F1 | Without cue: R / F1 |
|---|---|---|
| `test-generated` (unseen test-pool names) | 0.84 / 0.86 | 0.81 / 0.77 |
| S02 | 0.82 / 0.70 | 0.57 / 0.46 |
| Rule tagger, S02 | 0.80 / 0.77 | 0.63 / 0.61 |

S3's bar (recall ≥ 0.95 with cue, ≥ 0.85 without) is not met either. Byte-level encoding does carry
over to unseen names: generated no-cue recall is 0.81 on names the model never saw. Real-query
context is the gap, as above. S3 stays open until the data is fixed.

## Decision

- **Architecture: BIO tagger, medium config (~78k params).** Seq2seq is dropped. Large isn't worth
  the extra 60k params.
- **The model does not ship yet.** The rule tagger stays the default (PLAN §10.2) until the model
  beats it on S02.
- **The spike's fallbacks don't apply.** It said "if it fails, try the decoder, then revisit roles
  or size". The decoder is worse, size doesn't help, and S02 showed the roles are fine. The failure
  is the training data, which the plan expected paraphrases to fix in M3. Next:
  1. **Generator v1:**
     - more word orders (kinds last, states anywhere, topics adjacent to kinds);
     - state frequency matched to S02's share;
     - longer and messier topics;
     - a "seen templates × unseen names" slice for S3.
  2. **Paraphrases** (PLAN §9.2 step 4). kimi-k3, a different family from the Haiku that wrote S02,
     rewrites a sample of template sentences. Labels are re-aligned by slot values, and unalignable
     ones are dropped.
  3. **Retrain medium** and re-run exactly this evaluation. The gate is S02 F1 > 0.716, then 0.85.
- **Measure, don't tune, on S02.** S02 is used here for evaluation only. Generator changes come from
  the error *categories* above, not from copying its queries. The contamination check stays on. A
  second LLM-written test set (PLAN §9.3, ≥ 2 model families) is needed before we trust gains.

## Caveats

- S02 has 204 queries, so per-role numbers on small roles (MENTION 0, PARTICIPANT 7, ORDER 12) are
  noise.
- The rules' kind/state lists were written from S02's spans (S05 v1). That gives the rule baseline a
  home advantage on KIND and ATTR, but the generator used the same lists.
- Latency here is PyTorch on CPU; S06 measures the TypeScript runtime that will ship.

## Round 2: generator v1 + paraphrases

Same model (tagger medium, 77,623 params) and training settings, retrained on `@qp/datagen` v1.
- **Training data:** 71,154 lines.
- **Word orders:** a bag-of-slots family that moves every role to the start, middle and end.
- **Role rates:** per-role query rates matched to real queries (ATTR 20–25%, up from 7%).
- **Topics and negation:** messier topics and natural negation.
- **Paraphrases:** 5,616 kimi-k3 paraphrases aligned back to labels, with the canonical echoes kept.

A second test set now exists: 300 queries written by **GLM** (`eval/datasets/llm-written/v1/`), a
different model family from S02's Claude Haiku. It was labeled by an agent that saw no model output.
The generator changes were designed from S02's *error categories*. GLM was never looked at, which
makes it the cleaner number.

**Scoring fix.** Typed operators (`from:priya`, `in:#x`) are bound before the tagger runs (PLAN
§5.8), so their predicted labels are thrown away at runtime. The scorers now do the same for both
the models and the rules: the `operators` field in the fixture format, and `mask_operators` in
`evaluate.py`. This mostly affects GLM, where 55 of 300 queries contain operators. All numbers
below use it.

| | Rules | Tagger medium, v0 data | **Tagger medium, v1 data** |
|---|---|---|---|
| S02 (204) | 0.727 | 0.580 | **0.744** |
| GLM v1 (300) | 0.726 | 0.542 | **0.636** |
| `test-generated` v1 (held-out shapes, unseen names) | – | – | 0.961 |
| `test-seen-templates-unseen-names` (S3) | – | – | 0.964 |

From [`eval/results/s1b/`](../../eval/results/s1b/).

- **Data was the bottleneck, as diagnosed.**
  - Same model, better data: +16 points on S02 and +9 on GLM.
  - On S02 the model now edges past the rules (+1.7).
  - On GLM it is still 9 points behind. Its weakest spots there are names with no cue word (F1
    0.31, precision 0.24, so it calls ordinary words people) and TOPIC (≈0.50).
- **The 0.85 bar is still not met** on either LLM-written set.
- **S3 on generated data now passes its bar.**
  - With unseen test-pool names in familiar templates, recall is 0.973 with a cue word (bar 0.95)
    and 0.852 without (bar 0.85).
  - On S02 no-cue recall is 0.80; on GLM it is 0.44.
  - Name recognition generalizes to new names but not yet to GLM's phrasing.

**Next:**
1. Error analysis on GLM's no-cue names and topics: the GLM numbers are measured, not tuned to.
2. More paraphrase variety. A second paraphrasing family isn't possible with this gateway key
   (Gemini isn't enabled), so use a different prompt or style per batch.
3. A real-query set from Xyne Spaces' search logs, if one can be had, is still the strongest test
   (PLAN §16 Q1).
4. The rules stay the default until the model clearly beats them on both sets.
