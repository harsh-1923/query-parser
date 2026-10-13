# S7: lexicon and rule features as tagger inputs

**Status:** done (rerun 2026-10-13 with dev-set selection, 3 seeds; see [Rerun](#rerun-checkpoints-picked-on-an-llm-written-dev-set)).
The feature model beats the rules on S02 at every seed; on GLM it ties them within noise. No ADR yet.
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

## Rerun: checkpoints picked on an LLM-written dev set

**Hypothesis.** The epoch-9 vs full-training swing came from picking checkpoints on generated val.
Picking on queries written by another model family should give a stable answer.

**What was run** ([run-dev.sh](../../spikes/S07-lexicon-features/run-dev.sh),
[summarize-dev.py](../../spikes/S07-lexicon-features/summarize-dev.py)):

- **Dev set:** [eval/datasets/llm-written/dev/](../../eval/datasets/llm-written/dev/). It has 300 queries
  written by `open-fast` on the gateway, which self-reports as DeepSeek-V3. A Sonnet subagent labelled
  them without seeing any predictions. It is passed as `--val`, so it drives early stopping
  (patience 5) and the choice of best checkpoint. It is never trained on and not reported as a test
  number. The feature model gets it featurized with `--names all`, like the test sets.
- **Training:** same data and settings as above, but seeds 42, 43 and 44, one run at a time.
- **Inputs at test time:** all of them, with the name pool as the directory (the "… + directory
  (name pool)" row above).

**Numbers.** Span F1. Per-run results are in [eval/results/s7-dev/](../../eval/results/s7-dev/), and
the summary is in [summary.json](../../eval/results/s7-dev/summary.json). Rules are from
[eval/results/report.md](../../eval/results/report.md).

| System | Seed | Best epoch (stopped) | S02 (204) | GLM (300) |
|---|---|---|---|---|
| Rules | – | – | 0.727 | 0.726 |
| Baseline medium | 42 | 9 (14) | 0.723 | 0.660 |
| | 43 | 12 (17) | 0.744 | 0.700 |
| | 44 | 18 (23) | 0.752 | 0.626 |
| Feature model | 42 | 2 (7) | 0.772 | 0.754 |
| | 43 | 3 (8) | 0.773 | 0.714 |
| | 44 | 5 (10) | 0.774 | 0.721 |

| System | S02 mean (min–max) | GLM mean (min–max) | vs rules S02 | vs rules GLM |
|---|---|---|---|---|
| Baseline medium | 0.740 (0.723–0.752) | 0.662 (0.626–0.700) | +1.3 | −6.4 |
| Feature model | **0.773** (0.772–0.774) | **0.730** (0.714–0.754) | **+4.6** | +0.4 |

**Reading.**

- **S02: a clear win.** The feature model beats the rules at every seed by +4.5 to +4.7, with a
  spread of only 0.2.
- **GLM: a tie.** The mean is +0.4 over the rules, but the seeds range from −1.2 to +2.8, so the
  rules sit inside the spread. The win at seed 42 (0.754) matches the old epoch-9 number, and the
  other two seeds don't reproduce it.
- **The features matter more than the seed.** Over the plain model, the feature model gains +3.3 on
  S02 and +6.8 on GLM. Its GLM spread (4.0) is about half the baseline's (7.4).
- **The dev set stops the feature model very early (epoch 2–5).**
  - Dev F1 is flat from epoch 1 (0.61–0.67). After one epoch the model mostly copies the rule
    labels, and further training on generated data doesn't help on LLM-written queries.
  - This fits the first run, where longer training lost to the rules on GLM. It also means the
    model adds little beyond the rules on GLM-style queries.
- **The dev set is noisy.** It has 300 queries, and the curve moves ±2 between epochs, so which
  epoch "wins" is partly chance. That is part of the GLM spread.
- **The baseline doesn't change the picture.** Picked on dev, it still loses to the rules on GLM
  at every seed.

**Decision.**

1. **Not beyond the noise on both sets, so no ADR 0004 and no PLAN §6.2 change.** The condition
   for writing them was a win on both S02 and GLM.
2. **Keep the branch.** The S02 gain is stable, and the features clearly help the model.
3. **The deciding test is the Xyne Spaces data** (real queries, labelled). Rerun these 6 checkpoints
   on it rather than retraining.
4. **Things that might move GLM:**
   - Training data that is less template-like, so more epochs help instead of hurting.
   - A larger dev set, to cut selection noise.
   - Training for a fixed number of epochs instead of early stopping, since dev F1 is flat.

   None of these has been tried.

## In the browser

**Branch:** `spike/model-on-site`. The demo has a Rules / Model / Model + rules switch.

- **Export:** [export.py](../../training/qp_train/export.py) writes float32 weights and a manifest to
  `packages/model/weights/`, about 310 KB per model. It also writes a parity fixture to
  `eval/fixtures/model-parity/`.
- **Runtime:** [@qp/model](../../packages/model/src/) has the forward pass, constrained Viterbi and
  forward-backward confidence in TypeScript.
  - It reproduces PyTorch on 80 parity cases: same tags, logits within 1e-3
    ([tagger.test.ts](../../packages/model/src/tagger.test.ts)).
  - On the full test sets it gives the same span F1, within the rounding of a slightly different
    scorer. Script: [eval-ts.ts](../../spikes/S07-lexicon-features/eval-ts.ts); results:
    [ts-runtime.json](../../eval/results/s7-dev/ts-runtime.json).
- **Models shipped:** the seed with the best dev F1 for each model: `s7-base-43` and `s7-feat-42`.

**The feature model is tied to the alias lists it was trained with.** Span F1 of `s7-feat-42` in the TS
runtime, with features built from different sources:

| Feature sources | S02 | GLM |
|---|---|---|
| S05 lists + name pool (as trained) | 0.775 | 0.754 |
| S05 lists + demo directory names | 0.770 | 0.758 |
| Xyne schema rules, S05 kind/attr bits | 0.771 | 0.738 |
| S05 rules, Xyne schema kind/attr bits | 0.778 | 0.749 |
| Xyne schema lists for both | 0.734 | 0.708 |

- The directory doesn't matter much.
- Swapping in the product's own alias lists for both inputs costs about 4.5 points, down to the
  rules' level. Swapping either input alone costs much less.
- So the demo builds the model's inputs from the S05 lists, kept in `apps/site/src/model/`. The Xyne
  schema still binds the spans.
- **If this goes to an ADR:** a product can't be required to use our alias lists. Training would need
  to vary the lexicon behind the features (different and partial alias lists), so the model learns
  to use any product's lists.
