# eval

Evaluation datasets and harness.

- `datasets/llm-written/`: queries written by cheap LLMs per product persona, never used for
  training. Versioned in git; each version has a `PROMPTS.md`.
- `datasets/handwritten/`: queries written by people, never used for training. Versioned in git.
- `datasets/generated/`: regenerated deterministically by `@qp/datagen` from a seed. Not committed.

See "Evaluation" in docs/PLAN.md.

## Report

`pnpm eval` scores the rule tagger on every test set that exists and writes
`results/report.md` and `results/report.json` (the JSON is meant for the site's eval table).
Add trained runs with `pnpm eval --run medium=runs/s1b/tagger-medium` (path relative to
`training/`). Needs `uv sync` in `training/` once.
