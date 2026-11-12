# query-parser

Turn plain-English search queries into structured filters, offline in the browser, for any
product.

```
"pdfs from utkarsh last week about sync engine"
  → type: pdf · from: Utkarsh (u_8f2…) · date: 5–11 Oct 2026 · text: "sync engine"
```

A small model tags parts of the query with generic roles (who, where, when, what kind, about what).
Your product decides what those roles mean: which filter fields they feed and how names map to
your IDs. Every parse comes with a calibrated confidence, so your app can decide when to fall back
to something heavier, like an LLM. The SDK itself never calls one.

**Status:** research prototype. The rule tagger, time grammar, Xyne Spaces adapter and demo site
work end to end. The from-scratch model tied the rules
([S7](docs/spikes/S07-lexicon-features.md)), so the next step is a fine-tuned pretrained model,
benchmark first ([ADR 0004](docs/decisions/0004-pretrained-fine-tuned-model.md)). Not ready for
production use.

- [Plan](docs/PLAN.md): design, API, model, data, evaluation, milestones
- [Spikes](docs/SPIKES.md): assumptions we're testing first
- [Decisions](docs/decisions/): why things are the way they are
- [AGENTS.md](AGENTS.md): how to work in this repo

## Development

```sh
pnpm install
pnpm check
```

Requires Node 22 and pnpm 10.

## License

TBD.
