# 0003: Time normalization is a hand-written grammar, without a chrono-node fallback

Status: proposed · Date: 2026-10-12 · Evidence: [S04](../spikes/S04-time-normalization.md)

## Context

PLAN §8 planned a small hand-written grammar for isolated `TIME` spans, with `chrono-node` as an
optional fallback plugin for phrases the grammar doesn't understand. S04 compared both on 346 time
phrases against gold labeled from a written policy.

## Options

1. **chrono-node behind the `@qp/time` interface**, with our policies on top.
2. **Grammar, with chrono-node as a fallback** for phrases the grammar returns `unsupported` for.
3. **Grammar only.** Unsupported phrases stay unsupported.

## Decision

Option 3.

chrono-node returns points rather than periods, picks the nearest date rather than the past one,
ignores operators like "before" and "since", and never says "unsupported". In S04 it got 24% of
answerable phrases right, gave a wrong range on 131 phrases, and answered 14 of the 53 phrases that
have no definite meaning. As a fallback, it would turn the grammar's honest `unsupported`
answers into confident wrong filters. That conflicts with the grounding and honesty goals (PLAN §1).

## Consequences

- `@qp/time` has no runtime dependencies (5.4 KB gzipped in the spike).
- Coverage grows by adding rules and abbreviations, tracked on a held-out set. A miss stays a
  visible `unsupported` issue, which falls back to text.
- A consumer who wants chrono-node can still call it from an `afterTag` or `bind` hook. The SDK
  won't ship or recommend that.
