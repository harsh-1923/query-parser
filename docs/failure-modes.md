# Failure modes (as of 2026-10-12)

Where the parser gets queries wrong today, grouped by pattern, with real examples from the two
LLM-written test sets: S02 (204 queries, Claude Haiku) and GLM v1 (300 queries). Both systems are
shown:
- **rules**: the rule tagger the demo site runs (0.727 span F1 on S02, 0.726 on GLM);
- **model**: the trained medium tagger from S1 round 2 (0.744 and 0.636).

Raw output is in [`eval/results/s1b/failures-rules-vs-model.txt`](../eval/results/s1b/failures-rules-vs-model.txt),
produced by [`eval/failures.py`](../eval/failures.py).

**Use this with the Xyne Spaces data.** Real queries tell us how often each pattern actually
happens, so fixes can be ranked by impact. Some of these may turn out to be rare in practice.

Notation: `gold` is the label, `rules` and `model` are the predictions. `KIND[x]` means the span "x"
was tagged as a kind.

---

## 1. Kind words inside topics (both fail, the most common error)

A word that can be a kind ("call", "notes", "deck", "ids", "folder") is part of a longer topic.

| Query | gold | rules | model |
|---|---|---|---|
| call transcript from the 3/10 **vendor call** | TOPIC[vendor call] | TOPIC[vendor] KIND[call] | same as rules |
| aditya recording from the **design review call** | TOPIC[design review call] | ACTOR[design] ATTR[review] KIND[call] | ACTOR[the design review] KIND[call] |
| **sprint retro notes** (GLM) | TOPIC[sprint retro] KIND[notes] | – | CONTAINER[sprint] KIND[retro] KIND[notes] |
| **merchant ids** mentioned in #support | TOPIC[merchant ids] | – | TOPIC[merchant] KIND[ids] |

**Why it matters:** a stray kind becomes a hard filter (`type=calls`) and hides the results.

**Fix direction:**
- Treat a kind word as the kind only at the *edge* of a noun phrase: "vendor call notes" means notes.
- Add more generated topics that contain kind words.
- Count how often real queries do this before investing more.

## 2. Names with no cue word

"rahul pdf", "meera canvas …", with no "from" or "by".

| Query | gold | rules | model |
|---|---|---|---|
| **rahul** pdf from last week about kyc drop-off | ACTOR[rahul] | TOPIC[rahul] | ✓ |
| **meera** canvas api rate limits | ACTOR[meera] | TOPIC[meera] | ✓ |
| **tokenization** pdf ppt | TOPIC | ✓ | ACTOR[tokenization] |
| **kavya budget** sheet v3 final | ACTOR[kavya] TOPIC[budget] | TOPIC[kavya budget] | ACTOR[kavya budget] |

- **Rules:** never tag these. The demo shows a *suggestion* instead ("meera might be Meera Pillai").
- **Model:** finds real names, but also calls ordinary words people. On GLM, only 24% of the
  no-cue "people" it finds are people.
- **Fix direction:** the directory should arbitrate. The model proposes a name; it becomes a filter
  only if the directory has an exact match, otherwise it stays text. The name-boundary fix
  ("kavya budget" → "kavya") already does half of this. Real data will show how common no-cue
  names are.

## 3. "from" before something that isn't a person

| Query | gold | rules | model |
|---|---|---|---|
| slides from **the board prep** march | TOPIC[board prep] TIME[march] | ACTOR[board prep] | ACTOR[the] TOPIC[board prep march] |
| From Utkarsh reasoning **from models** are getting cheaper | TOPIC | ACTOR[models] | ACTOR[models] |
| from **razorpay invoice** pdf | ACTOR[razorpay] TOPIC[invoice] | – | ACTOR[razorpay invoice] |

**Fix direction:** when an ACTOR span resolves to nobody, it already falls back to text, so these
are mostly harmless. The real cost is in pattern 1 and in boundaries ("razorpay invoice"). The
directory-decides-the-boundary fix covers known names.

## 4. Events and product periods ("before the offsite", "this sprint", "before diwali")

| Query | gold | rules | model |
|---|---|---|---|
| **before the offsite** what did we decide on pricing | TIME[before the offsite] | TOPIC[offsite] | TIME[before] ACTOR[the offsite] |
| standup notes **before diwali** | TIME[before diwali] | TOPIC[diwali] | ACTOR[diwali] |
| bugs rohan filed **this sprint** | TIME[this sprint] | TOPIC[sprint] | ✓ |

**Fix direction:**
- These need the product's anchors (sprints, releases, events, holidays; PLAN §8). The demo has
  none configured.
- Xyne Spaces can supply sprints and releases.
- The model also needs training examples of event names after time operators.

## 5. Time words inside topics (labels arguable)

| Query | gold | both systems |
|---|---|---|
| priya's sheet on **q3 collections** | TOPIC[q3 collections] | TIME[on q3] TOPIC[collections] |
| **q2 sales forecast** sheet | TOPIC | TIME[q2] TOPIC[sales forecast] |
| **payslip march** | TOPIC[payslip] TIME[march] | model: TOPIC[payslip march] |
| who said the settlement **cutoff is 6pm** | TOPIC | TIME[6pm] |

Is "q3 collections" about Q3, or a document titled with Q3? Either reading is defensible, and the
labelers weren't consistent. **Real queries plus click data would settle it.** Until then, a TIME
filter here risks hiding results.

## 6. Question and filler words

| Query | problem |
|---|---|
| **who owns** the reporting pipeline | rules: TOPIC[owns] |
| **hhmm** what was the decision on penny drop vendor | rules: TOPIC[hhmm], topic split in three |
| **things** i reported that are still in review | model: TIME[things] |
| **whats** in the backlog for search board | model: KIND[whats] |
| **anyone** blocked on the vespa reindex | model: KIND[anyone] |
| **sort by date** newest first refund flow | both: TOPIC[sort]; model also ACTOR[date] |

**Fix direction:**
- Rules: a larger filler list.
- Model: more question-shaped and filler-heavy training data.
- These mostly pollute the search text, not the filters (except the model's TIME/KIND errors).

## 7. Verbs as kinds ("said", "commented", "mention")

| Query | gold | rules |
|---|---|---|
| who **said** the settlement cutoff is 6pm | (no KIND) | KIND[said] |
| docs i **commented** on last week | (no KIND, cue only) | KIND[commented] |
| which emails **mention** the migration cutover | (no KIND) | KIND[mention] |

The guideline says verb triggers are KIND ("what did neha [say]"), but S02's labels apply it
inconsistently. **This needs a decision:** either verbs are KIND only when no other kind is present,
or they are always cues. It's a guideline call, not a model bug.

## 8. Containers without `#` or a container word

| Query | gold | rules | model |
|---|---|---|---|
| **checkout** project blocked tickets | CONTAINER[checkout] | TOPIC[checkout project] | ✓ |
| **sprint 42** unfinished stories | CONTAINER[sprint 42] | TOPIC | ✓ |
| **marketing** folder slides | CONTAINER[marketing] | TOPIC + KIND[folder] | KIND[folder] |
| **diwali creatives** folder (GLM) | TOPIC + KIND[folder] | – | CONTAINER |

**Fix direction:** the channel or board source decides. "checkout" becomes a container only if a
board named checkout exists. Same approach as names.

## 9. States outside the vocabulary

| Query | gold | both |
|---|---|---|
| checkout crash on **android** since 4.2.1 | ATTR[android] | TOPIC |
| attatchment **missing** from anand (GLM) | ATTR | TOPIC |
| whats **left** in sprnit 43 (GLM) | ATTR[left] | TOPIC |
| mails with pdf attachments **over 5mb** | ATTR | TOPIC (sizes are out of scope for v1) |

Mostly harmless (they fall back to text) unless the product has a filter for them. The Xyne data
will show which states people actually use.

## 10. Typed operators mixed with words (GLM)

| Query | gold | model |
|---|---|---|
| from:meera is:pinned **kyc** | TOPIC[kyc] | nothing |
| from:arjun has:link **jira** | TOPIC[jira] | KIND[jira] |

GLM writes many `key:value` queries; S02 almost none. The operators themselves are handled before
the tagger. The model then misreads the leftover word, because training data rarely mixes
operators with free words. **Fix:** add operator-mixed queries to the generator.

---

## What the Xyne Spaces data should tell us

1. **Frequency of each pattern above.** Fix the common ones first.
2. **Whether people type operators** (`from:`), cue-less names, or full sentences.
3. **Which kinds and states people use**, so aliases can be trimmed or extended (S05).
4. **The real test number.** S1's bar of 0.85 should be measured on real queries; the LLM-written
   sets are stand-ins.

If the data comes with search clicks, it can also settle the arguable labels (pattern 5): did the
user click a Q3 document, or one titled "q3 …"?
