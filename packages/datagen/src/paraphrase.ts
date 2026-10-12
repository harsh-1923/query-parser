// PLAN §9.2 step 4: LLM paraphrases of template sentences. Labels are re-derived by aligning the
// kept span texts back into the paraphrase; anything that cannot be aligned is dropped, not guessed.
import { readFileSync } from "node:fs"
import { type Label, ROLES, type Role, tokenize } from "@qp/core"
import type { Lexicons } from "./lexicons"
import { isTime } from "./time"
import type { Example } from "./types"

export interface ParaphraseRecord {
  line: number
  source: string
  seed?: number
  text: string
  spans: { role: string; text: string }[]
  paraphrase: string
}

export interface AlignedSpan {
  role: Role
  text: string
}

export function loadParaphrases(path: string): ParaphraseRecord[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        const r = JSON.parse(l) as ParaphraseRecord
        return typeof r.paraphrase === "string" && Array.isArray(r.spans) ? [r] : []
      } catch {
        return []
      }
    })
}

const SPLIT_KIND = /^(pitch|tracker) (decks?|sheets?)$/i

/** Apply the annotation guideline to v0-era labels: "pitch deck" is TOPIC + KIND. */
function refine(spans: { role: string; text: string }[]): { role: string; text: string }[] {
  return spans.flatMap((s) => {
    const m = s.role === "KIND" ? SPLIT_KIND.exec(s.text) : null
    return m
      ? [
          { role: "TOPIC", text: m[1] as string },
          { role: "KIND", text: m[2] as string },
        ]
      : [s]
  })
}

export type AlignOutcome = { example: Omit<Example, "source" | "seed"> } | { reason: string }

/** Find every span exactly once as a whole-token, case-insensitive run and tag it BIO. */
export function alignSpans(text: string, rawSpans: { role: string; text: string }[]): AlignOutcome {
  const spans = refine(rawSpans)
  const tokens = tokenize(text)
  if (tokens.length === 0) return { reason: "empty" }
  const lower = tokens.map((t) => t.text.toLowerCase())
  const wanted = spans.map((s) => tokenize(s.text).map((t) => t.text.toLowerCase()))
  const keys = new Set<string>()
  for (let i = 0; i < spans.length; i++) {
    const k = `${spans[i]?.role}|${(wanted[i] as string[]).join(" ")}`
    if (!(wanted[i] as string[]).length) return { reason: "missing-span" }
    if (keys.has(k)) return { reason: "duplicate-span" }
    keys.add(k)
    if (!ROLES.includes(spans[i]?.role as Role)) return { reason: "unknown-role" }
  }
  const occurrences = (w: string[]): number[] => {
    const out: number[] = []
    for (let i = 0; i + w.length <= lower.length; i++) {
      if (w.every((x, j) => lower[i + j] === x)) out.push(i)
    }
    return out
  }
  const claimed: ([number, number] | undefined)[] = spans.map(() => undefined)
  const taken = new Array<boolean>(tokens.length).fill(false)
  const byLength = spans
    .map((_, i) => i)
    .sort((a, b) => (wanted[b]?.length ?? 0) - (wanted[a]?.length ?? 0) || a - b)
  for (const i of byLength) {
    const w = wanted[i] as string[]
    const all = occurrences(w)
    if (all.length === 0) return { reason: "missing-span" }
    const free = all.filter((at) => taken.slice(at, at + w.length).every((x) => !x))
    if (free.length === 0) return { reason: "overlap" }
    if (free.length > 1) return { reason: "duplicate-span" }
    const at = free[0] as number
    for (let k = at; k < at + w.length; k++) taken[k] = true
    claimed[i] = [at, at + w.length]
  }
  const tags: Label[] = tokens.map(() => "O")
  claimed.forEach((range, i) => {
    const [from, to] = range as [number, number]
    for (let k = from; k < to; k++) tags[k] = `${k === from ? "B" : "I"}-${spans[i]?.role}` as Label
  })
  // two spans of the same role touching would read as one span
  for (let k = 1; k < tags.length; k++) {
    const a = tags[k - 1] as string
    const b = tags[k] as string
    if (
      b.startsWith("B-") &&
      a !== "O" &&
      a.slice(2) === b.slice(2) &&
      b !== "B-KIND" &&
      b !== "B-ATTR"
    ) {
      return { reason: "adjacent-same-role" }
    }
  }
  return {
    example: {
      text,
      tokens: tokens.map((t) => t.text),
      offsets: tokens.map((t) => [t.start, t.end] as [number, number]),
      tags,
    },
  }
}

const MONTHS_DAYS = [
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "mon",
  "tue",
  "tues",
  "wed",
  "thu",
  "thur",
  "thurs",
  "fri",
  "today",
  "yesterday",
  "tomorrow",
  "tonight",
  "latest",
  "newest",
  "oldest",
  "earliest",
]
// Ordinary words that are also kind/state aliases; a paraphrase adding them rarely adds a constraint.
const COMMON_ALIAS = new Set([
  "post",
  "call",
  "page",
  "group",
  "room",
  "user",
  "member",
  "contact",
  "meet",
  "card",
  "mention",
  "started",
  "doing",
  "review",
  "testing",
  "complete",
  "saved",
  "summary",
  "sync",
  "chat",
  "normal",
  "medium",
  "slack",
  "ping",
  "say",
  "said",
  "wrote",
  "mail",
  "note",
  "reply",
])

const stem = (w: string): string => (w.length > 3 ? w.replace(/s$/, "") : w)

export interface AlignContext {
  /** Lowercase names that exist only in the test pools. */
  testOnlyNames: ReadonlySet<string>
  singleAliases: ReadonlySet<string>
  phraseAliases: readonly string[]
}

export function makeAlignContext(lex: Lexicons): AlignContext {
  const aliases = [...Object.values(lex.kinds).flat(), ...Object.values(lex.attrs).flat()].map(
    (a) => a.toLowerCase(),
  )
  const single = new Set<string>(MONTHS_DAYS.map(stem))
  const phrases: string[] = []
  for (const a of aliases) {
    const toks = tokenize(a).map((t) => t.text)
    if (toks.length === 1) {
      if (!COMMON_ALIAS.has(a)) single.add(stem(a))
    } else phrases.push(a)
  }
  const train = new Set<string>()
  const test = new Set<string>()
  for (const o of Object.values(lex.names)) {
    for (const n of [...o.train.first, ...o.train.last]) train.add(n)
    for (const n of [...o.test.first, ...o.test.last]) test.add(n)
  }
  return {
    testOnlyNames: new Set([...test].filter((n) => !train.has(n))),
    singleAliases: single,
    phraseAliases: phrases,
  }
}

const PERSON = new Set(["ACTOR", "RECIPIENT", "PARTICIPANT", "MENTION"])
const BAD_NEG_ATTR = /^(with|has|without|in|assigned)\b/

/** Align one record. Returns the labelled paraphrase, or the reason it was dropped. */
export function alignParaphrase(rec: ParaphraseRecord, ctx: AlignContext): AlignOutcome {
  const para = rec.paraphrase.trim()
  if (!para) return { reason: "empty" }
  if (para.length > 200) return { reason: "too-long" }
  if (para.toLowerCase().replace(/\s+/g, " ") === rec.text.toLowerCase().replace(/\s+/g, " ")) {
    return { reason: "unchanged" }
  }
  const hasNeg = rec.spans.some((s) => s.role === "NEG")
  if (hasNeg && rec.spans.some((s) => s.role === "ATTR" && BAD_NEG_ATTR.test(s.text))) {
    return { reason: "unnatural-negation" }
  }
  const aligned = alignSpans(para, rec.spans)
  if ("reason" in aligned) return aligned
  const original = new Set(tokenize(rec.text).map((t) => stem(t.text.toLowerCase())))
  const paraTokens = aligned.example.tokens.map((t) => stem(t.toLowerCase()))
  if (paraTokens.some((t) => ctx.singleAliases.has(t) && !original.has(t))) {
    return { reason: "new-constraint" }
  }
  const origLower = rec.text.toLowerCase()
  const paraLower = para.toLowerCase()
  const has = (hay: string, p: string): boolean =>
    new RegExp(
      `(^|[^\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`,
      "u",
    ).test(hay)
  if (ctx.phraseAliases.some((p) => has(paraLower, p) && !has(origLower, p))) {
    return { reason: "new-constraint" }
  }
  for (const s of rec.spans) {
    if (s.role === "TIME" && !isTime(s.text)) return { reason: "time-unparseable" }
    if (
      PERSON.has(s.role) &&
      s.text
        .toLowerCase()
        .split(/\s+/)
        .some((w) => ctx.testOnlyNames.has(w))
    ) {
      return { reason: "test-pool-name" }
    }
  }
  return aligned
}
