// S7: adds per-token runtime features to a BIO JSONL file, for the lexicon-features tagger.
// Each token gets [ruleLabelId + 1, kindAlias, attrAlias, directoryName]; a group can be zeroed.
//
// Usage: node spikes/S07-lexicon-features/featurize.ts <in.jsonl> <out.jsonl>
//          --names train|test|all  which name pool plays the directory (packages/datagen lexicons)
//          [--oracle]              also add the gold person spans to the directory (upper bound)
//          [--groups rules,lex,names]  feature groups to keep (default all)
import { readFileSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { parseArgs } from "node:util"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier))
        return nextResolve(`${specifier}.ts`, context)
      throw err
    }
  },
})

const { ruleTagger } = await import("../../packages/core/src/ruleTagger.ts")
const { normalizeTime } = await import("../../packages/time/src/index.ts")
const { ATTR_ALIASES, KIND_ALIASES } = await import("../S05-vocab/aliases-v1.mjs")

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    names: { type: "string", default: "all" },
    oracle: { type: "boolean", default: false },
    groups: { type: "string", default: "rules,lex,names" },
  },
})
const [input, output] = positionals
if (!input || !output) throw new Error("usage: featurize.ts <in.jsonl> <out.jsonl> [options]")
const groups = new Set((values.groups ?? "").split(","))

const root = new URL("../../", import.meta.url)
const LABELS: string[] = JSON.parse(readFileSync(new URL("eval/fixtures/labels.json", root), "utf8")).labels
const labelId = new Map(LABELS.map((l, i) => [l, i]))

const flat = (a: Record<string, string[]>) => Object.values(a).flat().map((s) => s.toLowerCase())
const kinds = flat(KIND_ALIASES as Record<string, string[]>)
const attrs = flat(ATTR_ALIASES as Record<string, string[]>)
const tagger = ruleTagger({
  kinds,
  attrs,
  isTime: (text) =>
    normalizeTime(text, { reference: "2026-10-12T10:00:00Z", timeZone: "Asia/Kolkata" }).ok,
})

type Pool = { first: string[]; last: string[] }
const origins: Record<string, { train: Pool; test: Pool }> = JSON.parse(
  readFileSync(new URL("packages/datagen/lexicons/names.json", root), "utf8"),
).origins
const directory = new Set<string>()
for (const o of Object.values(origins)) {
  const pools = values.names === "all" ? [o.train, o.test] : [o[values.names as "train" | "test"]]
  for (const p of pools) for (const n of [...p.first, ...p.last]) directory.add(n.toLowerCase())
}
const PERSON = new Set(["ACTOR", "RECIPIENT", "PARTICIPANT", "MENTION"])

/** Marks every token covered by an alias of up to 3 words. */
function aliasBits(words: string[], aliases: Set<string>): number[] {
  const bits = words.map(() => 0)
  for (let i = 0; i < words.length; i++)
    for (let len = 1; len <= 3 && i + len <= words.length; len++)
      if (aliases.has(words.slice(i, i + len).join(" "))) for (let k = i; k < i + len; k++) bits[k] = 1
  return bits
}
const kindSet = new Set(kinds)
const attrSet = new Set(attrs)

const lines = readFileSync(input, "utf8").split("\n").filter(Boolean)
let nameHits = 0
let goldNames = 0
const out = lines.map((l) => {
  const ex = JSON.parse(l) as {
    tokens: string[]
    offsets: [number, number][]
    tags: string[]
    operators?: boolean[]
  }
  const tokens = ex.tokens.map((text, i) => ({
    text,
    start: ex.offsets[i]?.[0] ?? 0,
    end: ex.offsets[i]?.[1] ?? 0,
    ...(ex.operators?.[i] ? { operator: { key: "", value: "" } } : {}),
  }))
  const words = ex.tokens.map((t) => t.toLowerCase().replace(/^[@#]/, ""))
  const rules = tagger.tag(tokens).labels
  const kind = aliasBits(words, kindSet)
  const attr = aliasBits(words, attrSet)
  const feats = words.map((w, i) => {
    const gold = ex.tags[i] ?? "O"
    const isPerson = gold !== "O" && PERSON.has(gold.slice(2))
    if (isPerson) goldNames++
    const name = directory.has(w) || (values.oracle && isPerson) ? 1 : 0
    if (name && isPerson) nameHits++
    return [
      groups.has("rules") ? (labelId.get(rules[i] ?? "O") ?? 0) + 1 : 0, // 0 = missing
      groups.has("lex") ? (kind[i] ?? 0) : 0,
      groups.has("lex") ? (attr[i] ?? 0) : 0,
      groups.has("names") ? name : 0,
    ]
  })
  return JSON.stringify({ ...ex, feats })
})
writeFileSync(output, `${out.join("\n")}\n`)
console.log(
  `${out.length} examples → ${output}; directory covers ${nameHits}/${goldNames} gold person tokens`,
)
