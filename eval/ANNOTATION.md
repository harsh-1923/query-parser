# Span annotation guidelines (IR v1)

One set of rules for every labeled query: handwritten and LLM-written test sets, and generated
training data. Roles are defined in [PLAN §3](../docs/PLAN.md). Tags are BIO over the tokens produced
by `tokenize` in `@qp/core`.

## Boundaries

| Role | Span covers | Examples (span in brackets) |
|---|---|---|
| `TIME` | The whole time phrase **including** its operator (before, after, since, until, by, between … and, from, on, in, during, older than, within) | [last week] · [in march] · [from last month] · [between 1st and 15th] · [older than 30 days] |
| `CONTAINER` | The name only. The determiner and a container noun (channel, board, project, folder, repo, space, team, dms) stay `O`, unless the noun is the whole name ("in [dms]") or part of a dynamic value ("[sprint 42]", "[release 4.2]") | in [#infra] · in the [lending] channel · [payments] board · in [dms] |
| `ACTOR` / `RECIPIENT` / `PARTICIPANT` / `MENTION` | The name, handle, email, self word or group. "the" is included only for relational or group names | from [utkarsh] · [rahul]'s · sent to [the auditor] · with [the infra team] · [my] files |
| `KIND` | The kind word or phrase, including verb triggers | [pdfs] · [meeting notes] · what did neha [say] |
| `ATTR` | The state phrase | [unread] · [high priority] · [with attachments] · [assigned to nobody] |
| `ORDER` | The order words only, never the kind they sort ("[most recent] comments") | [latest] pdfs · [newest first] · [oldest] bugs · [latest version] of |
| `NEG` | The negation word that scopes the next span (not, except, excluding, exclude, without, no) | [not] from rahul · [excluding] test merchants |
| `TOPIC` | Contiguous content words that are what the item is about. Split around other roles | [budget] sheet [v3 final] · about [sync engine] |
| `O` | Everything else: prepositions, determiners, cue verbs, filler | `from`, `the`, `about`, `shared`, `show me` |

## Notes

- A negated span keeps its own role; negation is the `NEG` span before it. In S02's TSV, negation was
  written as a `!` prefix on the span, and the converter adds the `NEG` tag on the negation word.
- Possessive `'s` is its own token and is `O`.
- Typed operators (`from:priya`) are not tagged by the model; they are `O` in BIO data.
- When unsure whether a noun is a topic or a kind, ask: would the product filter on it? "pitch
  [deck]" is `TOPIC` + `KIND`; "expense report" is `TOPIC`.
