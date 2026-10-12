# S7: lexicon and rule features as tagger inputs

**Status:** interim. These checkpoints stopped early, at a 2-hour time limit (baseline: epoch 11,
feature model: epoch 9). Fully trained runs are pending; this page will be updated with them.
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

## Numbers (interim, single seed)

Span F1. Results: [eval/results/s7/](../../eval/results/s7/).

| System | S02 (204) | GLM (300) |
|---|---|---|
| Rules (`pnpm eval`) | 0.727 | 0.726 |
| Baseline medium, epoch 11 | 0.717 | 0.669 |
| Feature model, no features given | 0.615 | 0.592 |
| + rule labels | 0.765 | 0.745 |
| + kind/attr aliases | 0.762 | 0.748 |
| + directory (name pool) | **0.778** | **0.752** |
| + directory (oracle) | 0.779 | 0.751 |

For reference, S1 round 2's fully trained medium scored 0.744 / 0.636.

## Reading

- **The model now beats the rules on both sets: +5.1 F1 on S02, +2.6 on GLM.** Before, it beat
  them only on S02.
- **Almost all of the gain comes from the rule labels.** The model learns where to trust the rules
  and where to override them.
  - Aliases add about nothing on top: the rules already use the same lists.
  - Names add +1.6 on S02 and +0.4 on GLM.
  - The oracle directory adds nothing over the name pool. These test sets have few cue-less
    names, so the directory has little to fix here.
- **Without features the model is worse than the plain baseline** (0.615 vs 0.717). In this
  design the features are part of the model, not an optional extra. That's fine: the rules and
  aliases are always available at runtime.
- **Still well short of the 0.85 bar.**
- **Noise.** On 204 to 300 queries, a difference of about 3 F1 is within noise (one seed). The GLM
  gain is at that edge; the S02 gain is not.

## Decision (pending full runs)

- If the fully trained runs hold:
  - write ADR 0004 "runtime rule and lexicon features as tagger input";
  - update PLAN §6.2;
  - pin the featurizer with a TS ↔ Python fixture (AGENTS rule 6).
- Cost at runtime: the rule tagger runs before the model, which takes well under a millisecond
  (S06).
