// Template expansion, label alignment and split generation (PLAN §9.2, §9.3).
import { type Label, type Role, tokenize } from "@qp/core"
import { drawPlan, fillPlan, isHeldOutSignature } from "./bag"
import { type Lexicons, loadLexicons } from "./lexicons"
import { alignParaphrase, alignSpans, makeAlignContext, type ParaphraseRecord } from "./paraphrase"
import { chance, hashString, int, mulberry32, pick, type Rng, shuffle } from "./rng"
import { type Ctx, fillSlot, type Piece, preparePools, type Side } from "./slots"
import { MACROS, TEMPLATES, type Template } from "./templates"
import { createTimeGen, isTime, REFERENCE, TIME_ZONE } from "./time"
import type {
  Example,
  GenerateOptions,
  GenerateResult,
  ParaphraseStats,
  Split,
  SplitStats,
  Stats,
} from "./types"

export { REFERENCE, TIME_ZONE }

const SPLITS: Split[] = ["train", "val", "test-generated", "test-seen-templates-unseen-names"]
const NEG_SHARE = 0.1

interface SplitSpec {
  /** Which name pools fill person slots. */
  names: Side
  /** Which template shapes: those used in training, or the held-out ones. */
  shapes: "train" | "held-out"
  bagShare: number
}
const SPEC: Record<Split, SplitSpec> = {
  train: { names: "train", shapes: "train", bagShare: 0.7 },
  val: { names: "train", shapes: "train", bagShare: 0.7 },
  "test-generated": { names: "test", shapes: "held-out", bagShare: 0.45 },
  "test-seen-templates-unseen-names": { names: "test", shapes: "train", bagShare: 0.7 },
}
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
  "where is",
  "where are",
  "that",
  "which",
  "the one where",
  "do we have",
  "got any",
  "i need",
  "looking for",
  "the",
  "all",
  "all the",
  "some",
  "pls find",
  "hey find",
]
const FILLER_SUFFIX = ["pls", "please", "thanks", "asap", "if any", "pls?"]
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

function decorate(ctx: Ctx, tpl: Pick<Template, "id" | "negative">, pieces: Piece[]): Piece[] {
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
  if (chance(rng, 0.2)) out.unshift({ text: pick(rng, FILLER_PREFIX), role: null })
  if (chance(rng, 0.05)) out.push({ text: pick(rng, FILLER_SUFFIX), role: null })
  if (chance(rng, 0.07)) out.push({ text: "?", role: null, glue: true })
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
  for (let i = 1; i < pieces.length; i++) {
    const a = pieces[i - 1] as Piece
    const b = pieces[i] as Piece
    if (!b.glue && a.role && a.role === b.role && a.role !== "KIND" && a.role !== "ATTR") {
      return "adjacent-same-role"
    }
  }
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

/** Round-robin schedule over templates, reshuffled per lap by construction (one shuffled list). */
function buildSchedule(rng: Rng, templates: Template[]): Template[] {
  const list: Template[] = []
  for (const t of templates) for (let k = 0; k < 4; k++) list.push(t)
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

function timeSpansParse(labelled: Omit<Example, "source" | "seed">): boolean {
  return !labelled.tags.some((t, i) => {
    if (t !== "B-TIME") return false
    let j = i + 1
    while (labelled.tags[j] === "I-TIME") j++
    const start = labelled.offsets[i]?.[0] ?? 0
    const end = labelled.offsets[j - 1]?.[1] ?? 0
    return !isTime(labelled.text.slice(start, end))
  })
}

export function queryRates(examples: Example[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const e of examples) {
    const roles = new Set(e.tags.filter((t) => t.startsWith("B-")).map((t) => t.slice(2)))
    for (const r of roles) counts[r] = (counts[r] ?? 0) + 1
  }
  const out: Record<string, number> = {}
  for (const [r, n] of Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1))) {
    out[r] = Math.round((n / Math.max(1, examples.length)) * 1000) / 1000
  }
  return out
}

function generateSplit(
  split: Split,
  count: number,
  opts: GenerateOptions,
  lex: Lexicons,
  seen: Set<string>,
  contamination: { dropped: number },
): SplitRun {
  const spec = SPEC[split]
  const side = spec.names
  const negSide: Side = spec.shapes === "held-out" ? "test" : "train"
  const rng = mulberry32(hashString(`${opts.seed}:${split}`))
  const { pools, filtered } = preparePools(lex, side)
  const time = createTimeGen(rng)
  const ctx: Ctx = { rng, pools, time, cyclers: new Map(), usedNames: new Set() }
  const wantHeld = spec.shapes === "held-out"
  const handPositive = shuffle(
    rng,
    TEMPLATES.filter((t) => !t.negative && !!t.heldOut === wantHeld),
  )
  const handSchedule = buildSchedule(rng, handPositive)
  const negatives = TEMPLATES.filter((t) => t.negative)
  const negSchedule = buildSchedule(rng, negatives)
  const examples: Example[] = []
  const signatures = new Set<string>()
  const stats: SplitStats = {
    examples: 0,
    perTemplate: {},
    perRole: {},
    uniqueNames: 0,
    namePoolSize: pools.origins.reduce((n, o) => n + o.pool.first.length, 0),
    drops: {},
    queryRates: {},
    negativeRate: 0,
    bagSignatures: 0,
  }
  const drop = (reason: string): void => {
    stats.drops[reason] = (stats.drops[reason] ?? 0) + 1
  }
  let handCursor = 0
  let negCursor = 0
  for (let attempts = 0; examples.length < count && attempts < count * 40 + 1000; attempts++) {
    const u = rng()
    let tpl: Pick<Template, "id" | "negative">
    let raw: Piece[] | undefined
    let signature: string | undefined
    if (u < NEG_SHARE) {
      const t = negSchedule[negCursor++ % negSchedule.length] as Template
      tpl = t
      raw = expand(ctx, t, negSide)
    } else if (u < NEG_SHARE + spec.bagShare) {
      tpl = { id: wantHeld ? "bag-held-out" : "bag" }
      const plan = drawPlan(rng, wantHeld)
      if (!plan) {
        drop("no-plan")
        continue
      }
      signature = plan.signature
      raw = fillPlan(ctx, plan)
    } else {
      const t = handSchedule[handCursor++ % handSchedule.length] as Template
      tpl = t
      raw = expand(ctx, t, negSide)
    }
    if (!raw) {
      drop("slot-unfilled")
      continue
    }
    const labelled = labelPieces(decorate(ctx, tpl, raw))
    if (typeof labelled === "string") {
      drop(labelled)
      continue
    }
    if (!timeSpansParse(labelled)) {
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
    if (signature) signatures.add(signature)
    examples.push({ ...labelled, source: `template:${tpl.id}`, seed: opts.seed })
    stats.perTemplate[tpl.id] = (stats.perTemplate[tpl.id] ?? 0) + 1
    for (const tag of labelled.tags) {
      if (tag.startsWith("B-")) stats.perRole[tag.slice(2)] = (stats.perRole[tag.slice(2)] ?? 0) + 1
    }
  }
  stats.examples = examples.length
  stats.uniqueNames = ctx.usedNames.size
  stats.queryRates = queryRates(examples)
  stats.negativeRate =
    Math.round(
      (examples.filter((e) => e.source.startsWith("template:none_")).length /
        Math.max(1, examples.length)) *
        1000,
    ) / 1000
  stats.bagSignatures = signatures.size
  return { examples, stats, timeRejected: time.rejected, namesFiltered: filtered }
}

const sortKeys = <T extends Record<string, number>>(o: T): T =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))) as T

/** Align paraphrase records (plus their canonical echo) and append them to train. */
function addParaphrases(
  records: ParaphraseRecord[],
  opts: GenerateOptions,
  lex: Lexicons,
  train: Example[],
  seen: Set<string>,
  contamination: { dropped: number },
): ParaphraseStats {
  const ctx = makeAlignContext(lex)
  const stats: ParaphraseStats = {
    records: records.length,
    kept: 0,
    echoed: 0,
    dropped: {},
    trainQueryRatesWithParaphrases: {},
  }
  const dropIt = (reason: string): void => {
    stats.dropped[reason] = (stats.dropped[reason] ?? 0) + 1
  }
  const added: Example[] = []
  for (const rec of records) {
    const id = rec.source.replace(/^template:/, "")
    const out = alignParaphrase(rec, ctx)
    if ("reason" in out) {
      dropIt(out.reason)
      continue
    }
    if (!timeSpansParse(out.example)) {
      dropIt("time-unparseable")
      continue
    }
    const key = normalizeText(out.example.text)
    if (opts.blocklist?.has(key)) {
      contamination.dropped++
      dropIt("contamination")
      continue
    }
    if (seen.has(key)) {
      dropIt("duplicate")
      continue
    }
    seen.add(key)
    added.push({ ...out.example, source: `paraphrase:${id}`, seed: opts.seed })
    stats.kept++
    // canonical echo: the original template sentence stays in train (PLAN §9.2 step 5)
    const echo = alignSpans(rec.text, rec.spans)
    const echoKey = normalizeText(rec.text)
    if (
      !("reason" in echo) &&
      !seen.has(echoKey) &&
      !opts.blocklist?.has(echoKey) &&
      timeSpansParse(echo.example)
    ) {
      seen.add(echoKey)
      added.push({ ...echo.example, source: `template:${id}`, seed: opts.seed })
      stats.echoed++
    }
  }
  train.push(...added)
  stats.dropped = sortKeys(stats.dropped)
  return stats
}

export function generate(
  opts: GenerateOptions,
  lexicons: Lexicons = loadLexicons(),
): GenerateResult {
  const counts: Record<Split, number> = {
    train: opts.train,
    val: opts.val,
    "test-generated": opts.test,
    "test-seen-templates-unseen-names": opts.testSeen ?? 0,
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
  const paraphrases = addParaphrases(
    opts.paraphrases ?? [],
    opts,
    lexicons,
    splits.train,
    seen,
    contamination,
  )
  // interleave paraphrases and echoes with generated examples, deterministically
  splits.train = shuffle(mulberry32(hashString(`${opts.seed}:train-order`)), splits.train)
  paraphrases.trainQueryRatesWithParaphrases = queryRates(splits.train)
  const held = heldOutTemplateIds()
  const stats: Stats = {
    seed: opts.seed,
    reference: REFERENCE,
    timeZone: TIME_ZONE,
    splits: splitStats,
    templates: {
      total: TEMPLATES.length,
      heldOut: held.length,
      heldOutIds: held,
      bagSignatureHeldOutRule: "fnv1a(signature) % 5 === 0 is held out (test-generated only)",
    },
    paraphrases,
    contaminationDropped: contamination.dropped,
    timeRejected,
    namesFiltered,
  }
  return { splits, stats }
}

export function serialize(examples: Example[]): string {
  return examples.length ? `${examples.map((e) => JSON.stringify(e)).join("\n")}\n` : ""
}

export { isHeldOutSignature }
