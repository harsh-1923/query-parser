import { CONFIGS, buildModel, mulberry32, tokenize } from "./model.ts"

// [query, name spans to resolve]
export const QUERIES = [
  ["priya's sheet on q3 collections", ["priya"]],
  ["rahul pdf from last week", ["rahul"]],
  ["reconciliation mismatch in #payments-ops", []],
  ["latest pitch deck", []],
  ["who said the settlement cutoff is 6pm", []],
  ["emails from ananya iyer about the audit", ["ananya iyer"]],
  ["tickets assigned to me that are still open", ["me"]],
  ["docs shared by vikram last month", ["vikram"]],
  ["messages from sneha and arjun yesterday", ["sneha", "arjun"]],
  ["invoice pdf from amazon", []],
  ["files edited by kavya nair this week", ["kavya nair"]],
  ["bugs reported by deepak in march", ["deepak"]],
  ["what did meera say about the launch", ["meera"]],
  ["unread emails from my manager", []],
  ["spreadsheet rohit sent me last friday", ["rohit"]],
  ["slides from the q2 review", []],
  ["high priority tickets for the payments team", []],
  ["calls with suresh last tuesday", ["suresh"]],
  ["anything from ishaan kapoor with attachments", ["ishaan kapoor"]],
  ["threads in #design-sync mentioning figma", []],
  ["not from neha", ["neha"]],
  ["pdfs i uploaded in august", ["i"]],
  ["onboarding doc by divya", ["divya"]],
  ["meeting notes from monday", []],
  ["blocked tickets assigned to aditya or pooja", ["aditya", "pooja"]],
  ["contracts signed by tanvi before june", ["tanvi"]],
  ["mails from prakash sharma between jan and march", ["prakash sharma"]],
  ["screenshots shared yesterday", []],
  ["roadmap", []],
  ["farhan's notes", ["farhan"]],
  ["budget sheet from finance", []],
  ["design review recording last wednesday", []],
  ["what's overdue", []],
  ["files shared with me by lakshmi", ["me", "lakshmi"]],
  ["hr policy pdf", []],
  ["messages containing refund in #support", []],
  ["tickets closed by manish last quarter", ["manish"]],
  ["slack threads from nikhil about the outage", ["nikhil"]],
  ["unassigned bugs", []],
  ["images from the offsite", []],
  ["emails from anjali menon about the vendor contract signed last week", ["anjali menon"]],
  ["docs created by rajesh kumar or shreya in the last 30 days", ["rajesh kumar", "shreya"]],
  ["urgent tickets assigned to harsh that were created after the release on friday", ["harsh"]],
  ["presentation about the new onboarding flow that ritu shared with the sales team", ["ritu"]],
  ["all mails from amit patel and varun gupta that mention invoices from last year", ["amit patel", "varun gupta"]],
  ["comments by sandeep on tickets in the growth board during september", ["sandeep"]],
  ["pdf attachments from vendor emails sent to me after the first of october", ["me"]],
  ["open bugs reported by customers in the mobile app last month and assigned to team infra", []],
  ["sheet", []],
  ["my drafts", ["my"]],
] as [string, string[]][]

const FIRST = ["aarav","aditya","akash","amit","ananya","anjali","arjun","deepak","divya","farhan","harsh","ishaan","kavya","lakshmi","manish","meera","neha","nikhil","pooja","prakash","priya","rahul","rajesh","ritu","rohit","sandeep","shreya","sneha","suresh","tanvi","varun","vikram","john","maria","chen","olga","omar","sara","liam","noah","emma","yuki"]
const LAST = ["sharma","iyer","nair","kapoor","menon","patel","gupta","kumar","singh","reddy","rao","das","joshi","mehta","shah","verma","khan","bose","pillar","desai","smith","garcia","kim","lee","novak","ito"]

export function makeDirectory(n = 1000) {
  const r = mulberry32(99)
  const out = []
  const seen = new Set()
  while (out.length < n) {
    const f = FIRST[Math.floor(r() * FIRST.length)]
    const l = LAST[Math.floor(r() * LAST.length)]
    const label = f + " " + l + (seen.has(f + l) ? " " + String.fromCharCode(97 + Math.floor(r() * 26)) : "")
    seen.add(f + l)
    out.push({ id: "u" + out.length, label, aliases: [f, f + "." + l + "@example.com"] })
  }
  return out
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}
function stats(xs) {
  const s = Float64Array.from(xs).sort()
  return { p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99) }
}
const f = (x) => x.toFixed(3)

// Build a query of exactly n tokens by cycling words from the query pool.
const POOL = QUERIES.flatMap(([q]) => tokenize(q))
function queryOfLen(n, salt) {
  const t = []
  for (let i = 0; i < n; i++) t.push(POOL[(salt * 7 + i * 13) % POOL.length])
  return t
}

export function runBench({ directorySource, now, log, iters = 2000 }) {
  const dir = makeDirectory(1000)
  const t0 = now()
  const source = directorySource(dir, { fields: (x) => x, self: "u0" })
  log(`directory index build (1000 people): ${f(now() - t0)} ms (one-off, excluded below)`)
  const tokenized = QUERIES.map(([q, spans]) => ({ q, toks: tokenize(q), spans }))
    log(`queries: ${QUERIES.length}; token counts min ${Math.min(...tokenized.map((x) => x.toks.length))} max ${Math.max(...tokenized.map((x) => x.toks.length))}`)
  const rows = []
  for (const cfg of CONFIGS) {
    for (const fmt of ["f32", "int8"]) {
      const m = buildModel(cfg, fmt)
      // sanity: decoding validity
      for (const x of tokenized) {
        const lab = m.run(x.toks)
        let prev = 0
        for (const c of lab) {
          if (c > 11 && !(prev === c - 11 || prev === c)) throw new Error("illegal BIO")
          prev = c
        }
      }
      // warm up
      for (let i = 0; i < 3000; i++) m.run(tokenized[i % tokenized.length].toks)
      // 1) mixed 50-query workload: 2000 iters, full model + viterbi
      const mixed = []
      for (let i = 0; i < iters; i++) {
        const x = tokenized[i % tokenized.length]
        const a = now()
        m.run(x.toks)
        mixed.push(now() - a)
      }
      // 2) fixed 10-token queries (synthesized to exact length)
      const scal = {}
      for (const n of [5, 10, 20, 30]) {
        const qs = [0, 1, 2, 3, 4].map((s) => queryOfLen(n, s))
        const xs = []
        for (let i = 0; i < iters; i++) {
          const a = now()
          m.run(qs[i % 5])
          xs.push(now() - a)
        }
        scal[n] = stats(xs)
      }
      // 3) end to end: tokenize + model + resolve. 10-token queries (synthesized token lists) with 1 or 2 name spans
      const e2e = []
      const resOnly = []
      let sink = 0
      const nameQs = tokenized.filter((x) => x.spans.length > 0 && !x.spans.includes("i") && !x.spans.includes("my"))
      const ten = [0, 1, 2, 3, 4, 5, 6, 7].map((s) => queryOfLen(10, s).join(" "))
      for (let i = 0; i < iters; i++) {
        const text = ten[i % ten.length]
        const spans = nameQs[i % nameQs.length].spans.slice(0, 1 + (i % 2))
        const a = now()
        const toks = tokenize(text)
        m.run(toks)
        const b = now()
        for (const sp of spans) {
          const r = source({ role: "ACTOR", text: sp, start: 0, end: sp.length, negated: false, confidence: 1 }, { query: text, role: "ACTOR", self: "u0", spans: [] })
          sink += r.length
        }
        const c = now()
        e2e.push(c - a)
        resOnly.push(c - b)
      }
      // resolution over ALL 50 queries (2000 iters) for reference
      const resAll = []
      for (let i = 0; i < iters; i++) {
        const x = tokenized[i % tokenized.length]
        if (!x.spans.length) { continue }
        const a = now()
        for (const sp of x.spans) sink += source({ role: "ACTOR", text: sp, start: 0, end: sp.length, negated: false, confidence: 1 }, { query: x.q, role: "ACTOR", self: "u0", spans: [] }).length
        resAll.push(now() - a)
      }
      const row = { cfg: cfg.name, fmt, params: m.params, mixed: stats(mixed), scal, e2e: stats(e2e), res: stats(resOnly), resAll: stats(resAll), sink }
      rows.push(row)
      log(`${cfg.name.padEnd(6)} ${fmt.padEnd(4)} params=${m.params}  mixed(50q) p50/p95/p99=${f(row.mixed.p50)}/${f(row.mixed.p95)}/${f(row.mixed.p99)} ms`)
      for (const n of [5, 10, 20, 30]) log(`    ${String(n).padStart(2)} tokens: p50/p95/p99=${f(scal[n].p50)}/${f(scal[n].p95)}/${f(scal[n].p99)} ms`)
      log(`    e2e (tokenize+model+resolve, ~10-token queries w/ names): p50/p95/p99=${f(row.e2e.p50)}/${f(row.e2e.p95)}/${f(row.e2e.p99)} ms; resolve only p50/p95/p99=${f(row.res.p50)}/${f(row.res.p95)}/${f(row.res.p99)} ms; resolve over all name queries p95=${f(row.resAll.p95)} ms`)
    }
  }
  return rows
}
