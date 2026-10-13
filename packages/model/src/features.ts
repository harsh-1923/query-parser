// S7 runtime features: what the product already knows about each token, fed to a tagger trained
// with them. Same definition as spikes/S07-lexicon-features/featurize.ts:
//   [rule tagger's label id + 1, part of a kind alias, part of an attr alias, a directory name].
// Aliases match as exact lowercase phrases of up to 3 words; the directory is a set of lowercase
// single words (first names, last names, handles).
import type { Tagger, Token } from "@qp/core"
import type { TokenFeatures } from "./types"

export interface FeatureSources {
  /** The rule tagger whose labels the model reads (the product's rule baseline). */
  rules: Tagger
  kinds: Iterable<string>
  attrs: Iterable<string>
  names: Iterable<string>
  /** The model's label list, to turn rule labels into ids. */
  labels: readonly string[]
}

export function featurizer(src: FeatureSources): (tokens: Token[]) => TokenFeatures[] {
  const labelId = new Map(src.labels.map((l, i) => [l, i]))
  const lower = (xs: Iterable<string>) => new Set([...xs].map((s) => s.toLowerCase()))
  const kinds = lower(src.kinds)
  const attrs = lower(src.attrs)
  const names = lower(src.names)
  return (tokens) => {
    const words = tokens.map((t) => t.text.toLowerCase().replace(/^[@#]/, ""))
    const rules = src.rules.tag(tokens).labels
    const kind = aliasBits(words, kinds)
    const attr = aliasBits(words, attrs)
    return words.map((w, i) => [
      (labelId.get(rules[i] ?? "O") ?? 0) + 1,
      kind[i] ?? 0,
      attr[i] ?? 0,
      names.has(w) ? 1 : 0,
    ])
  }
}

/** Marks every token covered by an alias of up to 3 words. */
function aliasBits(words: string[], aliases: Set<string>): number[] {
  const bits = words.map(() => 0)
  for (let i = 0; i < words.length; i++)
    for (let len = 1; len <= 3 && i + len <= words.length; len++)
      if (aliases.has(words.slice(i, i + len).join(" ")))
        for (let k = i; k < i + len; k++) bits[k] = 1
  return bits
}
