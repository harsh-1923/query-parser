# Prior art (as of 2026-10-12)

Who else turns plain-English search queries into structured filters, and what we can borrow.
Researched from the web. Several paper pages (arXiv, ACL Anthology, Instacart's blog) could not be
fetched, so some claims rest on abstracts or search snippets; those are marked *(abstract)*.
F1 numbers from other papers use other datasets and label sets, so none compare directly with ours.

## Summary

- **Nobody ships what we are building.** We found no open-source or commercial system that is
  product-agnostic, small enough to run on a phone, and ties every value to character offsets.
- **Commercial products mostly call a server-side LLM:** Typesense, Vertex AI Search, Jira, and
  the Elastic and Vespa recipes.
- **The non-LLM products use dictionaries or click data:** Algolia Rules and Query Categorization.
- **Closest small, on-device design: Snips NLU (2018).** A pattern parser runs first; if it finds
  nothing, a CRF tagger runs, with gazetteer (name-list) features.
- **Closest in size:** Google's projection models (PRADO, pQRNN).
- **Biggest difference from production systems:** they feed the name lists (directory, catalogue,
  knowledge base) *into* the tagger. We only use the directory *after* tagging.

## Products

| Who | How | Source |
|---|---|---|
| Typesense | LLM (Gemini in docs) writes `filter_by` / `sort_by` from the query | [docs](https://typesense.org/docs/guide/natural-language-search.html) |
| Google Vertex AI Search | Splits a query into text plus filters; a filter can be *hard* (must match) or *soft* (boosts ranking) | [docs](https://cloud.google.com/generative-ai-app-builder/docs/natural-language-queries) *(snippet)* |
| Jira (Atlassian Intelligence) | Natural language → JQL | [Atlassian](https://ace.atlassian.com/events/details/atlassian-atlassian-ask-me-anything-presents-how-we-built-this-jira-making-issue-search-work-for-you) |
| Linear | "AI filter"; mechanism not public | [teardown](https://obviostudio.substack.com/p/linear-ai-filter) |
| Algolia | Rules turn a facet value found in the query into a filter ("red" → colour); Query Categorization learns categories from clicks; Agent Studio (beta) lets an LLM set facet filters | [rules](https://algolia.com/doc/guides/managing-results/rules/detecting-intent/how-to/applying-a-filter-if-the-query-match-a-facet-value), [categorization](https://www.algolia.com/old-docs/guides/algolia-ai/query-categorization/), [agent](https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/tools/algolia-search.md) |
| Elastic, Vespa | Recipes: an LLM rewrites the query into the engine's query language | [Elastic](https://www.elastic.co/search-labs/blog/query-rewriting-llm-search-improve), [Vespa](https://docs.vespa.ai/en/llms-in-vespa.html) |
| Instacart | Moved query understanding to LLMs, mainly for long, rare queries | [blog](https://tech.instacart.com/building-the-intent-engine-how-instacart-is-revamping-query-understanding-with-llms-3ac8051ae7ac) *(snippet)* |
| Apple Spotlight / Mail | Has parsed "emails from Kate yesterday" since 2015; implementation unknown | [Macworld](https://www.macworld.com/article/668320/spotlight-tips-for-os-x-el-capitan-yosemite.html) |
| Glean, Slack, Notion, Microsoft 365 Copilot | Typed operators (`from:`, `in:`) or UI filters. We couldn't verify any natural-language-to-filter step. | [Glean](https://docs.glean.com/user-guide/basics/how-to-search-in-glean), [Notion](https://www.notion.com/help/search) |

## Open-source libraries

| Library | What | Runs in a browser | Note for us |
|---|---|---|---|
| Duckling | Time and number rules, ranked by a model learned from examples | No | Ranking competing rule outputs is an idea we could use |
| chrono-node | Rule-based dates | Yes | Our grammar already beats it (S4) |
| Microsoft Recognizers-Text | Rule-based dates and numbers, many languages, has a JS package | Yes | A second answer key for testing `@qp/time` |
| Snips NLU | Patterns first, then a CRF tagger with name-list features | On device (Python/Rust) | Closest design; abandoned after Sonos bought Snips |
| GLiNER | Finds any entity type you name, with no training for it | Yes (ONNX) | About 60M params, roughly 400× our budget |
| NuExtract | LLM that turns text into JSON | No (0.5B+) | Too big |
| spaCy | Embeds hashed word shape, prefix and suffix instead of using a vocabulary | No | Cheap token features we could add |

## Results from papers

- **ATIS and SNIPS slot filling are near their ceiling:** about 96–97 F1 with BERT and 88–95 with
  RNNs ([Chen 2019](https://arxiv.org/pdf/1902.10909)). Those datasets have one domain and are
  built from templates, so our 0.85 target on paraphrased text from other models is harder than
  those numbers suggest.
- **A CRF layer adds +1.8 F1; character features +0.7** ([Lample 2016](https://arxiv.org/pdf/1603.01360)).
- **Name-list features add about +4 F1 on average** in low-resource NER
  ([Soft Gazetteers](https://arxiv.org/pdf/2005.01866) *(abstract)*).
  - Snips found a CRF learns to tag only names that are on the list, unless the features are
    randomly dropped in training ([Snips](https://arxiv.org/pdf/1805.10190)).
- **Amazon feeds a knowledge base into its query tagger** (RA-NER).
  ([2408.02215](https://arxiv.org/pdf/2408.02215) *(abstract)*)
- **Home Depot raised query-NER F1 from 69.5 to 93.3** by iterating over three training sets
  ([2012.07553](https://arxiv.org/pdf/2012.07553) *(abstract)*).
- **Clicks give free labels:** match spans of the query to the clicked item's attributes
  ([2106.08977](https://arxiv.org/pdf/2106.08977) *(abstract)*). This matters once the Xyne Spaces
  data comes with clicks.
- **Small models trained on a big model's labels keep most of its quality:**
  - pQRNN keeps 96–97% of mBERT on MTOP and mATIS at 350× smaller
    ([2101.08890](https://arxiv.org/pdf/2101.08890) *(abstract)*).
  - A 1-layer BiLSTM trained on BERT's labels, plus augmented text, matches ELMo
    ([Tang 2019](https://arxiv.org/pdf/1903.12136)).
  - UniversalNER, trained on ChatGPT's labels, beats ChatGPT by 7–9 F1
    ([2308.03279](https://arxiv.org/html/2308.03279v2)).
- **Generated data misses how real users write; a little real data beats a lot of generated
  data:**
  - Grammar-generated data misses patterns real users write ([2110.08381](https://arxiv.org/pdf/2110.08381)).
  - S3: an LLM generates more examples of the small model's errors on a small real validation set
    ([2310.13671](https://www.arxiv-vanity.com/papers/2310.13671)).
  - A little human-labelled data can beat much more generated data
    ([2505.16814](https://arxiv.org/html/2505.16814v2)).
- **Active learning:** a light tagger nearly matched the best results using 25% of the labelled data
  ([Shen 2018](https://arxiv.org/pdf/1707.05928)).

## What to borrow, ranked by expected impact on reaching 0.85

1. **Name lists and rule output as model inputs.** Give each token a few extra bits:
   - does it match the directory, a kind alias or a channel;
   - is it inside a span `@qp/time` accepts;
   - which tag the rule tagger gave it.

   Cost: about 1–3k params. Randomly drop these bits in training (Snips' lesson) and sample
   fictional directories so the model doesn't memorise names. This targets failure patterns 1, 2
   and 8 ([failure-modes.md](failure-modes.md)). **It changes PLAN §6.2 (bytes only) and needs a
   decision record.**
2. **Label far more paraphrased queries with an LLM and train on those labels.** The model drops
   from 0.744 on S02 to 0.636 on GLM. That looks like a mismatch between training and test text,
   which more varied LLM-labelled text should help. Check offsets mechanically, and cache the
   labels so the data still regenerates from a seed (AGENTS rule 7).
3. **Generate data aimed at the errors, and label real data as soon as it arrives.** When real data
   arrives, label first the queries where the model is least confident or disagrees with the
   rules.
4. **Use the rules and the model together.** Rule spans that are nearly always right (`#channel`,
   `@handle`, `from:`, time spans the grammar accepts) can be fixed in place before Viterbi
   decoding. Fall back to the rules when the model's confidence is low.
5. **Learned transitions between tags and hashed shape/affix features.** Probably +1–2 F1.

**Measure first:** an LLM labeller's own F1 on S02 and GLM. That is the most we can expect from
training on its labels (item 2).
