# llm-written v1: how it was made

- Date: 2026-10-12
- Model: `glm-latest` (Zhipu GLM) through the LiteLLM gateway, one call per product, temperature 1.
  A second model family next to v0's Claude Haiku (PLAN §9.3, M3). Gemini was tried first but isn't
  enabled on this key.
- Script: [`scripts/gen-test-queries.mjs`](../../../../scripts/gen-test-queries.mjs). Output saved
  verbatim, 60 lines per product.
- Same five products and personas as [v0](../v0/PROMPTS.md), same prompt shape, asking for 60
  queries; it never mentioned roles, filters or this project.
- Never used for training. Training paraphrases come from kimi-k3, a third family.
