# Query Parser: Plan

Status: draft v0.3 · Owner: Harsh · Last updated: 2026-10-12 (after [S02](spikes/S02-role-coverage.md), [S04](spikes/S04-time-normalization.md))

A small, offline, product-agnostic SDK that turns a plain-English search query into structured
filters plus residual search text:

```
"pdfs from utkarsh last week about sync engine"
  → filters: { type: "pdf", from: ["u_8f2…"], date: { from: 2026-10-05, to: 2026-10-11 } }
  → text:    "sync engine"
```

The parser does not search anything. It sits in front of whatever search a product already has
(Vespa, Postgres, Elasticsearch, an in-memory list) and gives it better input.

---

## 1. Goals and non-goals

### Goals

1. **Product-agnostic.** No product's IDs, entity types, field names or vocabulary are baked into
   the model or the core. A product plugs in through configuration and callbacks.
2. **Offline and fast.** Runs in the browser, in Node, in React Native and on a server with no
   network calls of its own. Target: a few milliseconds per query on a laptop.
3. **Deterministic.** Same query, schema, reference time, timezone and model version → same
   output, every time.
4. **Grounded.** Every filter value is traceable to characters the user actually typed. The parser
   never invents a person, channel or date the query didn't mention.
5. **Honest about uncertainty.** Ambiguous names, unresolvable entities and low-confidence parses
   come back as explicit issues, not silent guesses.
6. **Small.** Model weights in the tens to low hundreds of KB.
7. **Measurable.** Every claim about quality is backed by an eval set and a number.

### Non-goals (v1)

- Ranking or retrieval. That is the search engine's job.
- Answering questions ("what did X decide?"). The parser extracts filters from such queries; it
  does not answer them.
- Languages other than English. Hinglish is a candidate for v2 (see Open questions).
- Arbitrary boolean logic (nested AND/OR/NOT with parentheses). v1 supports simple OR inside one
  facet ("from ankit or neha") and negation of one span or one or-list ("not from linkedin or
  github").
- From S02, these fall back to text in v1: relations between items ("children of epic X",
  "blocked by infra"), numeric comparisons ("over 5mb"), duration in a state ("stuck in qa more
  than a week"), attendance ("meetings I missed"), field-scoped text ("subject invoice").

---

## 2. Core idea: the model speaks in roles, the product speaks in facets

The design hinges on one split.

**The model** knows nothing about any product. It only learns the *grammar of search requests*:
which part of the sentence names the kind of thing wanted, who wrote it, where it lives, when, and
what it's about. It labels spans of the input with **roles**.

**The product** owns the meaning. Through a schema, it says which roles map to which of its
**facets** (its filter fields), what its kinds are called, and how to turn a typed name into one of
its IDs.

```
query ──▶ tokenize ──▶ tagger (model) ──▶ role spans ──▶ bind (schema) ──▶ resolve (sources) ──▶ ParseResult ──▶ serialize (adapter) ──▶ product query
                         generic                generic        product          product                generic             product
```

This is what makes the parser reusable. A chat product, an email client and an issue tracker
can share one model because "from X", "in Y", "last week" and "about Z" work the same way in all
of them. Only the binding and resolution differ.

See [ADR 0001](decisions/0001-roles-not-facets.md) for the alternatives considered.

---

## 3. The role vocabulary (IR v1)

Roles are fixed by the model. Adding a role means retraining, so the set is deliberately small and
general.

| Role | Meaning | Examples (span in brackets) |
|---|---|---|
| `KIND` | The type of item wanted | [pdfs] from utkarsh · [messages] about rollout · what did neha [say] |
| `ACTOR` | Who authored, sent, created or owns it | from [utkarsh] · by [rahul] · [priya]'s slides · files [I] shared |
| `RECIPIENT` | Who it was sent or assigned to | sent to [neha] · files I sent [arjun] · assigned to [me] |
| `PARTICIPANT` | Who was involved, without direction | chats with [ankit] · calls with [the infra team] |
| `MENTION` | Who or what is referenced/tagged | where [I] was mentioned · mentioning [@rahul] |
| `CONTAINER` | Where it lives | in [#infra] · in the [design] channel · on the [payments] board |
| `TIME` | A time constraint, including its operator | [last week] · [before march] · [between 3 and 10 oct] · [yesterday] |
| `ATTR` | A state or property | [unread] · [starred] · [open] tickets · [with attachments] · [high priority] |
| `ORDER` | Sort or recency intent | [latest] pdfs · [oldest] messages · [most recent] call |
| `TOPIC` | What it's about: residual search text | about [sync engine] · [payment retries] |
| `NEG` | Negates the next role span, or an or-list of the same role | [except] images · [not] from rahul · [not] from linkedin or github |
| `O` | Filler | `from`, `about`, `the`, `in`, `that` |

Design notes:

- **`TIME` keeps its operator** ("before", "since", "between … and …") inside the span. A separate
  deterministic module turns the whole span into a range (§8). Splitting operator and date into
  different roles made early sketches more fragile, not less.
- **Self-reference** ("I", "me", "my", "mine") is an ordinary `ACTOR`/`RECIPIENT`/`MENTION` span.
  Resolution maps it to the current user (§7.3).
- **`ORDER` is separate from `TIME`.** "latest pdfs" means *sort by recency*, not *filter to a
  date*. Xyne Spaces currently strips "latest", "last", "new" and "current" as time words, which
  is one of the bugs this project exists to fix.
- **Trigger words for `KIND`.** Verbs can imply a kind ("what did X *say*" → messages, "who
  *shared*" → files). The model tags the trigger as `KIND`; the product's kind aliases decide what
  it means. A product that doesn't map "say" simply ignores it.
- **Cues.** Each span also records the verb or preposition that governs it ("edited", "created",
  "by"), so products can tell an editor from an author or created-at from modified-at without new
  roles. See [ADR 0002](decisions/0002-span-cues.md).
- **Multi-value.** Two spans with the same role and an "or"/"and" between them become a multi-value
  facet. Whether multiple values mean OR or AND is a per-facet schema setting (§5.2).

The tag set is encoded as BIO (`B-ACTOR`, `I-ACTOR`, `O`, …): 11 roles × 2 + `O` = 23 labels.

---

## 4. Output contract

The SDK returns one `ParseResult`. Its `filters` field is typed from the product's schema.

```ts
interface ParseResult<F> {
  query: string                     // the original input
  filters: Partial<F>               // facet id → typed value (see §5.2)
  text: string                      // residual search text (TOPIC spans + untagged content words)
  excludeText: string[]             // negated TOPIC spans ("excluding test merchants")
  order?: OrderSpec                 // from ORDER spans, if the schema maps it
  spans: TaggedSpan[]               // every non-O span: role, char offsets, binding, resolution
  issues: Issue[]                   // ambiguous / unresolved / unsupported / low-confidence
  confidence: number                // 0..1, calibrated (see §6.5)
  meta: {
    irVersion: 1
    modelVersion: string
    schemaHash: string
    reference: string               // ISO instant used for time resolution
    timeZone: string
    tookMs: number
  }
}

interface TaggedSpan {
  role: Role
  text: string
  start: number; end: number        // offsets into `query`, for highlighting and chips
  negated: boolean
  cue?: string                      // governing verb/preposition, e.g. "edited" (ADR 0002)
  source?: "model" | "operator"     // "operator" for typed key:value syntax (§5.8)
  confidence: number
  facet?: string                    // where it was bound, if anywhere
  resolution?: Resolution           // resolved | ambiguous | unresolved | literal
}

type Issue =
  | { kind: "ambiguous"; span: TaggedSpan; candidates: Candidate[] }   // "rahul" → 3 Rahuls
  | { kind: "unresolved"; span: TaggedSpan; fallback: "text" | "dropped" }
  | { kind: "unbound"; span: TaggedSpan }                              // role the schema doesn't map
  | { kind: "unsupported"; span: TaggedSpan; reason: string }          // e.g. time span the normalizer can't parse
  | { kind: "low-confidence" }
```

Rules the contract guarantees:

1. **Spans never overlap and always point at the input.** Highlighting and chip UIs can rely on
   offsets.
2. **Nothing is lost silently.** A span that can't be bound or resolved either goes back into
   `text` or appears in `issues`, according to the schema's fallback policy.
3. **Filters only contain resolved values.** An ambiguous "rahul" is not guessed into `filters`;
   the UI gets the candidates and can ask, or the consumer can opt into "take the top candidate".
4. **`text` is safe to send to a search engine as-is.** It has no leftover operators or filter
   syntax.

A canonical string form round-trips for logging, debugging and chip editing:

```
type:pdf from:@u_8f2 date:2026-10-05..2026-10-11 "sync engine"
```

---

## 5. Consumer API: defining a product

### 5.1 Shape of the integration

```ts
import { createParser, defineSchema, directorySource } from "@qp/core"
import { loadModel } from "@qp/model"

const schema = defineSchema({
  kinds: { /* §5.3 */ },
  facets: { /* §5.2 */ },
  attrs: { /* §5.4 */ },
  policies: { /* §5.6 */ },
})

const parser = await createParser({
  schema,
  model: await loadModel(),                  // or a rule-based tagger, see §6.6
  sources: {                                 // §7: how names become IDs
    person: directorySource(users, { self: currentUser.id }),
    channel: async (span, ctx) => api.searchChannels(span.text, { limit: 5 }),
  },
})

const result = await parser.parse(query, {
  reference: new Date(),
  timeZone: "Asia/Kolkata",
})
```

`parse` is synchronous when every source is synchronous, and returns a promise otherwise.
`parseSync` exists for the all-sync case so UIs can parse on every keystroke without promise churn.

### 5.2 Facets

A facet is one filter field in the product. Each facet says which role feeds it and what type of
value it holds.

```ts
facets: {
  from:     facet.entity({ role: "ACTOR", source: "person", multi: "or" }),
  to:       facet.entity({ role: "RECIPIENT", source: "person" }),
  with:     facet.entity({ role: "PARTICIPANT", source: "person" }),
  mentions: facet.entity({ role: "MENTION", source: "person" }),
  in:       facet.entity({ role: "CONTAINER", source: "channel", multi: "or" }),
  type:     facet.kind(),                                  // fed by KIND via `kinds`
  date:     facet.time({ role: "TIME" }),
  status:   facet.enum({ role: "ATTR", values: ["open", "closed", "pending"] }),
  sort:     facet.order({ role: "ORDER" }),
}
```

Facet kinds:

| Facet | Value type | Fed by |
|---|---|---|
| `facet.entity` | `string[]` of product IDs (or `T[]` of the source's payload) | any role + one or more entity sources (people, groups, orgs, labels, releases…) |
| `facet.kind` | one or more kind keys | `KIND` spans via `kinds` aliases |
| `facet.time` | `{ from?: Instant; to?: Instant; granularity }` | `TIME` spans via `@qp/time` |
| `facet.enum` | one or more of the declared values | `ATTR` spans via `attrs` aliases |
| `facet.flag` | `boolean` | `ATTR` spans via `attrs` aliases |
| `facet.order` | `{ by: "recency" \| string; dir: "asc" \| "desc"; limit?: number }` | `ORDER` spans |
| `facet.custom` | anything | a `bind` callback the product writes |

**Conditional binding.** The same role can mean different fields depending on the kind. Xyne Spaces
maps "from" to `userId` for messages but `createdBy` for tickets and files:

```ts
facets: {
  from:      facet.entity({ role: "ACTOR", source: "person", when: { kind: ["message", "attachment"] } }),
  createdBy: facet.entity({ role: "ACTOR", source: "person", when: { kind: ["ticket", "file"] } }),
}
```

When no kind is present, the first facet without a `when` wins; ties are a schema validation error.

**Cue binding.** Facets can also condition on the span's cue ([ADR 0002](decisions/0002-span-cues.md)):

```ts
facets: {
  owner:      facet.entity({ role: "ACTOR", source: ["person", "group"] }),
  editedBy:   facet.entity({ role: "ACTOR", source: "person", cue: ["edited", "modified", "updated"] }),
  createdAt:  facet.time({ role: "TIME", cue: ["created", "uploaded", "made"] }),
  modifiedAt: facet.time({ role: "TIME" }),
}
```

A facet whose `cue` matches beats one without `cue`; among facets without a matching cue, `when`
and declaration order decide.

**Entity values beyond people.** `ATTR` and `CONTAINER` spans can carry dynamic values ("release
4.2", "sprint 42", "tagged finance"). Binding them to `facet.entity` with a product source (labels,
releases, sprints) works exactly like people.

### 5.3 Kinds

```ts
kinds: {
  message:    { aliases: ["message", "messages", "msg", "chat", "said", "say", "wrote"] },
  pdf:        { aliases: ["pdf", "pdfs", "pdf file"], parent: "file" },
  file:       { aliases: ["file", "files", "doc", "docs", "document", "attachment"] },
  transcript: { aliases: ["transcript", "call notes", "recording"] },
  canvas:     { aliases: ["canvas", "canvases", "note", "notes"] },
}
```

- Aliases are matched after normalization (case, plural, punctuation) with a small edit-distance
  allowance for typos.
- `parent` lets a consumer ask for "pdf" and still filter correctly in a system that only knows
  "file + mime".
- A `KIND` span that matches no alias goes through the optional `unknownKind` hook (a product could
  plug in an embedding lookup here). If that returns nothing, the span falls back to `text`.

### 5.4 Attributes

```ts
attrs: {
  unread:          { aliases: ["unread", "new"], set: { facet: "is", value: "unread" } },
  starred:         { aliases: ["starred", "saved", "pinned"], set: { facet: "is", value: "starred" } },
  hasAttachment:   { aliases: ["with attachments", "with files"], set: { facet: "has", value: "attachment" } },
  "priority:high": { aliases: ["high priority", "urgent", "p0"], set: { facet: "priority", value: "high" } },
}
```

The model only needs to know that "urgent" is an attribute-like span. Whether it means
`priority:high` is the product's decision.

### 5.5 Hooks

Every stage has an escape hatch, run in order:

| Hook | Runs | Typical use |
|---|---|---|
| `normalize(query)` | before tagging | expand product shorthands ("pr" → "pull request") |
| `afterTag(spans, ctx)` | after the model | product-specific span fixes |
| `bind(span, ctx)` | per span, before default binding | custom facets |
| `resolve` | per entity span | via `sources` |
| `afterParse(result, ctx)` | at the end | add defaults, e.g. scope to the current workspace |

Hooks are pure functions of their inputs, so determinism holds as long as the product's hooks are
deterministic.

### 5.6 Policies

Decisions that reasonable products make differently are explicit settings with documented defaults:

| Policy | Default | Notes |
|---|---|---|
| `time.weekStartsOn` | `1` (Monday) | "last week" = previous Monday–Sunday |
| `time.dayFirst` | `true` | 3/10 = 3 October (India) |
| `time.bias` | `"past"` | "on monday" = most recent past Monday; search is about the past |
| `time.recentDays` | `7` | what "recent"/"recently" means |
| `time.fiscalYearStartMonth` | `1` | month the fiscal year starts (India: `4`); used by "fy24", "q2 fy24", "this fy". From S04 |
| `time.anchors` | none | product-named periods and events ("this sprint", "the offsite", "release 4.2", "diwali"), see §8 |
| `entity.onAmbiguous` | `"issue"` | or `"top"` to take the best candidate |
| `entity.onUnresolved` | `"text"` | or `"drop"` / `"keep-literal"` |
| `unbound` | `"text"` | what to do with roles the schema doesn't map |
| `minConfidence` | `0.5` | below this, return only `text` plus a `low-confidence` issue |

### 5.7 Two products, one model

**Xyne Spaces** (the reference adapter, `@qp/adapter-xyne-spaces`) maps to the search params the
backend already accepts:

| Role | Xyne facet | API param |
|---|---|---|
| `KIND` | `type` | `type=messages\|files\|attachments\|channels\|transcript\|canvas` |
| `ACTOR` | `from` / `createdBy` | `from=<userId>` |
| `RECIPIENT` | `to` | `toEmail=` (mail only) |
| `PARTICIPANT` | `with` | `withUser=<userId>` |
| `MENTION` | `mentions` | `mentions=<userId>` |
| `CONTAINER` | `in` | `in=<channelId>` |
| `TIME` | `date` | `after=` / `before=` / `on=` |
| `ATTR` | `status`, `stage`, … | `status=` / `stage=` |
| `ORDER` | `sort` | not supported by the API yet; reported as `unbound` |
| `TOPIC` | – | `q=` |

**A hypothetical issue tracker** reuses the same model with a different schema: `ACTOR` →
`reporter`, `RECIPIENT` → `assignee`, `CONTAINER` → `project`, `ATTR` → `status`/`priority`,
`KIND` → `bug|feature|epic`. No retraining; only a schema and two entity sources.

### 5.8 Typed operators

Power users type filter syntax directly ("reporter:priya type:bug", "from:ana@lumen.de",
"label:flaky-test"). The pre-tokenizer recognizes `key:value` (and `key:"quoted value"`) before the
model runs. Keys are matched against `schema.operators` aliases; matched spans skip the model and
bind directly, with `source: "operator"`. Unknown keys are left as text.

```ts
operators: { from: "from", reporter: "from", type: "type", label: "labels", in: "in" }
```

### 5.9 Serializers

The core produces `ParseResult`. Turning it into a product query is a serializer the adapter ships:

```ts
import { toSearchParams } from "@qp/adapter-xyne-spaces"
const params = toSearchParams(result)   // URLSearchParams for GET /api/vespaSearch
```

Products without an adapter write their own; it's a function of a typed object.

---

## 6. The model

### 6.1 Task formulation

**Default hypothesis: per-token BIO tagging, not text generation.** Spike S1 decides.

| | Tagger (default) | Seq2seq with constrained decoding (gpu-cron style) |
|---|---|---|
| Output grounded in input | Yes, by construction | Needs a substring-copy constraint |
| Structural validity | Constrained Viterbi over BIO transitions | Grammar automaton over the DSL |
| Normalized values (dates) | No; done by `@qp/time` | Could emit them, but couples model to date logic |
| Speed | One forward pass | One pass per output character |
| Product-agnostic | Naturally | Only if the DSL is role-based |

The gpu-cron insight still applies: make invalid output unreachable, not just unlikely. For a
tagger that means masking illegal transitions (`O → I-ACTOR`, `B-TIME → I-ACTOR`) during
decoding, so every output is a well-formed span sequence.

### 6.2 Input representation

- Deterministic pre-tokenizer: split on whitespace and punctuation, keep `#`, `@` and `'s` as
  their own tokens, record character offsets.
- Each token is encoded from its **bytes** (byte embeddings → small convolution → pooled vector),
  so unseen names, typos and mixed case get sensible representations without a vocabulary.
- A small transformer encoder over tokens (bidirectional) produces per-token tag scores.

### 6.3 Size and training

- Starting point: 2–3 layers, width 48–64, 2–4 heads; roughly 50–150k parameters. S1 sets the
  final size.
- Trained in PyTorch on CPU (`training/`, managed with `uv`). Target: under an hour per run.
- Exported as int8 per-row weights with float32 scales, as in gpu-cron.

### 6.4 Runtime (`@qp/model`)

- Plain TypeScript inference on CPU. At this size, a forward pass is a few hundred thousand
  multiply-adds, so WebGPU is optional and comes later if S6 shows a need.
- Weights ship inside the package (base64 or a binary asset), loaded once; `loadModel()` is
  idempotent and returns the same promise, so it is safe with React `use()`.
- A conformance fixture generated from the Python side (inputs → expected logits within tolerance)
  keeps the TS and Python implementations from drifting.

### 6.5 Confidence

- Per-span confidence from token marginals (forward–backward over the constrained transitions).
- Query confidence = minimum span confidence, adjusted by an out-of-distribution check (high
  probability of all-`O` on queries that look like filter requests is a warning sign).
- Calibrated on a held-out set so that 0.9 means "right about 90% of the time". Calibration is
  part of the eval report.
- **Negatives in training** (gibberish, chit-chat, questions with nothing to extract) teach the
  model to produce all-`O`. gpu-cron lacks this and cannot say "I don't know"; we want to.

### 6.6 Pluggable taggers

`createParser` takes anything implementing:

```ts
interface Tagger {
  version: string
  tag(tokens: Token[]): TagResult   // labels + marginals
}
```

Two implementations ship: `neuralTagger` (default) and `ruleTagger` (the baseline from M2). The rule
tagger is useful for tests, for environments where the model can't load, and as the baseline the
model must beat.

---

## 7. Entity resolution

### 7.1 Sources

An entity source turns a span into candidates. It is the only place product IDs enter the system.

```ts
type EntitySource<T = unknown> =
  | ((span: TaggedSpan, ctx: ResolveContext) => Candidate<T>[])
  | ((span: TaggedSpan, ctx: ResolveContext) => Promise<Candidate<T>[]>)

interface Candidate<T> {
  id: string
  label: string        // for chips and pickers
  score: number        // 0..1
  data?: T             // anything the product wants back in `filters`
}

interface ResolveContext {
  query: string
  role: Role
  kind?: string        // resolved kind, if any
  self?: string        // current user id
  spans: TaggedSpan[]  // other spans, e.g. to prefer channel members
  signal?: AbortSignal
}
```

### 7.2 Built-in directory source

Most products can hand over a list and be done:

```ts
directorySource(users, {
  fields: (u) => ({ id: u.id, label: u.name, aliases: [u.handle, u.email.split("@")[0]] }),
  self: currentUser.id,
  boost: (u, ctx) => affinity[u.id] ?? 0,   // e.g. people you talk to most
})
```

Matching, in order: exact alias → token prefix ("utk" → "Utkarsh Sharma") → Jaro–Winkler for
typos → optional phonetic key for transliterated Indian names (Utkarsh / Utkarash / Uthkarsh). The
directory is indexed once and kept in memory; at 1,000 entries this is microseconds per lookup.

**Ambiguity.** If the top two candidates are within a margin (default 0.1), the span is
`ambiguous` and both come back in `issues`. The `boost` hook is how a product breaks ties with its
own signals (Xyne Spaces already has an affinity service).

#### Groups, orgs and relational names

S02 found groups and organizations in ~12% of queries ("my team", "frontend team", "razorpay folks",
"acme corp") and relational names in ~2% ("my manager", "the cfo", "the auditor"). Facets can list
several sources (`source: ["person", "group", "org"]`); each is tried and candidates are merged by
score. Relational names reach sources unchanged, with `self` in context; whether "my manager"
resolves is the product's call (it may have an org chart; the SDK doesn't).

### 7.3 Self

`I`, `me`, `my`, `mine`, `myself` resolve to `self` before any source runs. "My files" → `ACTOR:
self`. "Files sent to me" → `RECIPIENT: self`.

### 7.4 When a role's span isn't an entity

"mentioning sync engine" will sometimes be tagged `MENTION`. If the person source finds nothing
above threshold, the span is **demoted to `TOPIC`** and searched as text. Demotion rules are
explicit and listed in the result's `issues` (as `unresolved` with `fallback: "text"`), so they're
visible in eval.

### 7.5 Untagged known names (optional)

"utkarsh pdfs" has no cue word. The model may still tag "utkarsh" as `ACTOR`; if it doesn't, an
optional `promoteKnownEntities` pass checks leftover text tokens against sources and offers them as
**suggestions** in `issues`, never as applied filters.

---

## 8. Time (`@qp/time`)

A deterministic normalizer for an isolated `TIME` span, not a general date extractor. Because the
model has already isolated the span, the normalizer only has to understand time phrases, not find
them in a sentence.

Input: span text, reference instant, IANA timezone, policies. Output:
`{ from?: Instant; to?: Instant; granularity: "hour" | "day" | "week" | "month" | "quarter" | "year" }`
or `unsupported`.

Coverage for v1:

- Relative: today, yesterday, this/last/past/previous N hour/day/week/month/quarter/year, N days
  ago, recent(ly). Rolling hour windows are exact ("last 24 hours" = the 24 hours before the
  reference, not snapped to the hour).
- Named: weekdays ("on monday", "last friday"), months ("in march", "march 2025"), quarters ("q3"),
  half-years ("h2 2024"), fiscal years and quarters ("fy24", "q2 fy24", per `time.fiscalYearStartMonth`).
- Parts of day and clock times: "this morning", "last night", "yesterday 3pm".
- Absolute: `3 oct`, `oct 3`, `3/10`, `3/10/26`, `2026-10-03`, with `dayFirst` deciding `3/10`.
- Operators: before, after, since, until, by, on, between … and …, from … to ….

Ranges are half-open `[from, to)` in the product's timezone and returned as ISO instants.

**Anchors.** Some time phrases refer to the product's own periods and events: "this sprint",
"last release", "since 4.2.1", "before the offsite". The product passes named anchors:

```ts
time: {
  anchors: (name, ctx) => sprints.find(name) ?? releases.find(name) ?? calendar.find(name),
  // returns { from?: Instant; to?: Instant } or undefined
}
```

`@qp/time` parses the operator ("before", "since", "this", "last") and asks the product for the
anchor's range. Unknown anchors produce `unsupported`, never a guess. Public holidays could ship as
an optional anchor pack.

The exact semantics (week starts, past bias, rolling vs calendar periods, operators) are written
down in [`spikes/S04-time/POLICIES.md`](../spikes/S04-time/POLICIES.md), which becomes the
package's spec.

**From S04:** a hand-written grammar covered 100% of S02's time spans and 84.9% of a held-out set
with zero wrong answers, in 5.4 KB gzipped. `chrono-node` got 24% right, so it is not used, not even
as a fallback ([ADR 0003](decisions/0003-time-grammar-no-chrono.md)). Coverage is tracked on a fresh
held-out set, with zero wrong answers as the gate.

---

## 9. Training data (`@qp/datagen`)

There is no labelled corpus, so data is generated. The generator is TypeScript so it shares the
tokenizer, role set and lexicons with the runtime.

### 9.0 Data sources

No product search logs are available, so every dataset is generated or written by models, with
safeguards:

| Need | Source | Notes |
|---|---|---|
| Person names | [ByteBaker/indian-names](https://github.com/ByteBaker/indian-names) (BSD-3) for modern Indian names; `@faker-js/faker` (MIT) locales for en_IN and Latin-script names | `spikes/names/`: seeded, deterministic, disjoint 80/20 train/test pools per origin. `philipperemy/name-dataset` rejected: derived from the 2021 Facebook leak |
| Test queries | Cheap LLM (Claude Haiku) writing queries per product persona, without being told about roles | `eval/datasets/llm-written/`. Never used for training |
| Training paraphrases | A cheap LLM from a **different** model family than the one that wrote test queries | So the eval doesn't reward imitating one model's phrasing |
| Topics, channels, kinds | Lexicons in `@qp/datagen`, plus LLM-written lists per product domain | |

Contamination rules: test queries are de-duplicated against training data (exact and near-duplicate
after normalization) on every generator run, and test names come only from the test name pools.

### 9.1 Generic first, product-flavored second

- **Generic corpus.** Templates over abstract slots (`{KIND} from {PERSON} in {CONTAINER} {TIME}
  about {TOPIC}`), filled from broad lexicons: many kinds of items, container words ("channel",
  "board", "project", "folder", "repo"), attribute words, topics. This trains the role grammar
  without tying it to one product.
- **Product flavoring (later, optional).** `datagen` can read a product schema and generate extra
  examples with its kinds and attrs, for a product-specific fine-tune. v1 ships one generic model.

### 9.2 Generation stages (lessons from gpu-cron)

1. **Templates** covering every role, in every order, with and without cue words.
2. **Slot grid.** Walk every value in every slot deliberately, so nothing is under-represented
   (gpu-cron's minute-15 bug came from a skewed generator, not the model).
3. **Name pool.** Thousands of names across Indian, Western, East Asian and other origins, in
   lowercase, Title Case, first-name-only, handles (`@utkarsh.s`) and with typos. Names in training
   never appear in test.
4. **Paraphrases.** An LLM rewrites a sample of templates into natural phrasings. Span labels are
   re-derived by aligning slot values back into the paraphrase; examples that can't be aligned are
   dropped, not guessed.
5. **Canonical echo.** The plain template phrasing is kept, because paraphrase models avoid the
   obvious wording.
6. **Negatives.** Gibberish, chit-chat, pure topic queries, questions with no filters → all `O` or
   all `TOPIC`.
7. **Hard cases.** "new york office" (not a time), "latest" (order, not time), "mentioning sync
   engine" (topic, not person), "from today" (time, not actor), "march madness deck" (topic).

Data format (JSONL), one example per line:

```json
{"text":"pdfs from utkarsh last week","tokens":["pdfs","from","utkarsh","last","week"],"tags":["B-KIND","O","B-ACTOR","B-TIME","I-TIME"],"source":"template:k_from_t","seed":42}
```

Everything is seeded; the same seed regenerates the same bytes.

### 9.3 Splits

- `train` / `val`: generated.
- `test-generated`: generated with held-out **templates** and held-out **names**.
- `test-llm-written`: written by a cheap LLM per product persona (S02's 205 queries are v0). The
  default headline number until handwritten or real queries exist.
- `test-handwritten`: written by people who haven't seen the templates.
- `test-real`: anonymized real queries from a product's search logs, if we can get them (see Open
  questions). The number that matters most.

---

## 10. Evaluation

### 10.1 Metrics

| Metric | What it answers |
|---|---|
| Span F1 per role | Does the tagger find the right spans? |
| Exact-match parse rate | Is the whole tagging exactly right? |
| End-to-end filter accuracy | After binding and resolution, are the filters right? |
| Resolution accuracy | Do names map to the right IDs (with a 1,000-user directory)? |
| Negative precision | On queries with nothing to extract, how often do we correctly extract nothing? |
| Calibration (ECE) | Does confidence mean what it says? |
| Latency p50/p95 | Desktop browser, mid-range Android, Node |
| Bundle size | Gzipped JS + weights |

Every metric is reported per **slice**: cue-word vs no-cue names, time phrase family, multi-value,
negation, typos, query length.

### 10.2 Baselines

1. **Rule tagger** (`ruleTagger`, M2). The model must clearly beat it on handwritten and paraphrase
   slices; otherwise ship the rules.
2. **Xyne Spaces' current behavior** (`searchFilterParser` + `timeKeywordParser`), ported as a
   comparison baseline.
3. **An LLM with structured output** as a reference ceiling (not shipped; for perspective on how
   close a 100k-parameter model gets).

### 10.3 Initial targets (to be revised after spikes)

| Metric | Target |
|---|---|
| Span F1 on `test-handwritten` | ≥ 0.90 |
| End-to-end filter accuracy on `test-handwritten` | ≥ 0.85 |
| Negative precision | ≥ 0.95 |
| p95 latency, mid-range phone | ≤ 20 ms (including resolution against 1,000 people) |
| Weights + runtime, gzipped | ≤ 200 KB |

---

## 11. Repository layout

```
packages/
  core/                  @qp/core      schema, pipeline, sources, result contract, rule tagger
  time/                  @qp/time      time normalization
  model/                 @qp/model     inference runtime + weights
  datagen/               @qp/datagen   data generation (TS, shares lexicons with core)
  adapter-xyne-spaces/   reference adapter: schema, sources, serializer
apps/
  site/                  demo website
training/                PyTorch training + export (Python, uv; not in pnpm)
eval/                    datasets + harness
docs/                    this plan, spikes, decision records
```

Package names (`@qp/*`) are working names. Publishing names are decided before the first npm
release.

Dependency rules:

- `core` depends on nothing at runtime except `time`. It never imports `model`; a tagger is
  injected.
- Adapters depend on `core`. `core` never imports an adapter.
- Nothing in `packages/` makes network calls. Async sources are the consumer's code.

---

## 12. Versioning and compatibility

- **IR version** (`irVersion`): bumps when roles change. Adapters declare which IR versions they
  support.
- **Model version**: weights are versioned and recorded in every `ParseResult.meta`.
- **Schema hash**: recorded in `meta`, so logs can be replayed exactly.
- Schemas are validated at `createParser` time (unknown roles, conflicting bindings, aliases that
  collide across kinds and attrs), failing fast with a clear message.

---

## 13. Privacy and security

- No network access from the SDK. Directories and queries stay in the consumer's process.
- No telemetry. Products that want eval data log `ParseResult` themselves.
- Weights are data, not code; loading them executes nothing.

---

## 14. Milestones

| | Milestone | Exit criteria |
|---|---|---|
| **M0** | Plan and scaffold | This doc reviewed; workspace builds; agent guides in place |
| **M1** | Spikes | Each spike in [SPIKES.md](SPIKES.md) has a written result and a decision |
| **M2** | Core SDK + rule tagger | `defineSchema`, `createParser`, directory source, `@qp/time` v1, Xyne adapter; unit tests; rule baseline numbers on `test-llm-written` |
| **M3** | Data + eval harness | `datagen` v1, `test-llm-written` ≥ 500 queries across ≥ 2 model families, eval report generated by one command |
| **M4** | Model | Trained tagger in `@qp/model`, TS/Python conformance passing, beats rule baseline on `test-llm-written` |
| **M5** | Website | gpu-time-style demo: live parse, chips, resolved ranges, eval table, model vs rules toggle |
| **M6** | Integration demo | Parser in front of a Vespa index with the Xyne Spaces schema (separate project) |

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Synthetic data doesn't match how people really type | Handwritten and real-log test sets are the gate, not generated ones |
| Role set too coarse for some product | `facet.custom` + `bind` hook; new roles only with evidence from ≥ 2 products |
| Name recognition without cue words is weak | S3; `promoteKnownEntities` as a suggestion-only fallback |
| Model doesn't beat the rule tagger | Then ship the rule tagger; the SDK design still holds |
| Time normalization becomes a rabbit hole | Narrow v1 coverage, `unsupported` instead of guessing; held-out coverage tracked in eval (S04) |
| Paraphrase alignment loses labels | Drop unalignable examples; report the drop rate |

---

## 16. Open questions

1. **Real queries.** Not available for now; we use LLM-written queries (§9.0). If anonymized logs
   become available later, rerun S02 and add a `test-real` split.
2. **Hinglish.** "utkarsh ke pdfs pichle hafte ke" is plausible in an Indian team. In scope for v1,
   v2, or never?
3. **Multi-value semantics.** "from ankit and neha": OR (either sent it) or AND (a thread with both)?
   Default OR, configurable per facet; confirm with the product.
4. **Counts.** "last 5 messages from rahul": `ORDER` with a `limit`, or out of scope?
5. **Nested scope.** "pdfs in threads where rahul replied": out of scope for v1?
6. **Publishing name** for the npm packages.

---

## Glossary

- **Role**: what part a span plays in a search request (`ACTOR`, `TIME`, …). Fixed by the model.
- **Facet**: a filter field in a product (`from`, `in`, `status`). Defined by the product.
- **Binding**: mapping a role span to a facet.
- **Source**: product code that turns a span into candidate IDs.
- **IR**: the intermediate representation: tagged role spans before binding.
