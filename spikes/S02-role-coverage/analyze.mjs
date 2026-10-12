// S2: role coverage over the LLM-written query set.
// Validates annotations (every query annotated, every span a substring of its query) and prints
// coverage, role frequencies and flag counts.
//
// Usage: node analyze.mjs

import { readFileSync, readdirSync } from "node:fs"

const DATA = new URL("../../eval/datasets/llm-written/v0/", import.meta.url)
const ROLES = new Set([
  "KIND",
  "ACTOR",
  "RECIPIENT",
  "PARTICIPANT",
  "MENTION",
  "CONTAINER",
  "TIME",
  "ATTR",
  "ORDER",
  "TOPIC",
])

const queries = []
for (const f of readdirSync(DATA).filter((f) => f.endsWith(".txt")).sort()) {
  for (const q of readFileSync(new URL(f, DATA), "utf8").split("\n").filter(Boolean)) {
    queries.push({ product: f.replace(".txt", ""), q })
  }
}

const ann = new Map()
const errors = []
for (const line of readFileSync(new URL("annotations.tsv", import.meta.url), "utf8").split("\n")) {
  if (!line || line.startsWith("# query\t")) continue
  const [q, spansRaw = "", flagsRaw = ""] = line.split("\t")
  const spans = spansRaw
    .split("|")
    .filter(Boolean)
    .map((s) => {
      const neg = s.startsWith("!")
      const body = neg ? s.slice(1) : s
      const i = body.indexOf(":")
      return { role: body.slice(0, i), text: body.slice(i + 1), neg }
    })
  for (const s of spans) {
    if (!ROLES.has(s.role)) errors.push(`unknown role ${s.role} in: ${q}`)
    if (!q.toLowerCase().includes(s.text.toLowerCase()))
      errors.push(`span not in query: "${s.text}" in: ${q}`)
  }
  ann.set(q, { spans, flags: flagsRaw.split(",").filter(Boolean) })
}

for (const { q } of queries) if (!ann.has(q)) errors.push(`not annotated: ${q}`)

if (errors.length) {
  console.error(errors.join("\n"))
  process.exit(1)
}

const n = queries.length
const rows = queries.map(({ product, q }) => ({ product, q, ...ann.get(q) }))
const has = (r, prefix) => r.flags.some((f) => f.startsWith(prefix))
const pct = (x) => `${((100 * x) / n).toFixed(1)}%`

const gaps = rows.filter((r) => has(r, "gap:"))
const cues = rows.filter((r) => has(r, "cue:") && !has(r, "gap:"))

console.log(`queries: ${n}`)
console.log(`fully expressible with roles as specified: ${n - gaps.length - cues.length} (${pct(n - gaps.length - cues.length)})`)
console.log(`  + with a span "cue" (governing verb) recorded:  ${n - gaps.length} (${pct(n - gaps.length)})`)
console.log(`not expressible: ${gaps.length} (${pct(gaps.length)})`)

const count = (xs) =>
  Object.entries(xs.reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])

console.log("\ngap categories:")
for (const [k, v] of count(gaps.flatMap((r) => r.flags.filter((f) => f.startsWith("gap:")))))
  console.log(`  ${k.padEnd(28)} ${v}`)
console.log("\ncue words needed:")
for (const [k, v] of count(rows.flatMap((r) => r.flags.filter((f) => f.startsWith("cue:")))))
  console.log(`  ${k.padEnd(28)} ${v}`)

console.log("\nrole frequency (queries containing role):")
for (const role of ROLES) {
  const c = rows.filter((r) => r.spans.some((s) => s.role === role)).length
  console.log(`  ${role.padEnd(12)} ${String(c).padStart(3)} ${pct(c)}`)
}
const negs = rows.filter((r) => r.spans.some((s) => s.neg)).length
console.log(`  ${"NEG".padEnd(12)} ${String(negs).padStart(3)} ${pct(negs)}`)
const onlyTopic = rows.filter((r) => r.spans.every((s) => s.role === "TOPIC")).length
console.log(`  topic-only   ${String(onlyTopic).padStart(3)} ${pct(onlyTopic)} (no filters to extract)`)

console.log("\nresolution needs (role fits, but a source must handle it):")
for (const [k, v] of count(rows.flatMap((r) => r.flags.filter((f) => f.startsWith("res:")))))
  console.log(`  ${k.padEnd(28)} ${v}`)

console.log("\nother flags:")
for (const [k, v] of count(
  rows.flatMap((r) => r.flags.filter((f) => !/^(gap|cue|res):/.test(f))),
))
  console.log(`  ${k.padEnd(28)} ${v}`)

console.log("\nper product (expressible incl. cue):")
for (const p of [...new Set(rows.map((r) => r.product))]) {
  const rs = rows.filter((r) => r.product === p)
  const ok = rs.filter((r) => !has(r, "gap:")).length
  console.log(`  ${p.padEnd(10)} ${ok}/${rs.length}`)
}

console.log("\nnot expressible:")
for (const r of gaps) console.log(`  [${r.product}] ${r.q}  →  ${r.flags.filter((f) => f.startsWith("gap:")).join(", ")}`)
