# S04: time normalization

Throwaway spike code. Result: [docs/spikes/S04-time-normalization.md](../../docs/spikes/S04-time-normalization.md).

- `POLICIES.md`: the semantics every answer is judged against (reference Monday 2026-10-12 15:30,
  Asia/Kolkata).
- `grammar.ts`: hand-written grammar, the prototype for `@qp/time`.
- `phrases-s2.tsv`: every `TIME` span from S02 (`node extract-s2.mjs`).
- `phrases-llm.tsv`: 193 phrases per PLAN §8 family, written by kimi-k3 (`node gen-phrases.mjs`).
- `phrases-heldout.tsv`: 93 phrases taken from whole queries kimi-k3 wrote *after* the grammar was
  frozen (`node gen-heldout.mjs`). Not used to change the grammar.
- `gold-llm.jsonl`, `gold-heldout-llm.jsonl`: kimi-k3's answers against `POLICIES.md`, written
  without seeing the grammar (`node label-gold.mjs [out phrases…]`).
- `adjudication.tsv`: hand overrides of the gold, each with a reason.
- `eval.ts`: grammar and chrono-node vs gold → `results.txt`
  (`TZ=Asia/Kolkata node eval.ts > results.txt`).
- `determinism.ts`: output hash under different host timezones, and timing.
- `dump.ts`: prints the grammar's answer for each phrase in a file.
- Bundle size: `npx esbuild entry-grammar.ts --bundle --minify --format=esm | gzip -9 | wc -c`.

LLM scripts read `LITELLM_*` from `.env.local` at the repo root. `npm install` here installs the
pinned chrono-node and esbuild; the spike isn't part of the pnpm workspace.
