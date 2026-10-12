// Baseline eval for the rule tagger on the S02 role-coverage annotations.
// Run: node eval/rule-baseline.ts
// S02 is a test set (AGENTS rule 7): never tune rules against it.
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"

// packages/ use extensionless relative imports; let Node resolve them to .ts for this script.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (specifier.startsWith(".") && !/\.\w+$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context)
      }
      throw error
    }
  },
})

const { ruleTagger } = await import("../packages/core/src/ruleTagger.ts")
const { tokenize } = await import("../packages/core/src/tokenize.ts")
const { normalizeTime } = await import("../packages/time/src/index.ts")
const { ATTR_ALIASES, KIND_ALIASES } = await import("../spikes/S05-vocab/aliases-v1.mjs")

const REFERENCE = "2026-10-12T10:00:00Z"
const TIME_ZONE = "Asia/Kolkata"
const ANNOTATIONS = new URL("../spikes/S02-role-coverage/annotations.tsv", import.meta.url)

interface Span {
  role: string
  start: number
  end: number
}

const flatten = (aliases: Record<string, string[]>): string[] => Object.values(aliases).flat()

const tagger = ruleTagger({
  kinds: flatten(KIND_ALIASES),
  attrs: flatten(ATTR_ALIASES),
  isTime: (text) => normalizeTime(text, { reference: REFERENCE, timeZone: TIME_ZONE }).ok === true,
})

function goldSpans(query: string, field: string): Span[] {
  const spans: Span[] = []
  let from = 0
  for (const raw of field.split("|")) {
    if (!raw) continue
    const item = raw.startsWith("!") ? raw.slice(1) : raw
    const colon = item.indexOf(":")
    const role = item.slice(0, colon)
    const text = item.slice(colon + 1)
    const start = query.toLowerCase().indexOf(text.toLowerCase(), from)
    if (start < 0) {
      console.error(`gold span not found in query: ${JSON.stringify(query)} / ${text}`)
      continue
    }
    spans.push({ role, start, end: start + text.length })
    from = start + text.length
  }
  return spans
}

function predictedSpans(query: string): Span[] {
  const tokens = tokenize(query)
  const { labels } = tagger.tag(tokens)
  const spans: Span[] = []
  let cur: Span | undefined
  labels.forEach((label, i) => {
    const token = tokens[i]
    if (!token) return
    if (label.startsWith("B-") || (label.startsWith("I-") && cur?.role !== label.slice(2))) {
      cur = { role: label.slice(2), start: token.start, end: token.end }
      spans.push(cur)
    } else if (label.startsWith("I-") && cur) cur.end = token.end
    else cur = undefined
  })
  return spans
}

const key = (s: Span) => `${s.role}:${s.start}:${s.end}`
const counts = new Map<string, { tp: number; fp: number; fn: number }>()
const bump = (role: string, field: "tp" | "fp" | "fn") => {
  const c = counts.get(role) ?? { tp: 0, fp: 0, fn: 0 }
  c[field]++
  counts.set(role, c)
}

const errors = new Map<string, number>()
const note = (label: string) => errors.set(label, (errors.get(label) ?? 0) + 1)

let total = 0
let exact = 0
const misses: string[] = []
const lines = readFileSync(ANNOTATIONS, "utf8").split("\n")
for (const line of lines) {
  if (!line.trim() || line.startsWith("# query\t")) continue
  const [query = "", spanField = ""] = line.split("\t")
  total++
  const gold = goldSpans(query, spanField)
  // Gold has no NEG spans (negation is a flag on the negated span), so NEG predictions are not scored.
  const pred = predictedSpans(query).filter((s) => s.role !== "NEG")
  const goldKeys = new Set(gold.map(key))
  const predKeys = new Set(pred.map(key))
  for (const g of gold) {
    if (predKeys.has(key(g))) bump(g.role, "tp")
    else {
      bump(g.role, "fn")
      const overlap = pred.find((p) => p.start < g.end && g.start < p.end)
      note(
        overlap
          ? `${g.role} gold, predicted ${overlap.role}${overlap.role === g.role ? " (boundary)" : ""}`
          : `${g.role} gold, predicted nothing`,
      )
    }
  }
  for (const p of pred) {
    if (!goldKeys.has(key(p))) {
      bump(p.role, "fp")
      if (!gold.some((g) => g.start < p.end && p.start < g.end))
        note(`${p.role} predicted, gold has nothing`)
    }
  }
  if (gold.length === pred.length && gold.every((g) => predKeys.has(key(g)))) exact++
  else misses.push(query)
}

const f1 = (tp: number, fp: number, fn: number) => {
  const p = tp + fp ? tp / (tp + fp) : 0
  const r = tp + fn ? tp / (tp + fn) : 0
  return { p, r, f: p + r ? (2 * p * r) / (p + r) : 0 }
}
const pct = (x: number) => (x * 100).toFixed(1).padStart(5)

console.log(`rule tagger ${tagger.version} on S02 (${total} queries), span-level exact match\n`)
console.log("role         P      R      F1     tp  fp  fn")
const all = { tp: 0, fp: 0, fn: 0 }
for (const [role, c] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
  const m = f1(c.tp, c.fp, c.fn)
  console.log(
    `${role.padEnd(12)} ${pct(m.p)}  ${pct(m.r)}  ${pct(m.f)}  ${String(c.tp).padStart(3)} ${String(c.fp).padStart(3)} ${String(c.fn).padStart(3)}`,
  )
  all.tp += c.tp
  all.fp += c.fp
  all.fn += c.fn
}
const o = f1(all.tp, all.fp, all.fn)
console.log(
  `${"overall".padEnd(12)} ${pct(o.p)}  ${pct(o.r)}  ${pct(o.f)}  ${String(all.tp).padStart(3)} ${String(all.fp).padStart(3)} ${String(all.fn).padStart(3)}`,
)
console.log(`\nexact-match queries: ${exact}/${total} (${pct(exact / total).trim()}%)`)

console.log("\nmost common error patterns:")
for (const [label, n] of [...errors].sort((a, b) => b[1] - a[1]).slice(0, 12))
  console.log(`  ${String(n).padStart(3)}  ${label}`)
