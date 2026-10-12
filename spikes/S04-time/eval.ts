// Runs the grammar and chrono-node over every phrase and compares both with gold.
// Usage: TZ=Asia/Kolkata node eval.ts > results.txt
import { readFileSync } from "node:fs"
import * as chrono from "chrono-node"
import { type Anchors, normalizeTime } from "./grammar.ts"

const REFERENCE = "2026-10-12T10:00:00.000Z" // Monday 15:30 in Asia/Kolkata
const TZ = "Asia/Kolkata"

const ANCHORS: Record<string, [string, string]> = {
  "this sprint": ["2026-10-05", "2026-10-19"],
  "last sprint": ["2026-09-21", "2026-10-05"],
  "sprint 14": ["2026-07-13", "2026-07-27"],
  offsite: ["2026-09-15", "2026-09-18"],
  "4.2.1": ["2026-08-20", "2026-08-21"],
  "release 4.2.1": ["2026-08-20", "2026-08-21"],
  "last release": ["2026-08-20", "2026-08-21"],
  launch: ["2026-09-01", "2026-09-02"],
  "code freeze": ["2026-09-28", "2026-10-02"],
}
const anchors: Anchors = (name, which) => {
  const r = ANCHORS[which ? `${which} ${name}` : name]
  return r && { from: r[0], to: r[1] }
}

type Gold = { phrase: string; from?: string | null; to?: string | null; g?: string; none?: string }
const lines = (f: string) =>
  readFileSync(new URL(f, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("# "))
const gold = new Map<string, Gold>()
for (const l of [...lines("gold-llm.jsonl"), ...lines("gold-heldout-llm.jsonl")]) {
  const g = JSON.parse(l) as Gold
  gold.set(g.phrase, g)
}
// Hand adjudication overrides: phrase<TAB>json<TAB>reason
for (const l of lines("adjudication.tsv")) {
  const [phrase, json] = l.split("\t")
  gold.set(phrase!, { phrase: phrase!, ...JSON.parse(json!) })
}

const occurrences: { source: string; family: string; phrase: string }[] = [
  ...lines("phrases-s2.tsv").map((l) => ({ source: "s2", family: "s2", phrase: l.split("\t")[1]! })),
  ...lines("phrases-llm.tsv").map((l) => {
    const [family, phrase] = l.split("\t")
    return { source: "llm", family: family!, phrase: phrase! }
  }),
  ...lines("phrases-heldout.tsv").map((l) => ({ source: "heldout", family: "heldout", phrase: l.split("\t")[1]! })),
]

type Answer = { from?: string; to?: string; g?: string } | null
const key = (a: Answer) => (a ? `${a.from ?? "–"} → ${a.to ?? "–"}` : "none")

function grammar(phrase: string): Answer {
  const r = normalizeTime(phrase, { reference: REFERENCE, timeZone: TZ, anchors })
  return r.ok ? { ...r.local, g: r.granularity } : null
}

// chrono-node: take the component's finest certain unit as the granularity of a point.
const pad = (n: number) => String(n).padStart(2, "0")
const localStr = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
function chronoIv(c: chrono.ParsedComponents): [Date, Date] {
  const d = c.date()
  const unit = c.isCertain("hour") ? "hour" : c.isCertain("day") || !c.isCertain("month") ? "day" : "month"
  const from = new Date(d.getFullYear(), unit === "month" ? d.getMonth() : d.getMonth(), unit === "month" ? 1 : d.getDate(), unit === "hour" ? d.getHours() : 0)
  const to = new Date(from)
  if (unit === "hour") to.setHours(to.getHours() + 1)
  else if (unit === "day") to.setDate(to.getDate() + 1)
  else to.setMonth(to.getMonth() + 1)
  if (!c.isCertain("month") && !c.isCertain("day") && c.isCertain("year")) {
    return [new Date(d.getFullYear(), 0, 1), new Date(d.getFullYear() + 1, 0, 1)]
  }
  return [from, to]
}
function chronoAnswer(phrase: string): { answer: Answer; covered: boolean } {
  const rs = chrono.en.GB.parse(phrase, new Date(REFERENCE), { forwardDate: false }) // day-first, like our default
  const r = rs[0]
  if (!r) return { answer: null, covered: false }
  const [f] = chronoIv(r.start)
  const t = r.end ? chronoIv(r.end)[1] : chronoIv(r.start)[1]
  const covered = r.text.length >= phrase.replace(/^(on|in|from|the)\s+/i, "").length - 1
  return { answer: { from: localStr(f), to: localStr(t) }, covered }
}

type Verdict = "correct" | "unsupported" | "wrong"
function judge(answer: Answer, g: Gold | undefined): Verdict {
  if (!g) throw new Error("missing gold")
  const goldNone = g.none !== undefined
  if (!answer) return "unsupported" // correct when gold is none; counted separately
  if (goldNone) return "wrong"
  return (answer.from ?? null) === (g.from ?? null) && (answer.to ?? null) === (g.to ?? null) ? "correct" : "wrong"
}

const rows = occurrences.map((o) => {
  const g = gold.get(o.phrase)
  const ga = grammar(o.phrase)
  const ca = chronoAnswer(o.phrase)
  return {
    ...o,
    gold: g,
    goldNone: g?.none !== undefined,
    grammar: ga,
    gv: judge(ga, g),
    chrono: ca.answer,
    chronoCovered: ca.covered,
    cv: judge(ca.answer, g),
  }
})

const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`
function summary(label: string, rs: typeof rows) {
  const answerable = rs.filter((r) => !r.goldNone)
  const none = rs.filter((r) => r.goldNone)
  const s = (v: "gv" | "cv") => {
    const correct = answerable.filter((r) => r[v] === "correct").length
    const unsup = answerable.filter((r) => r[v] === "unsupported").length
    const wrongA = answerable.filter((r) => r[v] === "wrong").length
    const wrongN = none.filter((r) => r[v] === "wrong").length
    const okNone = none.filter((r) => r[v] === "unsupported").length
    return `correct ${correct}/${answerable.length} (${pct(correct, answerable.length)}), unsupported ${unsup}, wrong ${wrongA + wrongN} (${wrongA} wrong range, ${wrongN} answered a none), none handled ${okNone}/${none.length}`
  }
  console.log(`\n## ${label}: ${rs.length} phrases, ${answerable.length} with a definite answer, ${none.length} none`)
  console.log(`grammar: ${s("gv")}`)
  console.log(`chrono:  ${s("cv")}`)
}

console.log(`# S04 results · reference ${REFERENCE} (${TZ}) · chrono-node 2.10.1 (en.GB, day-first)`)
summary("S2 TIME spans (every occurrence)", rows.filter((r) => r.source === "s2"))
summary("kimi-k3 phrases", rows.filter((r) => r.source === "llm"))
summary("Held-out kimi-k3 phrases (grammar frozen before they were written)", rows.filter((r) => r.source === "heldout"))
const uniq = [...new Map(rows.map((r) => [r.phrase, r])).values()]
summary("All unique phrases", uniq)

console.log("\n## By family (unique kimi phrases): grammar correct / answerable, wrong")
const fams = [...new Set(rows.filter((r) => r.source === "llm").map((r) => r.family))]
for (const f of fams) {
  const rs = rows.filter((r) => r.family === f)
  const a = rs.filter((r) => !r.goldNone)
  const pick = (v: "gv" | "cv") => `${a.filter((r) => r[v] === "correct").length}/${a.length}, wrong ${rs.filter((r) => r[v] === "wrong").length}`
  console.log(`${f.padEnd(16)} grammar ${pick("gv").padEnd(16)} chrono ${pick("cv")}`)
}

const show = (title: string, rs: typeof uniq, fn: (r: (typeof uniq)[number]) => string) => {
  console.log(`\n## ${title} (${rs.length})`)
  for (const r of rs) console.log(fn(r))
}
const goldStr = (r: (typeof uniq)[number]) => (r.goldNone ? `none (${r.gold?.none})` : key(r.gold as Answer))
const tag = (r: (typeof uniq)[number]) => (r.source === "heldout" ? " [held-out]" : "")
show("Grammar wrong", uniq.filter((r) => r.gv === "wrong"), (r) => `${r.phrase}${tag(r)}\tgot ${key(r.grammar)}\tgold ${goldStr(r)}`)
show("Grammar unsupported, gold has an answer", uniq.filter((r) => r.gv === "unsupported" && !r.goldNone), (r) => `${r.phrase}${tag(r)}\tgold ${goldStr(r)}`)
show("Grammar unsupported, gold none (correct)", uniq.filter((r) => r.gv === "unsupported" && r.goldNone), (r) => `${r.phrase}\t${r.gold?.none}`)
show("Grammar ≠ chrono, both answered", uniq.filter((r) => r.grammar && r.chrono && key(r.grammar) !== key(r.chrono)), (r) => `${r.phrase}\tgrammar ${key(r.grammar)}\tchrono ${key(r.chrono)}${r.chronoCovered ? "" : " (partial)"}`)
show("chrono no parse", uniq.filter((r) => !r.chrono), (r) => r.phrase)
