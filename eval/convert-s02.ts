// Converts gold spans (annotations.tsv) into BIO JSONL in the fixture format, applying
// eval/ANNOTATION.md as normalization. The annotations file is not modified.
// Run: node eval/convert-s02.ts [--in <annotations.tsv>] [--txt-dir <dir>] [--out <bio.jsonl>]
//                               [--log <normalization.log>] [--source <name>]
// Defaults reproduce S02 -> eval/datasets/llm-written/v0/{bio.jsonl,normalization.log}.
// --txt-dir holds the per-product query files (<product>.txt) used to look up each query's product.
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

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

const { tokenize } = await import("../packages/core/src/tokenize.ts")
const { normalizeTime } = await import("../packages/time/src/index.ts")

const REFERENCE = "2026-10-12T10:00:00Z"
const TIME_ZONE = "Asia/Kolkata"
const KINDS = new URL("../packages/datagen/lexicons/kinds.json", import.meta.url)
const V0 = new URL("./datasets/llm-written/v0/", import.meta.url)

const { values: args } = parseArgs({
  options: {
    in: { type: "string" },
    "txt-dir": { type: "string" },
    out: { type: "string" },
    log: { type: "string" },
    source: { type: "string", default: "s02" },
  },
})
const toUrl = (path: string | undefined, fallback: URL): URL =>
  path === undefined ? fallback : pathToFileURL(resolve(path))
const ANNOTATIONS = toUrl(
  args.in,
  new URL("../spikes/S02-role-coverage/annotations.tsv", import.meta.url),
)
const TXT_DIR = toUrl(args["txt-dir"], V0)
const TXT_BASE = TXT_DIR.href.endsWith("/") ? TXT_DIR : new URL(`${TXT_DIR.href}/`)
const OUT = toUrl(args.out, new URL("bio.jsonl", V0))
const LOG = toUrl(args.log, new URL("normalization.log", V0))
const SOURCE = args.source ?? "s02"

const CONTAINER_NOUNS = new Set(["channel", "board", "project", "folder", "repo", "space", "team"])
const DETERMINERS = new Set(["the", "a", "an", "our", "this"])
const TIME_OPERATORS = new Set([
  "before",
  "after",
  "since",
  "until",
  "by",
  "from",
  "on",
  "in",
  "during",
  "between",
])
const NEGATION_WORDS = new Set(["not", "except", "excluding", "exclude", "without", "no"])

interface Span {
  role: string
  start: number
  end: number
  neg: boolean
}

const kindAliases: string[] = Object.values(
  (JSON.parse(readFileSync(KINDS, "utf8")) as { aliases: Record<string, string[]> }).aliases,
).flat()
const kindSet = new Set(kindAliases.map((a) => a.toLowerCase()))
const isKindWord = (phrase: string): boolean => {
  const p = phrase.toLowerCase()
  return kindSet.has(p) || kindSet.has(p.replace(/(es|s)$/, "")) || kindSet.has(p.replace(/s$/, ""))
}

const logLines: string[] = []
const ruleCounts = new Map<string, number>()
function log(query: string, before: string, after: string, rule: string): void {
  logLines.push(`${query}\t${before} → ${after}\t${rule}`)
  ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1)
}

// product file per query
const products = new Map<string, string>()
for (const f of readdirSync(TXT_BASE)) {
  if (!f.endsWith(".txt")) continue
  for (const line of readFileSync(new URL(f, TXT_BASE), "utf8").split("\n")) {
    const q = line.trim()
    if (q && !products.has(q)) products.set(q, f.replace(/\.txt$/, ""))
  }
}

function goldSpans(query: string, field: string): Span[] | string {
  const spans: Span[] = []
  const tokens = tokenize(query)
  let from = 0
  for (const raw of field.split("|")) {
    if (!raw) continue
    const neg = raw.startsWith("!")
    const item = neg ? raw.slice(1) : raw
    const colon = item.indexOf(":")
    const role = item.slice(0, colon)
    const text = item.slice(colon + 1)
    const lower = query.toLowerCase()
    const needle = text.toLowerCase()
    let start = lower.indexOf(needle, from)
    // prefer an occurrence on token boundaries ("i" must not match inside "things")
    for (let at = start; at >= 0; at = lower.indexOf(needle, at + 1)) {
      if (tokens.some((t) => t.start === at) && tokens.some((t) => t.end === at + needle.length)) {
        start = at
        break
      }
    }
    if (start < 0) return `span not found after offset ${from}: ${role}:${text}`
    spans.push({ role, start, end: start + text.length, neg })
    from = start + text.length
  }
  return spans
}

const wordsOf = (s: string): { w: string; start: number; end: number }[] =>
  [...s.matchAll(/\S+/g)].map((m) => ({
    w: m[0],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }))

function normalizeContainer(query: string, span: Span): Span {
  let { start, end } = span
  const ws = wordsOf(query.slice(start, end))
  let lo = 0
  let hi = ws.length
  while (hi - lo > 1 && DETERMINERS.has((ws[lo]?.w ?? "").toLowerCase())) lo++
  if (hi - lo > 1 && CONTAINER_NOUNS.has((ws[hi - 1]?.w ?? "").toLowerCase())) hi--
  if (lo === 0 && hi === ws.length) return span
  start = span.start + (ws[lo]?.start ?? 0)
  end = span.start + (ws[hi - 1]?.end ?? 0)
  return { ...span, start, end }
}

function splitOrder(query: string, span: Span): Span[] {
  const ws = wordsOf(query.slice(span.start, span.end))
  if (ws.length < 2) return [span]
  for (const n of [2, 1]) {
    if (ws.length - n < 1) continue
    const phrase = ws
      .slice(ws.length - n)
      .map((x) => x.w)
      .join(" ")
    if (isKindWord(phrase)) {
      const cut = span.start + (ws[ws.length - n]?.start ?? 0)
      const orderEnd = span.start + (ws[ws.length - n - 1]?.end ?? 0)
      return [
        { ...span, end: orderEnd },
        { role: "KIND", start: cut, end: span.end, neg: span.neg },
      ]
    }
  }
  return [span]
}

const timeOk = (text: string): boolean =>
  normalizeTime(text, { reference: REFERENCE, timeZone: TIME_ZONE }).ok === true

function normalizeSpans(query: string, spans: Span[]): Span[] {
  const tokens = tokenize(query)
  const out: Span[] = []
  for (const original of spans) {
    let span = original
    if (span.role === "CONTAINER") {
      const next = normalizeContainer(query, span)
      if (next !== span) {
        log(
          query,
          query.slice(span.start, span.end),
          query.slice(next.start, next.end),
          "container-noun",
        )
        span = next
      }
    }
    if (span.role === "ORDER") {
      const parts = splitOrder(query, span)
      if (parts.length > 1) {
        log(
          query,
          `ORDER:${query.slice(span.start, span.end)}`,
          parts.map((p) => `${p.role}:${query.slice(p.start, p.end)}`).join(" + "),
          "order-kind-split",
        )
        out.push(...parts)
        continue
      }
    }
    if (span.role === "TIME") {
      const prev = [...tokens].reverse().find((t) => t.end <= span.start)
      const prevSpanEnd = out.length ? (out[out.length - 1]?.end ?? 0) : 0
      if (
        prev &&
        TIME_OPERATORS.has(prev.text.toLowerCase()) &&
        prev.start >= prevSpanEnd &&
        query.slice(prev.end, span.start).trim() === ""
      ) {
        const extended = query.slice(prev.start, span.end)
        const already = TIME_OPERATORS.has(
          query.slice(span.start, span.end).split(/\s+/)[0]?.toLowerCase() ?? "",
        )
        // "commented on last week": the preposition belongs to the verb, not the time.
        const before = [...tokens].reverse().find((t) => t.end <= prev.start)
        const verbParticle = before !== undefined && /ed$/i.test(before.text)
        if (!already && !verbParticle && timeOk(extended)) {
          log(query, query.slice(span.start, span.end), extended, "time-operator")
          span = { ...span, start: prev.start }
        }
      }
    }
    out.push(span)
  }
  return out
}

interface Example {
  text: string
  tokens: string[]
  offsets: [number, number][]
  tags: string[]
  source: string
  product?: string
}

const stats = { total: 0, written: 0, misaligned: 0, parseErrors: 0, negTags: 0, negNoWord: 0 }
const problems: string[] = []
const examples: Example[] = []

for (const line of readFileSync(ANNOTATIONS, "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("# query\t")) continue
  const [query = "", spanField = ""] = line.split("\t")
  stats.total++
  const gold = goldSpans(query, spanField)
  if (typeof gold === "string") {
    stats.parseErrors++
    problems.push(`${query}: ${gold}`)
    continue
  }
  const spans = normalizeSpans(query, gold)
  const tokens = tokenize(query)
  const tags: string[] = tokens.map(() => "O")
  let bad = false
  for (const span of spans) {
    const first = tokens.findIndex((t) => t.start === span.start)
    const last = tokens.findIndex((t) => t.end === span.end)
    if (first < 0 || last < first) {
      bad = true
      problems.push(
        `${query}: misaligned ${span.role}:${JSON.stringify(query.slice(span.start, span.end))}`,
      )
      continue
    }
    for (let i = first; i <= last; i++) tags[i] = `${i === first ? "B" : "I"}-${span.role}`
  }
  if (bad) {
    stats.misaligned++
    continue
  }
  for (const span of spans) {
    if (!span.neg) continue
    const first = tokens.findIndex((t) => t.start === span.start)
    let tagged = false
    for (let i = first - 1; i >= Math.max(0, first - 3); i--) {
      const tok = tokens[i]
      if (tags[i] === "O" && tok && NEGATION_WORDS.has(tok.text.toLowerCase())) {
        tags[i] = "B-NEG"
        log(
          query,
          `!${span.role}:${query.slice(span.start, span.end)}`,
          `NEG:${tok.text}`,
          "neg-tag",
        )
        stats.negTags++
        tagged = true
        break
      }
      if (tags[i] === "B-NEG" || tags[i] === "I-NEG") {
        tagged = true // an earlier negated span in the same or-list already carries the NEG word
        break
      }
    }
    if (!tagged) stats.negNoWord++
  }
  const ex: Example = {
    text: query,
    tokens: tokens.map((t) => t.text),
    offsets: tokens.map((t) => [t.start, t.end]),
    tags,
    source: SOURCE,
  }
  const product = products.get(query.trim())
  if (product) ex.product = product
  examples.push(ex)
  stats.written++
}

writeFileSync(OUT, `${examples.map((e) => JSON.stringify(e)).join("\n")}\n`)
writeFileSync(LOG, `${logLines.join("\n")}\n`)
console.log(stats)
console.log(Object.fromEntries(ruleCounts))
console.log(`with product: ${examples.filter((e) => e.product).length}`)
for (const p of problems) console.log("PROBLEM", p)
