# S04: Time normalization — result

Date: 2026-10-12 · Status: **pass** · Decision: hand-written grammar, no chrono-node fallback
([ADR 0003](../decisions/0003-time-grammar-no-chrono.md))

## Question

Can a small hand-written grammar turn isolated `TIME` spans into ranges, covering ≥ 95% of phrases
with zero wrong answers, in under 10 KB gzipped, deterministically? How does `chrono-node` compare?

## Data

All under [`spikes/S04-time/`](../../spikes/S04-time/):

| Set | Phrases | Source |
|---|---|---|
| S2 `TIME` spans | 60 (44 unique) | Every `TIME` span in the S02 annotations |
| Family list | 193 | kimi-k3, asked for phrases in each PLAN §8 family plus anchors and sloppy typing |
| Held-out | 93 | kimi-k3, asked for whole queries with the time span bracketed, **after the grammar was frozen**; phrases already seen were dropped |

kimi-k3 is a different model family from the Haiku that wrote S02.

**Gold.** The semantics are written down first in [`POLICIES.md`](../../spikes/S04-time/POLICIES.md)
(reference: Monday 2026-10-12 15:30, Asia/Kolkata; PLAN §5.6 defaults; a small anchor table standing
in for a product). kimi-k3 labeled every phrase against that document without seeing the grammar.
Disagreements were adjudicated by hand in
[`adjudication.tsv`](../../spikes/S04-time/adjudication.tsv) (5 rows, each with a reason). A phrase's
gold is either a range or **none**: vague ("early march"), not a time ("latest"), an unknown anchor,
or a fiscal calendar we don't know.

Scoring: an answer matching gold is **correct**. `unsupported` on a phrase that has a gold range is a
**coverage miss**, which is acceptable. A range that differs from gold, or any answer where gold is
none, is **wrong**, which is not.

## Results

From [`results.txt`](../../spikes/S04-time/results.txt):

| Set | Grammar correct | Grammar wrong | chrono-node correct | chrono-node wrong |
|---|---|---|---|---|
| S2 `TIME` spans (every occurrence) | 58/58 (**100%**) | **0** | 17/58 (29%) | 26 |
| Family list | 158/162 (**97.5%**) | **0** | 45/162 (28%) | 79 |
| Held-out | 62/73 (**84.9%**) | **0** | 12/73 (16%) | 54 |
| All unique | 250/265 (94.3%) | **0** | 63/265 (24%) | 145 |

The grammar returned `unsupported` for all 53 phrases whose gold is none. chrono-node answered 14 of
them ("latest", "early march", "around 2 am"…). chrono-node runs with its `en.GB` (day-first) parser.

| | Grammar | chrono-node 2.10.1 (`en.GB`) |
|---|---|---|
| Minified + gzipped | **5.4 KB** | 13.0 KB |
| Same output under host TZ Asia/Kolkata, UTC, New York, Chatham | **yes** (identical hash) | no (different hash each time) |
| Speed (Node, M-series laptop) | ~10 µs per phrase | not measured |

The grammar does all calendar math on a UTC clock and uses `Intl.DateTimeFormat("en-US", { timeZone })`
only to convert between local time and instants. Its output depends on the ICU timezone data that
ships with the runtime, not on the host timezone.

### Pass bar

The bar, set before running, was coverage ≥ 95% with zero wrong answers. On the sets the method
names (S2 spans and the family list), coverage is 100% and 97.5% with zero wrong: **pass**.

**Caveat:** I wrote the grammar after reading those phrases, so those two numbers are optimistic.
The held-out set is the honest number: **84.9% coverage, still zero wrong**. Every held-out miss is
in a known category (below), so it's cheap to close. But it is below 95%, and M2 should track
coverage on a fresh held-out set, not on these lists.

### Where the grammar misses (15)

| Category | Phrases | Fix |
|---|---|---|
| Abbreviations and typos beyond edit distance 1 | tdy, wknd, lst wk, ystrday | Grow the abbreviation table; allow distance 2 for words of 7+ letters |
| Phrasings not in the grammar | over the weekend, week before last, sept last yr, 1-15 jan, week ending 12 jan | Add rules |
| Ambiguous formats | mar-24 (March 2024 or 24 March?), 3.4.24 (read as a version number, like "since 4.2.1") | `dayFirst`-style policy for month-year forms; dates take precedence over versions when the year is plausible |
| Out of scope | pichle mahine (Hinglish), from week 28 to week 31 (ISO weeks), tonight after 9 (two constraints), earlier this morning | Leave `unsupported` for v1 |

### Why chrono-node loses

chrono-node is a good date *extractor*, but it has different semantics from a search filter:

- **Points, not periods.** "last week", "last quarter" and "last 30 days" come back as single dates
  (e.g. "last 30 days" → 12 Sep), with no range or granularity.
- **Nearest, not past.** With `forwardDate: false`, "march" on 12 Oct 2026 is March **2027**,
  "on wednesday" is the coming Wednesday. There's no past-bias option.
- **Operators.** "before X", "since X" and "until X" parse as X alone; open ranges aren't modeled.
- **No "unsupported".** It answers vague phrases with a confident date.
- **Host timezone.** Results depend on the process timezone unless you pass one explicitly.

Wrapping it in our policies means re-deriving period, operator and bias semantics from its
components. That's most of the grammar anyway, with a 13 KB dependency underneath.

### Findings that change the plan

| Finding | Evidence | Plan change |
|---|---|---|
| **Fiscal periods are common** in queries from Indian teams | 11 phrases: "fy24", "q2 fy24", "this fy", "fy 22-23", plus half-years "h2 2023" | New policy `time.fiscalYearStartMonth` (default 1; India would set 4) and `h1`/`h2` half-years. Until then, these are `unsupported` |
| Rolling hour windows are exact, not snapped to the hour | kimi snapped "last 24 hours" to 15:00; the policy text didn't say | Documented in POLICIES §2 and PLAN §8 |
| Holidays ("christmas", "diwali") need an anchor pack | gold initially resolved them from model knowledge | Already PLAN §8; it stays optional and off by default |
| "next tue" said on a Monday means tomorrow under our rule; people often mean Tuesday of next week | policy choice, unverified | Open question; worth a handwritten check before M2 |
| A chrono-node fallback would add wrong answers | it answered 14 of the 53 phrases with no definite meaning, and gave the wrong range on 131 | Dropped ([ADR 0003](../decisions/0003-time-grammar-no-chrono.md)) |

## Caveats

- **Gold is model-labeled.** kimi-k3 and the grammar agreed on almost everything. They were written
  independently against the same policy text, and I reviewed every grammar answer by hand, but
  shared misreadings of the policy are possible. Gold also has at least one doubtful row that doesn't
  affect scores ("week ending 12 jan" gold ends 11 Jan, excluding the 12th).
- **One reference instant.** Everything is evaluated on a Monday afternoon. Week-boundary policies
  (`this X`, `last X`, "weekend") deserve tests at other reference days, especially Sunday, and
  across a DST change in a DST zone.
- **The spans are clean.** In production, the `TIME` span comes from the tagger, which may include
  or drop a word. S1/S3 will show how often that happens.
- **LLM-written phrases**, as in S02. Real queries remain the strongest evidence.

## Decision

- `@qp/time` is a hand-written grammar, starting from `spikes/S04-time/grammar.ts` (rewritten with
  tests in M2), with the policies in `POLICIES.md`.
- No chrono-node fallback in v1 ([ADR 0003](../decisions/0003-time-grammar-no-chrono.md)).
- Add `time.fiscalYearStartMonth` and half-years to v1 scope.
- M2 tracks time coverage on a fresh held-out set, with zero wrong answers as the gate.
