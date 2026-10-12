# query-parser

Turn plain-English search queries into structured filters, offline, in a few milliseconds, for any
product.

```
"pdfs from utkarsh last week about sync engine"
  → type: pdf · from: Utkarsh (u_8f2…) · date: 5–11 Oct 2026 · text: "sync engine"
```

A tiny model tags parts of the query with generic roles (who, where, when, what kind, about what).
Your product decides what those roles mean: which filter fields they feed and how names map to
your IDs.

**Status:** planning. Nothing is usable yet.

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
