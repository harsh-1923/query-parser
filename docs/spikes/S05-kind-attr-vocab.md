# S05: Kind and attribute vocabulary — result

Date: 2026-10-12 · Status: **fail on the bar, safe in practice** · Decision: alias lists stay the
v1 mechanism; no embedding table ships in core; the `unknownKind` hook is the extension point

## Question

Can alias lists, with normalization and a small typo allowance, resolve ≥ 95% of `KIND` and
`ATTR` spans without an embedding fallback?

## Data

All under [`spikes/S05-vocab/`](../../spikes/S05-vocab/):

| Set | Spans | Gold |
|---|---|---|
| S02 | 173 (122 KIND, 53 ATTR, minus 2 `key:value` operators) | Hand-labeled in [`gold-s2.tsv`](../../spikes/S05-vocab/gold-s2.tsv) |
| Held-out 1 | 294 | kimi-k3 wrote queries with kind/state words marked, then labeled each span against [`keys.json`](../../spikes/S05-vocab/keys.json) (key meanings only, no aliases) |
| Held-out 2 | 292 | Same method, generated **after** the v2 aliases were written; never used to change them |

The vocabulary is a generic reference set (24 kinds, 27 states) covering all five S02 products. A
separate table ([`xyne.mjs`](../../spikes/S05-vocab/xyne.mjs)) maps each key onto what Xyne Spaces'
search API can actually filter.

A sliver of kimi's gold was inconsistent. For example, "agenda" was notes in one query and none in
another, and "contracts" was document in one and file in another. On held-out 2, every span where
the matcher answered and the gold disagreed was adjudicated by hand in
[`adjudication.tsv`](../../spikes/S05-vocab/adjudication.tsv), with a reason per row. Three stayed
wrong. Misses were not adjudicated, so coverage isn't inflated.

## Results

From [`results-v1.txt`](../../spikes/S05-vocab/results-v1.txt) and
[`results-v2.txt`](../../spikes/S05-vocab/results-v2.txt):

| Aliases | Set | Resolved | Wrong | Missed (kept as text) |
|---|---|---|---|---|
| v1 (260 aliases, written from S02) | S02 | 100% | 0 | 0 |
| v1 | held-out 1 | 68.3% | 9 | 59 |
| v1 | **held-out 2** | **67.7%** | **1** | 73 |
| v2 (352 aliases, adds held-out 1's misses) | held-out 1 (tuned on) | 92.6% | 16 | 8 |
| v2 | **held-out 2** | **85.4%** | **2** | 32 |

The bar was ≥ 95% resolved, set before running. **Neither version meets it on unseen data.**

### What the numbers say

- **The vocabulary is a long tail.** Each fresh set brings new words. Held-out 2's misses were
  jargon ("sow", "okrs", "cves", "dupes"), abbreviations ("mtg", "high-pri", "prs") and genre nouns
  ("changelog", "itinerary", "checklist"). Doubling the alias list after one round still left 15%.
- **Misses are cheap; wrong answers aren't.** A miss falls back to search text, so "okrs" is still
  searched. A wrong kind becomes a hard filter that hides results. With the fixes below, wrong
  answers on fresh data are 1–2 in 226.
- **Typo matching was net harmful.** v1's edit-distance-1/2 rule produced 2 correct and 5 wrong
  answers on held-out 1: "contract" → contact (a person), "meme" → memo, "locked" → blocked,
  "redacted" → cancelled. Typos are now **adjacent swaps only** ("taks" → task, "reciepts" →
  receipt). That cut wrong answers from 14 to 9 on held-out 1, at the cost of one correct answer.
- **Broad aliases hurt the rule tagger.** The rule tagger uses aliases to *find* kind spans. With v2,
  its S02 span F1 fell from 69.5 to 64.8. Kind precision went from 76.8 to 64.8 and topic F1 from
  53.6 to 41.8, because "report", "spec", "request" and "incident" are topics more often than kinds.
  The baseline stays pinned to v1 ([`eval/rule-baseline.ts`](../../eval/rule-baseline.ts)).

### Xyne Spaces

Of the 169 resolved S02 spans:
- 79 map to an exact Xyne filter.
- 64 map only to a broader parent ("pdf" → `type=files`, with "pdfs" kept in `q`).
- 26 have no Xyne filter at all. These are unread, draft, starred, pinned, flagged, trashed,
  unassigned, has-attachment and folders, and they fall back to text.

These are product gaps, not parser gaps. The adapter reports them as `unbound` issues.

## Decision

- **Alias lists stay the v1 mechanism**, with adjacent-swap typos only (PLAN §5.3 updated).
- **Resolution and detection need different vocabularies.**
  - *Resolving* a span already known to be a kind can use a broad list.
  - *Finding* kinds (the rule tagger) and *filtering on them* (an adapter) should use a narrow list.
  - The Xyne adapter takes formats and status words (mp3, vtt, yaml, merged) and leaves genre nouns
    ("report", "spec", "invoice") as text. As kinds, they would restrict results to files.
  - Once the model replaces the rule tagger (M4), detection no longer depends on aliases.
- **No embedding table in core.**
  - The S5 fallback was a tiny static embedding table. One that covers this long tail would be
    hundreds of KB, against a 200 KB budget for the whole SDK (PLAN §10.3).
  - It would also be a source of confident wrong answers, which is the failure mode this spike
    found most damaging.
  - Instead, `hooks.unknownKind(span, ctx)` is implemented in core. A product can plug in its own
    lookup (embeddings, a server call, a bigger list); unmatched spans stay text.
- **Revisit with real queries.** If logs show a few high-volume misses, add them as aliases.

## Caveats

- Both held-out sets were written by one model (kimi-k3) and labeled by the same model. Its query
  style probably over-represents jargon, and its labels needed adjudication.
- Adjudication was done by one reviewer (an agent) after seeing results, and only in the matcher's
  favour where both readings were defensible. Every case is listed with a reason.
- The vocabulary is generic. A real product's list would be narrower (only what it can filter on),
  which makes the bar easier to meet for that product.
