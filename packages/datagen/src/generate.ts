// Template expansion, label alignment and split generation (PLAN §9.2, §9.3).
import { type Label, type Role, tokenize } from "@qp/core"
import { type Lexicons, loadLexicons } from "./lexicons"
import { chance, hashString, int, mulberry32, pick, type Rng, shuffle } from "./rng"
import { type Ctx, fillSlot, type Piece, preparePools, type Side } from "./slots"
import { MACROS, TEMPLATES, type Template } from "./templates"
import { createTimeGen, isTime, REFERENCE, TIME_ZONE } from "./time"
import type { Example, GenerateOptions, GenerateResult, Split, SplitStats, Stats } from "./types"

export { REFERENCE, TIME_ZONE }

const SPLITS: Split[] = ["train", "val", "test-generated"]
const FILLER_PREFIX = [
  "show me",
  "find",
  "any",
  "pls",
  "search",
  "get me",
  "look for",
  "list",
  "can you find",
]
const FILLER_SUFFIX = ["pls", "please", "thanks"]
const SLOT = /\{([A-Z]+)((?:\|[a-z]+)*)\}/g

export const normalizeText = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim()

function typo(rng: Rng, word: string): string {
  if (word.length < 5 || !/^[a-z]+$/.test(word)) return word
  if (chance(rng, 0.5)) {
    const i = 1 + int(rng, word.length - 3) // swap letters i, i+1; never the first or last letter
    if (word[i] === word[i + 1]) return word
    return word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2)
  }
  const i = 1 + int(rng, word.length - 2)
  return word.slice(0, i) + word.slice(i + 1)
}

/** Expand a pattern into labelled pieces. Returns undefined when a slot could not be filled. */
function expand(ctx: Ctx, tpl: Template, side: Side): Piece[] | undefined {
  if (tpl.make) return tpl.make(ctx.rng, side)
  let pattern = tpl.pattern as string
  for (const [macro, text] of Object.entries(MACROS)) pattern = pattern.replaceAll(macro, text)
  pattern = pattern.replace(/<([^>]+)>/g, (_, alts: string) => pick(ctx.rng, alts.split("|")))
  const pieces: Piece[] = []
  for (const token of pattern.split(" ")) {
    let cursor = 0
    let first = true
    const push = (parts: Piece[]): void => {
      parts.forEach((p, i) => {
        pieces.push(i === 0 ? { ...p, glue: p.glue ?? !first } : p)
        if (i === 0) first = false
      })
    }
    for (const m of token.matchAll(SLOT)) {
      const at = m.index ?? 0
      if (at > cursor) push([{ text: token.slice(cursor, at), role: null }])
      const mods = (m[2] ?? "").split("|").filter(Boolean)
      const filled = fillSlot(ctx, m[1] as string, mods)
      if (filled.length === 0) return undefined
      push(filled)
      cursor = at + m[0].length
    }
    if (cursor < token.length) push([{ text: token.slice(cursor), role: null }])
  }
  return pieces
}

function decorate(ctx: Ctx, tpl: Template, pieces: Piece[]): Piece[] {
  const { rng } = ctx
  const out = pieces.map((p) => {
    if (!p.typo) return p
    const words = p.text.split(" ").map((w) => (chance(rng, 0.05) ? typo(rng, w) : w))
    return { ...p, text: words.join(" ") }
  })
  if (tpl.id.startsWith("q_") || tpl.id === "none_question") {
    if (chance(rng, 0.5)) out.push({ text: "?", role: null, glue: true })
  }
  if (tpl.negative) return out
  if (chance(rng, 0.1)) out.unshift({ text: pick(rng, FILLER_PREFIX), role: null })
  if (chance(rng, 0.03)) out.push({ text: pick(rng, FILLER_SUFFIX), role: null })
  return out
}

/** Join pieces and map their roles onto `tokenize` output. A string result is the drop reason. */
export function labelPieces(pieces: Piece[]): Omit<Example, "source" | "seed"> | string {
  let text = ""
  const spans: { start: number; end: number; role: Role | null }[] = []
  pieces.forEach((p, i) => {
    if (i > 0 && !p.glue) text += " "
    spans.push({ start: text.length, end: text.length + p.text.length, role: p.role })
    text += p.text
  })
  const tokens = tokenize(text)
  const tags: Label[] = []
  const started = new Set<number>()
  for (const tok of tokens) {
    const overlap: number[] = []
    spans.forEach((s, i) => {
      if (tok.start < s.end && s.start < tok.end) overlap.push(i)
    })
    const roled = overlap.filter((i) => spans[i]?.role)
    if (roled.length === 0) {
      tags.push("O")
      continue
    }
    const i = roled[0] as number
    const s = spans[i] as (typeof spans)[number]
    if (overlap.length !== 1 || tok.start < s.start || tok.end > s.end) return "misaligned"
    tags.push(`${started.has(i) ? "I" : "B"}-${s.role}` as Label)
    started.add(i)
  }
  for (let i = 0; i < spans.length; i++) if (spans[i]?.role && !started.has(i)) return "empty-span"
  return {
    text,
    tokens: tokens.map((t) => t.text),
    offsets: tokens.map((t) => [t.start, t.end] as [number, number]),
    tags,
  }
}

/** Weighted schedule: normal templates weight 10; negative templates share ~10% of the total. */
function buildSchedule(rng: Rng, templates: Template[]): Template[] {
  const normal = templates.filter((t) => !t.negative)
  const negative = templates.filter((t) => t.negative)
  // negatives get ~10% of the schedule
  const negWeight = negative.length
    ? Math.max(1, Math.round((normal.length * 10) / 9 / negative.length))
    : 0
  const list: Template[] = []
  for (const t of normal) for (let k = 0; k < 10; k++) list.push(t)
  for (const t of negative) for (let k = 0; k < negWeight; k++) list.push(t)
  return shuffle(rng, list)
}

export function heldOutTemplateIds(): string[] {
  return TEMPLATES.filter((t) => t.heldOut).map((t) => t.id)
}

interface SplitRun {
  examples: Example[]
  stats: SplitStats
  timeRejected: number
  namesFiltered: number
}

function generateSplit(
  split: Split,
  count: number,
  opts: GenerateOptions,
  lex: Lexicons,
  seen: Set<string>,
  contamination: { dropped: number },
): SplitRun {
  const side: Side = split === "test-generated" ? "test" : "train"
  const rng = mulberry32(hashString(`${opts.seed}:${split}`))
  const { pools, filtered } = preparePools(lex, side)
  const time = createTimeGen(rng)
  const ctx: Ctx = { rng, pools, time, cyclers: new Map(), usedNames: new Set() }
  const templates = TEMPLATES.filter((t) =>
    t.negative ? true : split === "test-generated" ? t.heldOut : !t.heldOut,
  )
  const schedule = buildSchedule(rng, templates)
  const examples: Example[] = []
  const stats: SplitStats = {
    examples: 0,
    perTemplate: {},
    perRole: {},
    uniqueNames: 0,
    namePoolSize: pools.origins.reduce((n, o) => n + o.pool.first.length, 0),
    drops: {},
  }
  const drop = (reason: string): void => {
    stats.drops[reason] = (stats.drops[reason] ?? 0) + 1
  }
  let cursor = 0
  for (let attempts = 0; examples.length < count && attempts < count * 40 + 1000; attempts++) {
    const tpl = schedule[cursor++ % schedule.length] as Template
    const raw = expand(ctx, tpl, side)
    if (!raw) {
      drop("slot-unfilled")
      continue
    }
    const labelled = labelPieces(decorate(ctx, tpl, raw))
    if (typeof labelled === "string") {
      drop(labelled)
      continue
    }
    const timeBad = labelled.tags.some((t, i) => {
      if (t !== "B-TIME") return false
      let j = i + 1
      while (labelled.tags[j] === "I-TIME") j++
      const start = labelled.offsets[i]?.[0] ?? 0
      const end = labelled.offsets[j - 1]?.[1] ?? 0
      return !isTime(labelled.text.slice(start, end))
    })
    if (timeBad) {
      drop("time-unparseable")
      continue
    }
    const key = normalizeText(labelled.text)
    if (opts.blocklist?.has(key)) {
      contamination.dropped++
      drop("contamination")
      continue
    }
    // Negatives come from small phrase lists, so repeats (and train/val overlap) are expected and harmless.
    if (!tpl.negative) {
      if (seen.has(key)) {
        drop("duplicate")
        continue
      }
      seen.add(key)
    }
    examples.push({ ...labelled, source: `template:${tpl.id}`, seed: opts.seed })
    stats.perTemplate[tpl.id] = (stats.perTemplate[tpl.id] ?? 0) + 1
    for (const tag of labelled.tags) {
      if (tag.startsWith("B-")) stats.perRole[tag.slice(2)] = (stats.perRole[tag.slice(2)] ?? 0) + 1
    }
  }
  stats.examples = examples.length
  stats.uniqueNames = ctx.usedNames.size
  return { examples, stats, timeRejected: time.rejected, namesFiltered: filtered }
}

const sortKeys = <T extends Record<string, number>>(o: T): T =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))) as T

export function generate(
  opts: GenerateOptions,
  lexicons: Lexicons = loadLexicons(),
): GenerateResult {
  const counts: Record<Split, number> = {
    train: opts.train,
    val: opts.val,
    "test-generated": opts.test,
  }
  const seen = new Set<string>()
  const contamination = { dropped: 0 }
  const splits = {} as Record<Split, Example[]>
  const splitStats = {} as Record<Split, SplitStats>
  let timeRejected = 0
  let namesFiltered = 0
  for (const split of SPLITS) {
    const run = generateSplit(split, counts[split], opts, lexicons, seen, contamination)
    splits[split] = run.examples
    run.stats.perTemplate = sortKeys(run.stats.perTemplate)
    run.stats.perRole = sortKeys(run.stats.perRole)
    run.stats.drops = sortKeys(run.stats.drops)
    splitStats[split] = run.stats
    timeRejected += run.timeRejected
    namesFiltered += run.namesFiltered
  }
  const held = heldOutTemplateIds()
  const stats: Stats = {
    seed: opts.seed,
    reference: REFERENCE,
    timeZone: TIME_ZONE,
    splits: splitStats,
    templates: { total: TEMPLATES.length, heldOut: held.length, heldOutIds: held },
    contaminationDropped: contamination.dropped,
    timeRejected,
    namesFiltered,
  }
  return { splits, stats }
}

export function serialize(examples: Example[]): string {
  return examples.length ? `${examples.map((e) => JSON.stringify(e)).join("\n")}\n` : ""
}
