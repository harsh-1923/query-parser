# v1 annotation notes

Hand-labeled against [eval/ANNOTATION.md](../../../ANNOTATION.md) by Claude (Sonnet 5.5), 2026-10-12, without
seeing any model predictions. Queries come from `{chat,email,tracker,drive,workspace}.txt` (60 each, written by
GLM, see [PROMPTS.md](PROMPTS.md)). Gold spans: `annotations.tsv`; BIO: `bio.jsonl` (source `glm-v1`);
normalization: `normalization.log` (only `neg-tag`, 10 entries; no operator/container/order rewrites were needed).

## Counts

300 queries, 505 spans, 14 of them negated (10 get a `NEG` word tag from the converter, 4 are minus-prefix
and have no `NEG` token). 17 queries have no spans at all (typed operators only).

| Role | Spans | Queries containing | % of queries |
|---|---|---|---|
| TOPIC | 230 | 222 | 74.0% |
| KIND | 110 | 108 | 36.0% |
| ATTR | 44 | 40 | 13.3% |
| TIME | 41 | 41 | 13.7% |
| ACTOR | 40 | 40 | 13.3% |
| CONTAINER | 16 | 16 | 5.3% |
| ORDER | 13 | 13 | 4.3% |
| PARTICIPANT | 6 | 5 | 1.7% |
| RECIPIENT | 4 | 4 | 1.3% |
| MENTION | 1 | 1 | 0.3% |
| NEG (words, via converter) | 10 | 10 | 3.3% |

MENTION is nearly absent and RECIPIENT/PARTICIPANT are thin: this set cannot say much about those roles.

Flags (queries): `operator` 55, `question` 26, `typo` 24, `gap:sort-field` 8, `nocue` 4, `lang:hinglish` 4,
`minus-neg` 4, and one each of `gap:duration-in-state`, `gap:state-transition`, `gap:person-lookup`,
`gap:person-attribute`. `typo` and `minus-neg` are additions to the S02 flag vocabulary; Hinglish uses the
S02 spelling `lang:hinglish`.

## Conventions applied

- Typed operators (`key:value`, also `-key:value`): nothing labeled inside; the rest of the query is labeled.
- Item nouns that are in `kinds.json` (sheet, deck, pdf, notes, transcript, recording, folder, photos, ...) are
  `KIND`; other document nouns (invoice, policy, contract, checklist, report, circular, link, dashboard, term
  sheet) are `TOPIC`. "X notes" is `TOPIC:X` + `KIND:notes`, matching S02's "pitch [deck]".
- Company/customer names with no from/to cue (swiftcart, nova mart, hoffmann) are `TOPIC`; people are never `TOPIC`.
- Typos are labeled as the word they stand for ("mokup" is `KIND`, "attatchment missing" is `ATTR`).
- Platform/team/label words (ios, android, qa, security) are `TOPIC`, not `ATTR` (S02 was mixed).
- Question frames ("who owns", "any update on", "where is") stay `O`; verbs like "decide on"/"agree on"
  stay inside `TOPIC` as in S02.

## The 10 most debatable calls

1. **"my open bugs", "my calendar", "my shared files"**: `ACTOR:my`. In a tracker, "my bugs" usually means
   assigned to me (`RECIPIENT`). Chose `ACTOR` because the guideline lists owner under `ACTOR` and the query
   has no assignment cue; S02's "my notes" is also `ACTOR`.
2. **"sort by priority desc", "sort by created asc oldest first", "invoices sorted by date"**: `ORDER` is
   recency/direction only. Labeled just the direction/recency words (`desc`, `asc oldest first`) and left
   "sort by <field>" as `O` with `gap:sort-field`; "sorted by date" with no direction word has no `ORDER` span.
3. **"mou with northpeak ventures" vs "quote for nova mart renewal"**: org after "with" is `PARTICIPANT`
   (involved party), org after "for" is inside `TOPIC`. The only difference is the cue word, which is thin.
4. **"relieving letter kumar", "contract renewal hoffmann"**: a bare name, but the letter is *about*/*for*
   the person, not from or to them. Left as `TOPIC` (kumar also flagged `nocue`). A reader could argue `RECIPIENT`.
5. **"where did i put the signed sow"**: `ACTOR:i` (the user saved it). Weak, because no verb in `ACTOR` cues
   authorship in the guideline; a model returning `O` here is arguably also right.
6. **"-old", "old pitch deck"**: "old" is `ATTR` in both. The minus form may be a text exclusion
   (`!TOPIC`), but treating it differently from "old pitch deck" seemed worse.
7. **"minus" negation (`refunds -chargebacks`, `settlement -upi`, `-pdf`, `-old`)**: the guideline defines
   `NEG` as a word; `-` is dropped by the tokenizer, so there is no `NEG` token. Labeled the span with `!` and
   flagged `minus-neg`; the converter correctly emits no `NEG` tag for these.
8. **"who edited the pricing sheet last?"**: `ORDER:last`. Intent is "most recent editor", which the roles can't
   express; kept `ORDER` because PLAN §3 says "last" is order, not time.
9. **"fixed in 2.14", "epics in the q3 release"**: version/release as `CONTAINER` (guideline: dynamic value
   "release 4.2"), without a container noun. "fixed in 2.14" is really a fix-version field; `ATTR:fixed` +
   `CONTAINER:2.14` is the closest fit.
10. **"headcount planning 2025", "gst invoices 2023-24", "q4 expense report"**: a bare year/quarter/fiscal
    year is `TIME` with no operator. "planning 2025" could be a title (`TOPIC`). Chose `TIME` for all so
    period tokens are consistent; S02 had "q3 collections" as `TOPIC` and "results q2" as `TIME`.

Also close calls: "call transcript where sunil from client got angry" (`PARTICIPANT:sunil`, `TOPIC:client
got angry`); "reopened by support" (`ACTOR:support`); "social calendar feb" (`KIND:calendar`, though in a
drive it is a doc); "has:link jira" (`TOPIC:jira`, since a jira *link* is not a ticket kind).

## Guideline gaps (proposed wording)

- **Minus negation.** Add: "A leading `-` on a word (`-pdf`, `-chargebacks`) negates that word. The tokenizer
  drops the `-`, so there is no `NEG` token: label the span as usual and mark it negated in the TSV (`!`).
  `-key:value` is a typed operator and is not labeled." Also needs a decision on how the model is meant to
  learn this (or whether the pre-tokenizer should handle it).
- **Operator values with spaces.** `created:last week`, `status:in progress`, `modified:this week` tokenize as an
  operator plus a stray word ("week", "progress"). Proposed: "The stray word after an operator is `O`."
  Better fix is in the pre-tokenizer.
- **Sort by a field.** Add: "`sort by <field>` and `order by <field>` are `O`; only direction/recency words
  (`newest first`, `oldest`, `desc`, `recent`) are `ORDER`."
- **Kind vs topic for document nouns.** Add: "A noun is `KIND` only if the product could filter on it as an
  item type (see the kind lexicon); otherwise `TOPIC`. `X notes`/`X deck`/`X sheet` splits into `TOPIC:X` +
  `KIND`, except `meeting`/`call` which join the kind (`call transcript`, `meeting summary`)."
- **Bare periods.** Add: "Quarters, fiscal years and bare years (`q3`, `2023-24`, `2025`) are `TIME`, unless
  they are part of a dynamic container value (`q3 release`)."
- **Orgs and unnamed people.** Add: "An organisation after `from`/`to` is `ACTOR`/`RECIPIENT`; after `with` it is
  `PARTICIPANT`; with no cue it is `TOPIC`. A bare person name with no cue is the role its sentence position implies
  (`nocue`), or `TOPIC` when the item is *about* the person."
- **Question frames.** Add: "Wh-words and cue verbs (`who owns`, `any update on`, `when did X join`) are `O`; the
  remaining content phrase is labeled as usual." Person-lookup questions (`who all are on the hiring panel`,
  `when did rohan join`) are flagged `gap:person-lookup`/`gap:person-attribute` and labeled minimally.
- **Self-reference after non-directional verbs.** "where did i put X", "decks i edited" need a rule for when `I`
  is `ACTOR` (authored/edited/saved) versus `O`.
