# llm-written dev set

Used ONLY to pick checkpoints and early-stop training (S7). Never trained on, never reported as a
test number.

- Written by `open-fast` on the Juspay LiteLLM gateway, via `scripts/gen-dev-queries.mjs`
  (2026-10-13). 300 queries, 60 per product; prompts in `meta.json`.
- `open-fast` is an alias. Asked which model it is, it answered "DeepSeek-V3". That self-report is
  the only evidence of its family. It is not Claude/Haiku (v0), GLM (v1) or Kimi (training
  paraphrases): `open-large`, the other alias, answered "GLM" and was not used.
- Other options on the gateway: Gemini has no budget on this account; the rest are families
  already used.
