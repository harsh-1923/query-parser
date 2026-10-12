#!/usr/bin/env bash
# S7: regenerate data, featurize, train baseline and feature tagger, evaluate every ablation.
# Run from the repo root. Takes ~1 h on 4 CPU cores.
set -euo pipefail
G=eval/datasets/generated
F=$G/s7
Z=spikes/S07-lexicon-features/featurize.ts
TRAIN_ARGS=(--model tagger --epochs 30 --patience 5 --seed 42)

node packages/datagen/src/cli.ts --seed 42 --train 60000 --val 2000 --test 3000 --out $G/v1
mkdir -p $F
node $Z $G/v1/train.jsonl $F/train.jsonl --names train
node $Z $G/v1/val.jsonl $F/val.jsonl --names train
for v in v0 v1; do
  in=eval/datasets/llm-written/$v/bio.jsonl
  node $Z "$in" $F/$v-all.jsonl --names all                 # name pool as the directory
  node $Z "$in" $F/$v-oracle.jsonl --names all --oracle     # + the people actually named
  node $Z "$in" $F/$v-nonames.jsonl --groups rules,lex
  node $Z "$in" $F/$v-rules.jsonl --groups rules
  node $Z "$in" $F/$v-none.jsonl --groups none
done

cd training
uv run python -m qp_train.train "${TRAIN_ARGS[@]}" --config medium \
  --train ../$G/v1/train.jsonl --val ../$G/v1/val.jsonl --out runs/s7/baseline
uv run python -m qp_train.train "${TRAIN_ARGS[@]}" --config medium-feat \
  --train ../$F/train.jsonl --val ../$F/val.jsonl --out runs/s7/feat

uv run python -m qp_train.evaluate --run runs/s7/baseline --no-latency \
  --data ../eval/datasets/llm-written/v0/bio.jsonl --data2 ../eval/datasets/llm-written/v1/bio.jsonl \
  --out ../eval/results/s7/baseline.eval.json
args=()
for v in v0 v1; do for g in oracle all nonames rules none; do args+=(--data "../$F/$v-$g.jsonl"); done; done
# evaluate takes --data plus --data2..--data5; pass the files five at a time.
uv run python -m qp_train.evaluate --run runs/s7/feat --no-latency "${args[@]:0:2}" \
  --data2 "${args[3]}" --data3 "${args[5]}" --data4 "${args[7]}" --data5 "${args[9]}" \
  --out ../eval/results/s7/feat-v0.eval.json
uv run python -m qp_train.evaluate --run runs/s7/feat --no-latency "${args[@]:10:2}" \
  --data2 "${args[13]}" --data3 "${args[15]}" --data4 "${args[17]}" --data5 "${args[19]}" \
  --out ../eval/results/s7/feat-v1.eval.json
