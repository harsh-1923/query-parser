// Runs every KIND/ATTR span (S02 hand gold + held-out kimi gold) through the matcher.
// Usage: node eval.mjs [v1|v2] > results-<v>.txt   (default v2)
import { existsSync, readFileSync } from "node:fs"
import { buildIndex, match } from "./matcher.mjs"
import { XYNE } from "./xyne.mjs"

const version = process.argv[2] ?? "v2"
const { ATTR_ALIASES, KIND_ALIASES } = await import(version === "v1" ? "./aliases-v1.mjs" : "./aliases.mjs")
const idx = { KIND: buildIndex(KIND_ALIASES), ATTR: buildIndex(ATTR_ALIASES) }
console.log(`# S05 alias matcher, aliases ${version} (${Object.values(KIND_ALIASES).flat().length} kind, ${Object.values(ATTR_ALIASES).flat().length} attr aliases)`)
const read = (f) =>
  readFileSync(new URL(f, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("# "))

const sets = {
  s2: read("gold-s2.tsv").map((l) => {
    const [role, text, gold, query] = l.split("\t")
    return { role, text, gold, query }
  }),
}
const adj = new Map(
  existsSync(new URL("adjudication.tsv", import.meta.url))
    ? read("adjudication.tsv").map((l) => {
        const [role, text, gold] = l.split("\t")
        return [`${role}\t${text}`, gold]
      })
    : [],
)
const heldout = (f) =>
  read(f)
    .map((l) => JSON.parse(l))
    .map((s) => ({ ...s, gold: adj.get(`${s.role}\t${s.text}`) ?? s.gold ?? "none" }))
if (existsSync(new URL("heldout.jsonl", import.meta.url)))
  sets["heldout-1 (v2 vocabulary was built from its misses)"] = heldout("heldout.jsonl")
if (existsSync(new URL("heldout-2.jsonl", import.meta.url)))
  sets["heldout-2 (fresh, never used for aliases)"] = heldout("heldout-2.jsonl")

function judge(s) {
  const m = match(idx[s.role], s.text, { headFallback: s.role === "KIND" })
  const golds = s.gold.split("|")
  const got = m?.key ?? "none"
  const verdict = golds.includes(got) ? "correct" : got === "none" ? "miss" : "wrong"
  return { ...s, got, stage: m?.stage ?? "-", verdict }
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-")
for (const [name, spans] of Object.entries(sets)) {
  const rs = spans.filter((s) => s.gold !== "operator").map(judge)
  console.log(`\n## ${name}: ${rs.length} spans (${spans.length - rs.length} key:value operators excluded, PLAN §5.8)`)
  for (const role of ["KIND", "ATTR", "all"]) {
    const r = rs.filter((x) => role === "all" || x.role === role)
    const answerable = r.filter((x) => x.gold !== "none")
    const correct = answerable.filter((x) => x.verdict === "correct").length
    const wrong = r.filter((x) => x.verdict === "wrong").length
    const noneOk = r.filter((x) => x.gold === "none" && x.verdict === "correct").length
    console.log(
      `${role.padEnd(5)} resolved ${correct}/${answerable.length} (${pct(correct, answerable.length)}), wrong ${wrong}, misses ${answerable.length - correct - answerable.filter((x) => x.verdict === "wrong").length}, dynamic/none kept as text ${noneOk}/${r.length - answerable.length}`,
    )
  }
  const stages = {}
  for (const r of rs.filter((x) => x.verdict === "correct" && x.got !== "none")) stages[r.stage] = (stages[r.stage] ?? 0) + 1
  console.log(`correct by stage: ${JSON.stringify(stages)}`)
  const uniq = (xs) => [...new Map(xs.map((x) => [`${x.role}\t${x.text}`, x])).values()]
  console.log(`\nwrong (unique):`)
  for (const r of uniq(rs.filter((x) => x.verdict === "wrong"))) console.log(`  ${r.role}\t${r.text}\tgot ${r.got} (${r.stage})\tgold ${r.gold}\t| ${r.query}`)
  console.log(`misses (unique):`)
  for (const r of uniq(rs.filter((x) => x.verdict === "miss"))) console.log(`  ${r.role}\t${r.text}\tgold ${r.gold}\t| ${r.query}`)
}

// What Xyne Spaces can express for each key (from its search API; see xyne.mjs).
console.log("\n## Xyne Spaces coverage of resolved S02 spans")
const s2 = sets.s2.filter((s) => s.gold !== "operator" && s.gold !== "none").map(judge).filter((r) => r.verdict === "correct")
const how = { filter: 0, parent: 0, unbound: 0 }
const unbound = {}
for (const r of s2) {
  const x = XYNE[r.got]
  how[x.how]++
  if (x.how === "unbound") unbound[r.got] = (unbound[r.got] ?? 0) + 1
}
console.log(`exact filter ${how.filter}, broader parent filter ${how.parent}, unbound (falls back to text) ${how.unbound} of ${s2.length}`)
console.log(`unbound keys: ${JSON.stringify(unbound)}`)
