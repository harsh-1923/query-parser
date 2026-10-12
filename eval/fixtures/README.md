# fixtures

Shared TS ↔ Python parity fixtures (AGENTS rule 6).

- `labels.json`: the 23 BIO labels in id order. `@qp/core` `ROLES` order + `O` first.
- Data format for every BIO file (generated or converted), one JSON object per line:
  `{"text": str, "tokens": [str], "offsets": [[start, end]], "tags": [label], "source": str, "seed"?: int}`
  `tokens`/`offsets` come from `tokenize` in `@qp/core`; Python never re-tokenizes.
