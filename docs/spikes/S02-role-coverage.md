# S02: Role coverage — result

Date: 2026-10-12 · Status: **pass, with one plan change** ([ADR 0002](../decisions/0002-span-cues.md))

## Question

Can the 11 roles in PLAN §3 express what people type into search boxes?

## Data

No real search logs were available, so the set is model-written:

- **205 queries** (204 unique) written by Claude Haiku subagents, 40–42 each, for five products:
  team chat, email, issue tracker, cloud drive, and an all-in-one workspace with meetings. Prompts
  asked for realistic, mostly terse queries with names, channels, dates, negations, sorting and
  typos, and never mentioned roles. See [PROMPTS.md](../../eval/datasets/llm-written/v0/PROMPTS.md).
- Stored in [`eval/datasets/llm-written/v0/`](../../eval/datasets/llm-written/v0/), one file per
  product. Like the handwritten set, it is never used for training.
- Hand-tagged with role spans in
  [`spikes/S02-role-coverage/annotations.tsv`](../../spikes/S02-role-coverage/annotations.tsv). The
  analysis script checks that every query is annotated and every span is a substring of its query.

Numbers below come from [`results.txt`](../../spikes/S02-role-coverage/results.txt).

## Results

| | Queries | Share |
|---|---|---|
| Fully expressible with roles as specified | 190 | 92.7% |
| Expressible if spans also record their governing verb ("cue") | 198 | **96.6%** |
| Not expressible | 7 | 3.4% |

The pass bar was ≥ 95% with misses not clustering into one missing role.

**Strictly, the role set as written misses the bar (92.7%).** The 8 queries that close the gap all
need the same thing: knowing *which action* a person or time refers to.

| Query | What's missing |
|---|---|
| files modified last week by priya | `ACTOR` and `TIME` refer to *modifying*, not creating |
| ananya edited the roadmap · legal team edited these · who edited the hiring plan | editor, not author |
| docs i commented on last week | commenter |
| created yesterday | creation time, not modification time |
| closed this sprint by frontend team | who closed it |
| contracts folder modified this year | modification time |

A new role per action would explode the role set. Instead, each span records its **cue**: the
adjacent verb or preposition the tagger already labels `O` ("edited", "modified", "created",
"commented", "closed", "uploaded"). Facets can bind on role + cue. This is deterministic, needs no
retraining, and is written up as [ADR 0002](../decisions/0002-span-cues.md).

### The 7 that remain out of scope for v1

| Category | Count | Example | Decision |
|---|---|---|---|
| Relations between items | 3 | dupes of the invoice pdf issue · epic billing v2 children · blocked by infra | v1: falls back to text. Candidate role for v2 if a second product needs it |
| Numeric comparison | 1 | pdf attachments over 5mb | v1: text. v2: an `ATTR` value parser, like `@qp/time` for sizes and counts |
| Duration in a state | 1 | stuck in qa more than a week | v1: `ATTR` "in qa" only; duration dropped with an `unsupported` issue |
| Attendance | 1 | which meetings did i miss | v1: text |
| Field-scoped text | 1 | subject invoice | v1: text. Could become a `cue` on `TOPIC` later |

They don't cluster into one missing role; three are tracker relations, which matter for issue
trackers but not chat search.

### Role frequency

| Role | Queries | | Role | Queries |
|---|---|---|---|---|
| `TOPIC` | 62% | | `ATTR` | 23% |
| `KIND` | 58% | | `CONTAINER` | 10% |
| `ACTOR` | 30% | | `NEG` | 8% |
| `TIME` | 29% | | `RECIPIENT` / `ORDER` | 6% each |
| `PARTICIPANT` | 3% | | `MENTION` | **0%** |

- **12% are topic-only** (nothing to extract) and **11% are questions** ("who said…", "what did we
  decide…"). The parser must leave these alone, which supports S8's negatives.
- **`MENTION` never appeared.** That's a gap in the generated set, not evidence the role is
  useless: Xyne Spaces has a `mentions` filter. The next query set should ask for it explicitly.

### Things the roles cover but the plan didn't account for

These don't affect coverage, but they change the plan:

| Finding | Count | Plan change |
|---|---|---|
| Groups, teams and orgs as entities ("my team", "frontend team", "razorpay folks", "acme corp") | 24 | Entity facets accept several sources (person, group, org) |
| Relational entities ("my manager", "the cfo", "the auditor") | 4 | Sources get the span plus `self`; resolving relations is the product's job |
| Time anchored to product events or periods ("before the offsite", "this sprint", "since 4.2.1", "before diwali") | 7 | `@qp/time` takes product-supplied named anchors |
| Dynamic values ("release 4.2", "sprint 42", "label:flaky-test", "tagged finance") | 4 | Entity sources allowed on `ATTR` and `CONTAINER`, not just people |
| Explicit operators typed by power users ("reporter:priya type:bug", "from:ana@…") | 3 | Pre-tokenizer recognizes `key:value` and maps it through schema aliases, bypassing the model |
| Negated topic ("excluding test merchants", "not the sales one") | 2 | `ParseResult.excludeText` |
| Negation over a list ("not from linkedin or github") | 1 | `NEG` scopes over an or-list of the same role |
| Hinglish ("kya decide hua tha", "kal wala") | 3 | Still open (PLAN §16 Q2); "kal" is ambiguous (yesterday/tomorrow) |
| Names without a cue word ("meera canvas api rate limits") | 7 | Input to S3 |

## Caveats

- **Model-written, not real.** Haiku's queries are cleaner and more varied than real logs tend to
  be, and it under-produced some patterns (no mentions at all). Real queries remain the strongest
  evidence; if logs become available, rerun this spike on them.
- **One annotator.** Role boundaries were tagged by one person (an agent), so borderline calls (is
  "q3" in "q3 collections" a time or a topic?) aren't double-checked. Inter-annotator agreement is
  worth measuring once the handwritten set exists.
- **Five products, one prompt style.** A second query set from a different model family would
  reduce the risk of measuring one model's habits.

## Decision

- Keep the 11 roles.
- Add span cues ([ADR 0002](../decisions/0002-span-cues.md)).
- Apply the plan changes in the table above (PLAN updated in the same commit).
- Out of scope for v1: item relations, numeric comparison, duration in state, attendance,
  field-scoped text. Each falls back to text.
