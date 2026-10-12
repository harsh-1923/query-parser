# 0002: Spans carry a cue; facets can bind on role + cue

Status: proposed · Date: 2026-10-12 · Evidence: [S02](../spikes/S02-role-coverage.md)

## Context

S02 found that 8 of 205 queries need to know which action a span belongs to: "files **modified**
last week by priya", "ananya **edited** the roadmap", "**created** yesterday". The same role
(`ACTOR`, `TIME`) maps to different product fields depending on the verb: author vs editor vs
commenter, created-at vs modified-at.

## Options

1. **One role per action** (`EDITOR`, `COMMENTER`, `CREATED_TIME`, …). Precise, but the role set
   grows with every product's verbs, and each addition means retraining.
2. **Tag the verb as its own role** (`ACTION`). One new role, but binding then has to pair actions
   with the right spans, which is fragile in queries with several of each.
3. **Record the cue deterministically.** The tagger already labels verbs and prepositions `O`.
   After tagging, attach to each span the nearest `O` token(s) that govern it (within the same
   clause, preferring the token immediately before, then after). Facets match on role + cue.

## Decision

Option 3.

```ts
interface TaggedSpan {
  // ...existing fields
  cue?: string          // normalized governing word, e.g. "edited", "created", "by", "from"
}

facets: {
  createdBy:  facet.entity({ role: "ACTOR", source: "person" }),
  modifiedBy: facet.entity({ role: "ACTOR", source: "person", cue: ["edited", "modified", "updated", "changed"] }),
  createdAt:  facet.time({ role: "TIME" }),
  modifiedAt: facet.time({ role: "TIME", cue: ["modified", "edited", "updated", "changed"] }),
}
```

A facet with `cue` wins over one without when the cue matches. Cue words are normalized (lowercase,
simple stemming) and the product lists its own synonyms.

## Consequences

- No new role, no retraining; product-specific verbs stay in the product's schema.
- Coverage in S02 rises from 92.7% to 96.6%.
- Cue attachment is a deterministic rule and needs its own tests, including queries with two
  actors ("files rahul shared that priya edited").
- The model must reliably label these verbs `O` rather than folding them into spans; training data
  should include them.
