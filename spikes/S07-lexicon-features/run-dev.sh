#!/usr/bin/env bash
# S7 rerun: early stopping and checkpoint selection on the llm-written dev set instead of generated
# val. Baseline medium and medium-feat, seeds 42-44, one training at a time (parallel runs on 4
# cores were 13x slower). Run from the repo root after the data steps of run.sh.
set -euo pipefail
G=eval/datasets/generated
F=$G/s7
Z=spikes/S07-lexicon-features/featurize.ts
DEV=eval/datasets/llm-written/dev/bio.jsonl
TRAIN_ARGS=(--model tagger --epochs 30 --patience 5)

node $Z $DEV $F/dev-all.jsonl --names all
for v in v0 v1; do
  [ -f $F/$v-all.jsonl ] || node $Z eval/datasets/llm-written/$v/bio.jsonl $F/$v-all.jsonl --names all
done

cd training
mkdir -p ../eval/results/s7-dev
for seed in 42 43 44; do
  uv run python -m qp_train.train "${TRAIN_ARGS[@]}" --seed $seed --config medium \
    --train ../$G/v1/train.jsonl --val ../$DEV --out runs/s7-dev/baseline-$seed \
    2>&1 | tee ../eval/results/s7-dev/baseline-$seed.train.log
  uv run python -m qp_train.evaluate --run runs/s7-dev/baseline-$seed --no-latency \
    --data ../eval/datasets/llm-written/v0/bio.jsonl --data2 ../eval/datasets/llm-written/v1/bio.jsonl \
    --out ../eval/results/s7-dev/baseline-$seed.eval.json
  uv run python -m qp_train.train "${TRAIN_ARGS[@]}" --seed $seed --config medium-feat \
    --train ../$F/train.jsonl --val ../$F/dev-all.jsonl --out runs/s7-dev/feat-$seed \
    2>&1 | tee ../eval/results/s7-dev/feat-$seed.train.log
  uv run python -m qp_train.evaluate --run runs/s7-dev/feat-$seed --no-latency \
    --data ../$F/v0-all.jsonl --data2 ../$F/v1-all.jsonl \
    --out ../eval/results/s7-dev/feat-$seed.eval.json
done
