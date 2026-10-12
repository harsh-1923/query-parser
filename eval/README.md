# eval

Evaluation datasets and harness.

- `datasets/llm-written/`: queries written by cheap LLMs per product persona, never used for
  training. Versioned in git; each version has a `PROMPTS.md`.
- `datasets/handwritten/`: queries written by people, never used for training. Versioned in git.
- `datasets/generated/`: regenerated deterministically by `@qp/datagen` from a seed. Not committed.

See "Evaluation" in docs/PLAN.md.
