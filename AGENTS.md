# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. Read this first, then
[docs/PLAN.md](docs/PLAN.md).

## What this is

A product-agnostic SDK that turns plain-English search queries into structured filters. A tiny
model tags spans of the query with generic **roles** (`ACTOR`, `TIME`, `KIND`, …); each product maps
roles to its own **facets** and resolves names to its own IDs through configuration and callbacks.
See PLAN §2 and [ADR 0001](docs/decisions/0001-roles-not-facets.md).

## Current phase

M1/M2. Spikes S2, S4 and S5 done (see `docs/spikes/`); the M2 rule baseline runs end to end in
`packages/core`, the Xyne adapter and `apps/site`. Packages are stubs. Don't implement M2+ features until the
relevant spikes in [docs/SPIKES.md](docs/SPIKES.md) have results, unless asked.

## Layout

| Path | What |
|---|---|
| `packages/core` | Schema, pipeline, entity sources, result contract, rule tagger |
| `packages/time` | Time phrase → range normalization |
| `packages/model` | Inference runtime and weights |
| `packages/datagen` | Synthetic training/eval data |
| `packages/adapter-xyne-spaces` | Reference adapter |
| `apps/site` | Demo website |
| `training/` | Python training/export (uv, not pnpm) |
| `eval/` | Datasets and harness |
| `spikes/` | Throwaway spike code; never imported by `packages/`. `spikes/names/` builds the name pools |
| `docs/` | Plan, spikes, decision records |

## Commands

```sh
pnpm install
pnpm check        # lint + typecheck + test; run before every commit
pnpm test
pnpm typecheck
pnpm lint
pnpm format
```

Node 22, pnpm 10. Python work in `training/` uses `uv`.

## Rules

1. **No product knowledge in `core`, `time`, `model` or `datagen`.** Xyne Spaces specifics live
   only in `adapter-xyne-spaces`. If you need a product concept in core, it's a schema option or a
   hook.
2. **Determinism.** No `Date.now()`, `Math.random()` or locale-dependent APIs inside packages. Time
   comes in as `reference` + `timeZone`; randomness comes from a seeded PRNG passed in.
3. **No network in `packages/`.** Async entity sources are consumer code.
4. **Grounding.** Every filter value must trace back to character offsets in the input. Never add a
   code path that invents values.
5. **Dependencies.** `core` depends only on `time`. Adding any runtime dependency to a package
   needs a sentence in the PR explaining why; prefer none.
6. **TS ↔ Python parity.** Anything implemented on both sides (tokenizer, tag set, decoding
   constraints, model forward pass) is pinned by a shared fixture in `eval/fixtures/`. Change both
   sides and the fixture together.
7. **Generated data is not committed.** It must regenerate byte-identically from a seed.
   Handwritten eval data is committed and never used for training.
8. **Numbers need a source.** Any accuracy or latency claim in docs or PRs links to the eval run
   or benchmark that produced it.

## Changing the plan

- Small clarifications: edit `docs/PLAN.md` directly and bump "Last updated".
- Anything that changes a decision (role set, task formulation, public API shape): add a record in
  `docs/decisions/` and update the plan to point to it.
- Spike results: `docs/spikes/SNN-<name>.md` with hypothesis, what was run, numbers, decision.

## Code style

- TypeScript strict, ES modules, no default exports.
- Public API types live in each package's `src/types.ts` and are exported from `src/index.ts`.
- Tests sit next to code as `*.test.ts` (Vitest).
- Biome formats and lints; don't fight it.

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `spike:`), scoped by package when useful:
`feat(time): parse "between X and Y"`.
