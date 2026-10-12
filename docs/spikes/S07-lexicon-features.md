# S7: lexicon and rule features as tagger inputs

**Status:** done. Inputs help; whether the model beats the rules depends on when training stops.
Branch: `spike/lexicon-features`.

## Hypothesis

From [prior-art.md](../prior-art.md) item 1: give the tagger what the product already knows at
parse time, and it gets past the rule baseline (0.727 S02 / 0.726 GLM). Production query
taggers (Snips, Amazon RA-NER) do this.

Today the model reads only bytes (PLAN §6.2), and the directory is consulted only after tagging.

## What was run

- **Features** ([featurize.ts](../../spikes/S07-lexicon-features/featurize.ts)). Each token gets:
  - the rule tagger's BIO label;
  - whether it is part of a kind alias, and whether it is part of an attribute alias (S05 v1
    lists, up to 3 words);
  - whether it is a name in the directory.
- **Directory.** The `@qp/datagen` name pools play the directory:
  - train pool for training;
  - all pools for S02 and GLM. That covers only 36/94 (S02) and 30/55 (GLM) of the gold person
    tokens; part of the gap is self words ("me", "my"), which are resolved separately.
  - "oracle" adds the people actually named. That is closer to a real company directory, which
    contains almost everyone a user searches for.
- **Model.** `medium-feat`: the medium tagger plus a rule-label embedding and a linear layer for
  the three bits. 79,351 params, vs 77,623 for medium.
  - In training, each feature group (rules, aliases, names) is zeroed per example with
    probability 0.3. One model can therefore be scored with any group switched off.
- **Training.** Same data and seed as S1 round 2: `@qp/datagen` v1, seed 42, 60k train.
- **Scoring.** Span F1 with exact role and boundaries, using `qp_train.evaluate`.
- **Reproduce:** `spikes/S07-lexicon-features/run.sh`.

## Numbers (single seed)

Span F1. Results: [eval/results/s7/](../../eval/results/s7/). The "epoch 9" and "epoch 11" runs were
cut off by a 2-hour time limit. "Full" runs trained up to 30 epochs with early stopping (patience 5)
on generated val data; the feature model's best epoch was 23.

| System | S02 (204) | GLM (300) |
|---|---|---|
| Rules (`pnpm eval`) | 0.727 | 0.726 |
| Baseline medium, epoch 11 | 0.717 | 0.669 |
| Baseline medium, full | 0.748 | 0.671 |
| Feature model, epoch 9, all inputs | 0.778 | **0.752** |
| Feature model, full: no inputs given | 0.681 | 0.645 |
| … + rule labels | 0.773 | 0.690 |
| … + kind/attr aliases | 0.773 | 0.694 |
| … + directory (name pool) | 0.784 | 0.698 |
| … + directory (oracle) | **0.792** | 0.701 |

Latency of the feature model: forward + Viterbi p50 1.2–1.3 ms (batch 1, 1 thread, PyTorch,
`qp_train.evaluate`). The rule tagger, which now has to run first, hasn't been timed.

## Reading

- **The inputs help the model reliably.** Fully trained, the feature model beats the fully
  trained baseline by +3.6 on S02 and +2.7 on GLM.
- **Almost all of the gain comes from the rule labels.**
  - Names add about +1 on S02 and +0.4 on GLM.
  - The oracle directory adds about +0.8 more on S02 and +0.3 on GLM. These sets have few
    cue-less names, so there's little for a directory to fix.
- **Whether the model beats the rules depends on when training stops.**
  - On S02 it beats the rules at every checkpoint (+5 to +6).
  - On GLM it beats the rules at epoch 9 (+2.6) but loses to them after full training (−2.8).
  - Validation F1 on generated data keeps rising (0.972 → 0.983) while GLM falls. With more
    epochs, the model learns to override the rules in ways that only pay off on generated
    queries.
- **We are selecting checkpoints on the wrong data.** Generated val measures fit to the
  templates, not to queries written by others. This probably affected S1 too.
- **Still far from the 0.85 bar.** A single seed and 204–300 queries give about ±3 F1 of noise;
  the GLM swing (5.4) is bigger than that.

## Decision

1. **Don't write the ADR yet.** The features are worth keeping on the spike branch, but the
   evidence for "the model beats the rules" isn't stable.
2. **Add an LLM-written dev set** for checkpoint selection and early stopping:
   - a third model family, a few hundred queries, never used for training or as a test set;
   - this needs the LLM gateway, so it runs on the laptop.

   Then rerun S7 with selection on that set, ideally with 3 seeds.
3. **If it holds,** write ADR 0004 "runtime rule and lexicon features as tagger input", update
   PLAN §6.2, and pin the featurizer with a TS ↔ Python fixture (AGENTS rule 6).
4. **The real test is the Xyne Spaces data.** Both LLM-written sets are stand-ins.
