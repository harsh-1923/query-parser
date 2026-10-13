// Scores the exported taggers with the TS runtime (@qp/model) on S02 and GLM, to check that the
// browser runtime reproduces the Python numbers, and to see what the feature model scores when its
// features come from the demo site (Xyne schema aliases + demo directory) instead of the S05
// alias lists and name pools it was trained with.
//
// Usage: node spikes/S07-lexicon-features/eval-ts.ts   (after run.sh / run-dev.sh data steps)
import { readFileSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier))
        return nextResolve(`${specifier}.ts`, context)
      if (specifier.startsWith("@qp/")) {
        const pkg = specifier.slice(4)
        return nextResolve(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url).href, context)
      }
      throw err
    }
  },
})

const { loadTagger, featurizer } = await import("../../packages/model/src/index.ts")
const { ruleTaggerFor } = await import("../../packages/core/src/index.ts")
const { schema } = await import("../../packages/adapter-xyne-spaces/src/index.ts")

const root = new URL("../../", import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root))
type Row = {
  text: string
  tokens: string[]
  offsets: [number, number][]
  tags: string[]
  operators?: boolean[]
  feats?: [number, number, number, number][]
}
const jsonl = (p: string): Row[] =>
  read(p).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row)

function load(name: string) {
  const m = JSON.parse(read(`packages/model/weights/${name}.json`).toString("utf8"))
  const b = read(`packages/model/weights/${name}.bin`)
  return loadTagger(m, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

function spans(tags: string[]): Set<string> {
  const out = new Set<string>()
  let cur: [string, number] | null = null
  const close = (end: number) => {
    if (cur) out.add(`${cur[0]}:${cur[1]}-${end}`)
    cur = null
  }
  tags.forEach((t, i) => {
    if (t.startsWith("B-") || t === "O" || (t.startsWith("I-") && cur?.[0] !== t.slice(2))) {
      close(i - 1)
      if (t !== "O") cur = [t.slice(2), i]
    }
  })
  close(tags.length - 1)
  return out
}

function f1(rows: Row[], predict: (r: Row) => string[]): number {
  let tp = 0
  let np = 0
  let ng = 0
  for (const r of rows) {
    if (!r.tokens.length) continue
    const pred = predict(r).map((t, i) => (r.operators?.[i] ? "O" : t))
    const gold = r.tags.map((t, i) => (r.operators?.[i] ? "O" : t))
    const p = spans(pred)
    const g = spans(gold)
    np += p.size
    ng += g.size
    for (const s of p) if (g.has(s)) tp++
  }
  const prec = np ? tp / np : 0
  const rec = ng ? tp / ng : 0
  return prec + rec ? (2 * prec * rec) / (prec + rec) : 0
}

const base = load("s7-base-43")
const feat = load("s7-feat-42")
const people = JSON.parse(read("apps/site/src/demo-directory.json").toString("utf8")).people as {
  name: string
  handle: string
}[]
const siteFeatures = featurizer({
  rules: ruleTaggerFor(schema),
  kinds: Object.entries(schema.kinds).flatMap(([k, d]) => [k, ...d.aliases]),
  attrs: Object.values(schema.attrs).flatMap((a) => a.aliases),
  names: people.flatMap((p) => [...p.name.split(" "), p.handle]),
  labels: feat.manifest.labels,
})

const { ATTR_ALIASES, KIND_ALIASES } = await import("../S05-vocab/aliases-v1.mjs")
const { normalizeTime } = await import("../../packages/time/src/index.ts")
const { ruleTagger } = await import("../../packages/core/src/index.ts")
const flat = (a: Record<string, string[]>) => Object.values(a).flat().map((s) => s.toLowerCase())
const s05Kinds = flat(KIND_ALIASES as Record<string, string[]>)
const s05Attrs = flat(ATTR_ALIASES as Record<string, string[]>)
const s05Rules = ruleTagger({
  kinds: s05Kinds,
  attrs: s05Attrs,
  isTime: (text) =>
    normalizeTime(text, { reference: "2026-10-12T10:00:00Z", timeZone: "Asia/Kolkata" }).ok,
})
type Pool = { first: string[]; last: string[] }
const origins = JSON.parse(read("packages/datagen/lexicons/names.json").toString("utf8")).origins as Record<string, { train: Pool; test: Pool }>
const pool = Object.values(origins).flatMap((o) => [o.train, o.test]).flatMap((p) => [...p.first, ...p.last])
const demoNames = people.flatMap((p) => [...p.name.split(" "), p.handle])
const variant = (rules: typeof s05Rules, kinds: string[], attrs: string[], names: string[]) =>
  featurizer({ rules, kinds, attrs, names, labels: feat.manifest.labels })
const siteRules = ruleTaggerFor(schema)
const siteKinds = Object.entries(schema.kinds).flatMap(([k, d]) => [k, ...d.aliases])
const siteAttrs = Object.values(schema.attrs).flatMap((a) => a.aliases)
const variants = {
  "S05 lists + pool (live)": variant(s05Rules, s05Kinds, s05Attrs, pool),
  "S05 lists + demo names": variant(s05Rules, s05Kinds, s05Attrs, demoNames),
  "site rules, S05 lex + pool": variant(siteRules, s05Kinds, s05Attrs, pool),
  "S05 rules, site lex + pool": variant(s05Rules, siteKinds, siteAttrs, pool),
  "site lists + pool": variant(siteRules, siteKinds, siteAttrs, pool),
}
const asTokens = (r: Row) =>
  r.tokens.map((text, i) => ({
    text,
    start: r.offsets[i]?.[0] ?? 0,
    end: r.offsets[i]?.[1] ?? 0,
    ...(r.operators?.[i] ? { operator: { key: "", value: "" } } : {}),
  }))

const results: Record<string, Record<string, number>> = {}
for (const [set, gold, featurized] of [
  ["S02", "eval/datasets/llm-written/v0/bio.jsonl", "eval/datasets/generated/s7/v0-all.jsonl"],
  ["GLM", "eval/datasets/llm-written/v1/bio.jsonl", "eval/datasets/generated/s7/v1-all.jsonl"],
] as const) {
  const rows = jsonl(gold)
  const frows = jsonl(featurized)
  const byText = new Map(frows.map((r) => [r.text, r.feats]))
  results[set] = {
    "s7-base-43": f1(rows, (r) => base.run(r.tokens).labels),
    "s7-feat-42, training features": f1(rows, (r) => feat.run(r.tokens, byText.get(r.text)).labels),
    "s7-feat-42, site features": f1(rows, (r) => feat.run(r.tokens, siteFeatures(asTokens(r))).labels),
    ...Object.fromEntries(
      Object.entries(variants).map(([k, fz]) => [k, f1(rows, (r) => feat.run(r.tokens, fz(asTokens(r))).labels)]),
    ),
  }
}
console.table(results)
writeFileSync(
  new URL("eval/results/s7-dev/ts-runtime.json", root),
  `${JSON.stringify(results, null, 2)}\n`,
)
