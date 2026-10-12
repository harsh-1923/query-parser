# 0001: The model emits roles; products map roles to facets

Status: proposed · Date: 2026-10-12

## Context

The parser must work for Xyne Spaces and for products we haven't seen. Products differ in their
filter fields, entity types, ID formats and vocabulary. Retraining a model per product is
expensive and defeats the point of a reusable SDK.

## Options

1. **Model emits product facets directly** (`from:`, `in:`, `type:pdf` for Xyne Spaces).
   Simple, but every product needs its own model, and product vocabulary leaks into training.
2. **Model emits a fixed, product-neutral role set** (`ACTOR`, `CONTAINER`, `KIND`, `TIME`, …)
   over spans of the input. Products bind roles to their facets and resolve spans to IDs in
   configuration and code.
3. **LLM at runtime** with the product schema in the prompt. Flexible, but needs a network call or
   a large local model, isn't deterministic, and fails the size and latency goals.

## Decision

Option 2. The role set is small (11 roles plus `O`) and describes the grammar of search requests,
which is shared across products. Product meaning lives in the schema (bindings, aliases, policies)
and in entity sources (span → IDs).

## Consequences

- One model serves every product. New products need a schema and sources, not training.
- The model never sees or emits IDs, so nothing private ends up in weights.
- Some product concepts won't fit a role; `facet.custom` and the `bind` hook cover those. A new
  role is added only with evidence from at least two products, because it requires retraining.
- Values that need normalization (dates, kinds, attributes) are handled by deterministic code after
  the model, which keeps the model small and its errors inspectable.
