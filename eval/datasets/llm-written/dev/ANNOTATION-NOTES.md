# dev annotation notes

> **Dev set: used only for checkpoint selection and early stopping. Never trained on, never reported as a test number.**

Hand-labeled against [eval/ANNOTATION.md](../../../ANNOTATION.md) by Claude (Sonnet), 2026-10-13, without
seeing any model or rule predictions. Queries come from `{chat,email,tracker,drive,workspace}.txt` (60 each,
written by `open-fast`, see [README.md](README.md)). Gold spans: `annotations.tsv`; normalization: see
normalization.log. Conventions follow [v1/ANNOTATION-NOTES.md](../v1/ANNOTATION-NOTES.md), including its
proposed guideline wording.

## Counts

300 queries, 521 spans, 14 of them negated (13 NEG words via the converter: "not closed and not assigned" has
two, `exclude: "test" and "sample` has one for two spans; no minus-prefix negations in this set). 3 queries have
no spans at all (`sort by unread`, `order by last commented`, `story points > 5`). There are no true no-space
`key:value` operator queries in this set.

| Role | Spans | Queries containing |
|---|---|---|
| TOPIC | 233 | 219 |
| KIND | 103 | 93 |
| ATTR | 71 | 68 |
| ACTOR | 42 | 42 |
| TIME | 34 | 34 |
| PARTICIPANT | 13 | 13 |
| RECIPIENT | 10 | 10 |
| CONTAINER | 10 | 10 |
| ORDER | 5 | 5 |
| MENTION | 0 | 0 |

MENTION is absent, ORDER is thin. The generator wrote many "from: lee", "label: clients" style queries with a
space after the colon (33); these are labeled as natural language (see below), so ACTOR/RECIPIENT/CONTAINER counts
are inflated relative to v1.

Flags (queries): `gap:spaced-operator` 33, `gap:sort-field` 6, `question` 5, `nocue` 3, `gap:quoted` 2, `typo` 1,
`lang:hinglish` 1, `gap:sprint-range` 1, `gap:numeric-field` 1. No `operator` flag: the tokenizer only treats
`key:value` without a space as an operator.

## Conventions applied

- All v1 conventions (typed operators unlabeled; `kinds.json` nouns are KIND, other document nouns TOPIC;
  `X notes`/`X deck` split; companies without cue are TOPIC; typos labeled as the word they stand for; platform
  words TOPIC; question frames O; bare periods TIME; org after from/to ACTOR/RECIPIENT, after with PARTICIPANT).
- **New: spaced operators are natural language.** `key: value` with a space after the colon reaches the model as
  plain tokens (the colon is dropped), so it is labeled like the same words without the colon. A cue or field
  name (`from`, `cc`, `label`, `subject`, `channel`, `dated`, `vendor`, `client`, `status`, `severity`, `priority`,
  `type`, `file type`, `search`, `filter by board`) stays `O`; the value gets its natural role: `from: lee` is
  `ACTOR:lee`, `cc: priya` `RECIPIENT:priya`, `channel: ops-mumbai` `CONTAINER:ops-mumbai`, `dated: 12th may`
  `TIME:12th may`, `label: pending` `ATTR:pending`, `label: clients` / `subject: urgent` / `vendor: tan logistics`
  `TOPIC`, `saved: vendor onboarding` `ATTR:saved` + `TOPIC`, `epic: payment gateway` `KIND:epic` + `TOPIC`,
  `status: open, priority: p2` `ATTR:open|ATTR:p2`. Colons are never inside a span. All are flagged
  `gap:spaced-operator` (and not `operator`).
- `not: newsletter` and `exclude: "test" and "sample` keep their negation: `!KIND:newsletter`, `!TOPIC:test|!TOPIC:sample`.
- `sub-tasks` after `epic:` is `KIND` (task alias); `no comments`, `no assignee`, `has attachment` are `ATTR` phrases,
  not NEG + span (like `assigned to nobody` in v1). "not X" with a state word (`not closed`, `not signed`) is `!ATTR`.
- `assigned to X`, `shared with hr`, `sent to` are RECIPIENT; `with X` (meeting, call, chat, contract) is PARTICIPANT.
- Sort phrases: only direction/recency words are ORDER (`oldest first`, `high to low`); `sort by unread`,
  `order by last commented`, `story points > 5` get no span.

## The 10 most debatable calls

1. **Spaced-operator values** (`subject: urgent`, `label: clients`, `client: meridian`, `severity: critical`): the value's role is a guess when the key is a field name. `from:`/`cc:`/`channel:` are clear; `label:` gave `TOPIC` for names (`clients`) and `ATTR` for states (`pending`); `subject: urgent` is `TOPIC` though `urgent` could be `ATTR`.
2. **`not: newsletter`, `exclude: "test" and "sample`**: labeled as negated spans, since the key is a negation word; `newsletter` is `KIND` (email alias), `test`/`sample` are `TOPIC`.
3. **`sorry i missed this" - me`**: `TOPIC` message text plus `ACTOR:me` as the signature/sender (`nocue`).
4. **`re: kumar`**: `TOPIC:kumar` (nocue); a reply-subject prefix, not a sender.
5. **`notes from hiring interview - priya`**: `PARTICIPANT:priya` (nocue); could be `ACTOR` (note author).
6. **`task list`, `video call`, `screen recording`, `shared files`**: multiword KIND matching lexicon heads (task, call, recording, shared file).
7. **`pending approval from rahul`**: `ATTR:pending approval` + `ACTOR:rahul`; "from rahul" could be RECIPIENT (awaiting his approval).
8. **`done in last 2 sprints`**: `TIME:in last 2 sprints` flagged `gap:sprint-range`; a sprint range is closer to CONTAINER.
9. **`tariff card old version`**: `ATTR:old version` (no ORDER, unlike `latest version`).
10. **`who said "ship it" in launch meeting`**: `KIND:said`, `TOPIC:ship it`, `TOPIC:launch`+`KIND:meeting`; "in launch meeting" is not a container.

Also close: `budget v3 final` (one TOPIC vs `ATTR:final`), `pitch deck for nykaa - final` (TOPIC+KIND per ANNOTATION despite the `pitch deck` alias),
`reminder sent` (`ATTR:sent`), `deleted items` (ATTR vs mailbox CONTAINER), `kavya ka last message` (Hinglish, ORDER:last).

## Guideline gaps (new)

- **Spaced `key: value`**: labeled as natural language (key `O`, value its natural role, 33 rows, flag
  `gap:spaced-operator`). Decide either that the pre-tokenizer accepts `key: value` as an operator (then these rows
  become unlabeled operators) or that they stay natural language and the guideline says so. Also `epic:`/`type:`
  keys that are kind words become `KIND`.
- **Quoted fragments**: unbalanced quotes (`"test" and "sample`, `"null pointer`) are truncated generator output; labeled as plain words.
- **Numeric/compare fields** (`story points > 5`) and **sprint ranges** have no role.
- Person-signature after a dash (`- me`, `- priya`) has no obvious role.
