# S05: kind and attribute vocabulary

Throwaway spike code. Result: [docs/spikes/S05-kind-attr-vocab.md](../../docs/spikes/S05-kind-attr-vocab.md).

- `keys.json`: the generic reference vocabulary (key → meaning, no aliases).
- `aliases-v1.mjs`: aliases written from S02 only; the rule baseline uses these.
- `aliases.mjs`: v2, adds vocabulary exposed by held-out 1.
- `matcher.mjs`: normalization, plural folding, exact match, adjacent-swap typos, head-word fallback.
- `gold-s2.tsv`: hand gold for every S02 KIND/ATTR span.
- `gen-heldout.mjs [out.jsonl]`: kimi-k3 writes queries with marked spans and labels them
  (`heldout.jsonl`, `heldout-2.jsonl`).
- `adjudication.tsv`: hand overrides of kimi's gold, each with a reason.
- `xyne.mjs`: what Xyne Spaces' search API can filter for each key.
- `eval.mjs [v1|v2]` → `results-v1.txt`, `results-v2.txt`.
