# S02: role coverage

- `annotations.tsv`: role spans for every query in `eval/datasets/llm-written/v0/`, hand-tagged.
- `analyze.mjs`: validates annotations (every query covered, every span grounded in its query) and
  prints coverage. `node analyze.mjs > results.txt`
- `results.txt`: output used in `docs/spikes/S02-role-coverage.md`.
