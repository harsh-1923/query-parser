// The parse pipeline (PLAN §2): normalize → tokenize → operators → tag → spans → negation → cues →
// bind → resolve → ParseResult. Everything here is product-agnostic; products speak through the
// schema, sources and hooks.
import { normalizeTime } from "@qp/time"
import { type AliasIndex, aliasIndex } from "./aliases"
import { tokenize } from "./tokenize"
import type {
  BindContext,
  Candidate,
  EntitySource,
  FacetDef,
  Issue,
  OrderSpec,
  ParseOptions,
  ParseResult,
  Parser,
  ParserConfig,
  Role,
  Schema,
  TaggedSpan,
  TimeValue,
  Token,
} from "./types"

const AMBIGUITY_MARGIN = 0.1
/** Sources score exact name/alias matches at or above this (PLAN §7.2). */
const EXACT = 0.95
const STOPWORDS = new Set(
  (
    "a an the of for to from by in on at with and or about re regarding abt any all some " +
    "that which who whom whose what where when how is are was were be been did do does has have had " +
    "i me my mine myself we our us you your it its this these those there here " +
    "show find get search give list me please sorted sort first"
  ).split(" "),
)
const PREPOSITIONS = new Set(
  "by from to in on at with for since before after about of into onto via".split(" "),
)
const VERBISH = /^(?:[a-z]+(?:ed|en)|made|sent|wrote|said|shared|created|uploaded|commented)$/

const ORDER_WORDS: [RegExp, OrderSpec][] = [
  [/\b(oldest|earliest|first)\b/, { by: "recency", dir: "asc" }],
  [/\b(latest|newest|most recent|recent|last|new)\b/, { by: "recency", dir: "desc" }],
]

interface Ctx {
  query: string
  schema: Schema
  kinds: AliasIndex
  attrs: AliasIndex
  opts: ParseOptions
}

// ---------------------------------------------------------------------------------------------
// Spans

function decode(tokens: Token[], labels: string[], confidence: number[]): TaggedSpan[] {
  const spans: TaggedSpan[] = []
  let cur: { role: Role; from: number; to: number; conf: number } | undefined
  const flush = () => {
    if (!cur) return
    const a = tokens[cur.from]
    const b = tokens[cur.to]
    if (a && b)
      spans.push({
        role: cur.role,
        text: "", // filled by caller from offsets
        start: a.start,
        end: b.end,
        negated: false,
        source: "model",
        confidence: cur.conf,
      })
    cur = undefined
  }
  labels.forEach((label, i) => {
    const conf = confidence[i] ?? 1
    if (label === "O") {
      flush()
      return
    }
    const [bio, role] = label.split("-") as ["B" | "I", Role]
    if (bio === "I" && cur && cur.role === role && cur.to === i - 1) {
      cur.to = i
      cur.conf = Math.min(cur.conf, conf)
      return
    }
    flush()
    cur = { role, from: i, to: i, conf }
  })
  flush()
  return spans
}

/** NEG negates the next span, and the rest of an or-list of the same role ("not from a or b"). */
function applyNegation(spans: TaggedSpan[], query: string): TaggedSpan[] {
  const out: TaggedSpan[] = []
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]
    if (!s) continue
    out.push(s)
    if (s.role !== "NEG") continue
    const target = spans[i + 1]
    if (!target || target.role === "NEG") continue
    target.negated = true
    for (let j = i + 2; j < spans.length; j++) {
      const prev = spans[j - 1]
      const next = spans[j]
      if (!prev || !next || next.role !== target.role) break
      if (!/^\s*(,|or|and|nor|,\s*or)\s*$/i.test(query.slice(prev.end, next.start))) break
      next.negated = true
    }
  }
  return out
}

/** ADR 0002: the governing word of each span. Prefers a verb in the query over a preposition. */
function attachCues(spans: TaggedSpan[], tokens: Token[], labels: string[]): void {
  const words = tokens.map((t, i) => ({
    i,
    w: t.text.toLowerCase(),
    o: labels[i] === "O" && !t.operator,
  }))
  for (const s of spans) {
    if (s.role === "NEG" || s.role === "TOPIC" || s.source === "operator") continue
    const first = tokens.findIndex((t) => t.start === s.start)
    const last = tokens.findIndex((t) => t.end === s.end)
    let before: string | undefined
    for (let i = first - 1; i >= 0 && i >= first - 2; i--) {
      const x = words[i]
      if (!x?.o) break
      if (x.w === "the" || x.w === "a" || x.w === "an") continue
      before = x.w
      break
    }
    const after = words[last + 1]?.o ? words[last + 1]?.w : undefined
    const verbs = words.filter((x) => x.o && VERBISH.test(x.w))
    const nearestVerb = verbs.sort((a, b) => Math.abs(a.i - first) - Math.abs(b.i - first))[0]?.w
    if (before && !PREPOSITIONS.has(before)) s.cue = before
    else if (nearestVerb) s.cue = nearestVerb
    else if (before) s.cue = before
    else if (after && VERBISH.test(after)) s.cue = after
  }
}

// ---------------------------------------------------------------------------------------------
// Binding

function facetFor(
  role: Role,
  span: TaggedSpan,
  kind: string | undefined,
  schema: Schema,
): [string, FacetDef] | undefined {
  const candidates = Object.entries(schema.facets).filter(([, f]) => {
    if (f.type === "kind") return role === "KIND"
    if (f.type === "enum" || f.type === "flag") return false // ATTR binds through `attrs`
    return f.role === role
  })
  const allowed = candidates.filter(([, f]) => {
    if (f.when?.kind) {
      if (!kind || !isKindIn(kind, f.when.kind, schema)) return false
    }
    if (f.cue && !(span.cue && f.cue.includes(span.cue))) return false
    return true
  })
  return allowed.find(([, f]) => f.cue) ?? allowed.find(([, f]) => f.when) ?? allowed[0]
}

function isKindIn(kind: string, list: string[], schema: Schema): boolean {
  for (let k: string | undefined = kind; k; k = schema.kinds[k]?.parent)
    if (list.includes(k)) return true
  return false
}

const add = (bag: Record<string, unknown>, facet: string, value: unknown, multi: boolean) => {
  if (!multi) {
    bag[facet] = value
    return
  }
  const prev = (bag[facet] as unknown[] | undefined) ?? []
  if (!prev.includes(value)) bag[facet] = [...prev, value]
}

// ---------------------------------------------------------------------------------------------
// Parser

export function createParser(config: ParserConfig): Parser {
  const { schema, tagger } = config
  const sources = config.sources ?? {}
  const kinds = aliasIndex(schema.kinds, { headFallback: true })
  const attrs = aliasIndex(schema.attrs)

  function run(
    query: string,
    opts: ParseOptions,
    resolveAll: (jobs: Job[]) => Candidate[][] | Promise<Candidate[][]>,
  ): ParseResult | Promise<ParseResult> {
    const t0 = globalThis.performance?.now() ?? 0
    const q = schema.hooks.normalize?.(query) ?? query
    const ctx: Ctx = { query: q, schema, kinds, attrs, opts }
    const tokens = tokenize(q)
    const tag = tagger.tag(tokens)
    const labels = tokens.map((t, i) => (t.operator ? "O" : (tag.labels[i] ?? "O")))
    let spans = decode(tokens, labels, tag.confidence)
    for (const s of spans) s.text = q.slice(s.start, s.end)
    spans.push(...operatorSpans(tokens, schema))
    spans.sort((a, b) => a.start - b.start)
    spans = applyNegation(spans, q)
    attachCues(spans, tokens, labels)
    spans = schema.hooks.afterTag?.(spans, { query: q }) ?? spans

    const result: ParseResult = {
      query,
      filters: {},
      exclude: {},
      text: "",
      excludeText: [],
      spans,
      issues: [],
      confidence: spans.reduce((m, s) => Math.min(m, s.confidence), 1),
      meta: {
        irVersion: 1,
        modelVersion: tagger.version,
        schemaHash: schema.hash,
        reference:
          typeof opts.reference === "string" ? opts.reference : opts.reference.toISOString(),
        timeZone: opts.timeZone,
        tookMs: 0,
      },
    }
    const textParts: { at: number; text: string }[] = []
    const toText = (s: TaggedSpan) => textParts.push({ at: s.start, text: s.text })

    // Kind first: it conditions the other bindings.
    let kind: string | undefined
    for (const s of spans) {
      if (s.role !== "KIND" || s.negated) continue
      const m = kinds.match(s.text)
      if (m && schema.kinds[m.key]) {
        kind = m.key
        break
      }
    }

    const jobs: Job[] = []
    for (const s of spans) bindSpan(s, ctx, kind, result, toText, jobs)

    const finish = (resolved: Candidate[][]): ParseResult => {
      jobs.forEach((job, i) => {
        settle(job, resolved[i] ?? [], result, toText, schema)
      })
      // Untagged content words are search text too (PLAN §4).
      tokens.forEach((t, i) => {
        if (labels[i] !== "O" || t.operator) return
        const w = t.text.toLowerCase()
        if (STOPWORDS.has(w) || PREPOSITIONS.has(w) || !/[a-z0-9]/i.test(w) || w === "'s") return
        if (spans.some((s) => s.cue === w)) return
        textParts.push({ at: t.start, text: t.text })
      })
      result.text = textParts
        .sort((a, b) => a.at - b.at)
        .map((p) => p.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
      suggest(textParts, result, q, opts)
      if (result.confidence < schema.policies.minConfidence) {
        result.filters = {}
        result.exclude = {}
        result.text = q.trim()
        result.issues.push({ kind: "low-confidence" })
      }
      const out = schema.hooks.afterParse?.(result, { schema }) ?? result
      out.meta.tookMs = Math.round(((globalThis.performance?.now() ?? 0) - t0) * 1000) / 1000
      return out
    }

    const resolved = resolveAll(jobs)
    return resolved instanceof Promise ? resolved.then(finish) : finish(resolved)
  }

  /** PLAN §7.5: leftover words that exactly match a known entity become suggestions. */
  function suggest(
    parts: { at: number; text: string }[],
    result: ParseResult,
    q: string,
    opts: ParseOptions,
  ) {
    const promote = config.promoteKnownEntities
    const source = promote && sources[promote.source]
    if (!promote || !source) return
    const min = promote.minScore ?? EXACT
    for (const p of parts) {
      for (const m of p.text.matchAll(/[^\s]+/g)) {
        const word = m[0]
        if (STOPWORDS.has(word.toLowerCase()) || word.length < 3) continue
        const start = p.at + m.index
        const span: TaggedSpan = {
          role: promote.role,
          text: q.slice(start, start + word.length),
          start,
          end: start + word.length,
          negated: false,
          confidence: 1,
        }
        const found = source(span, {
          query: q,
          role: promote.role,
          spans: result.spans,
          ...(opts.self ? { self: opts.self } : {}),
        })
        if (found instanceof Promise) return
        const close = found.filter((c) => c.score >= min).slice(0, 3)
        if (close.length) result.issues.push({ kind: "suggestion", span, candidates: close })
      }
    }
  }

  function bindSpan(
    s: TaggedSpan,
    ctx: Ctx,
    kind: string | undefined,
    result: ParseResult,
    toText: (s: TaggedSpan) => void,
    jobs: Job[],
  ) {
    const bag = (s.negated ? result.exclude : result.filters) as Record<string, unknown>
    const unbound = () => {
      result.issues.push({ kind: "unbound", span: s })
      if (schema.policies.unbound === "text") toText(s)
    }
    if (s.role === "NEG") return
    if (s.role === "TOPIC") {
      if (s.negated) result.excludeText.push(s.text)
      else toText(s)
      return
    }

    const bindCtx: BindContext = {
      query: ctx.query,
      spans: result.spans,
      schema,
      ...(kind ? { kind } : {}),
    }
    const custom = schema.hooks.bind?.(s, bindCtx)
    if (custom) {
      s.facet = custom.facet
      s.resolution = { status: "literal", value: custom.value }
      add(bag, custom.facet, custom.value, true)
      return
    }

    if (s.role === "ATTR") {
      const m = ctx.attrs.match(s.text)
      const def = m && schema.attrs[m.key]
      if (!def) return unbound()
      const f = schema.facets[def.set.facet]
      s.facet = def.set.facet
      s.resolution = { status: "literal", value: def.set.value }
      if (f?.type === "flag") {
        ;(result.filters as Record<string, unknown>)[def.set.facet] = !s.negated
      } else add(bag, def.set.facet, def.set.value, true)
      return
    }

    const pinned = s.source === "operator" && s.facet ? schema.facets[s.facet] : undefined
    const hit: [string, FacetDef] | undefined =
      pinned && s.facet ? [s.facet, pinned] : facetFor(s.role, s, kind, schema)
    if (!hit) return unbound()
    const [facetId, f] = hit
    s.facet = facetId

    switch (f.type) {
      case "kind": {
        const key =
          ctx.kinds.match(s.text)?.key ?? schema.hooks.unknownKind?.(s, bindCtx) ?? undefined
        if (!key || !schema.kinds[key]) {
          s.resolution = { status: "unresolved" }
          result.issues.push({ kind: "unresolved", span: s, fallback: "text" })
          toText(s)
          return
        }
        s.resolution = { status: "literal", value: key }
        add(bag, facetId, key, true)
        return
      }
      case "time": {
        const r = normalizeTime(s.text, {
          reference: result.meta.reference,
          timeZone: ctx.opts.timeZone,
          policies: schema.policies.time,
          ...(schema.policies.time.anchors ? { anchors: schema.policies.time.anchors } : {}),
        })
        if (!r.ok) {
          s.resolution = { status: "unresolved" }
          result.issues.push({ kind: "unsupported", span: s, reason: r.reason })
          toText(s)
          return
        }
        const value: TimeValue = {
          granularity: r.granularity,
          ...(r.from ? { from: r.from } : {}),
          ...(r.to ? { to: r.to } : {}),
        }
        s.resolution = { status: "literal", value }
        add(bag, facetId, value, false)
        return
      }
      case "order": {
        const lower = s.text.toLowerCase()
        const spec = ORDER_WORDS.find(([re]) => re.test(lower))?.[1]
        if (!spec) return unbound()
        s.resolution = { status: "literal", value: spec }
        result.order = spec
        add(bag, facetId, spec, false)
        return
      }
      case "custom": {
        const value = f.bind(s, bindCtx)
        s.resolution = { status: "literal", value }
        add(bag, facetId, value, true)
        return
      }
      case "entity": {
        const names = Array.isArray(f.source) ? f.source : [f.source]
        const fns = names.map((n) => sources[n]).filter((x): x is EntitySource => !!x)
        if (!fns.length) {
          s.resolution = { status: "unresolved" }
          result.issues.push({ kind: "unresolved", span: s, fallback: "text" })
          toText(s)
          return
        }
        jobs.push({ span: s, facet: facetId, multi: !!f.multi, fns, kind, bag })
        return
      }
      default:
        return unbound()
    }
  }

  function settle(
    job: Job,
    candidates: Candidate[],
    result: ParseResult,
    toText: (s: TaggedSpan) => void,
    schema: Schema,
  ) {
    const s = job.span
    const sorted = [...candidates].sort(
      (a, b) => b.score - a.score || a.label.localeCompare(b.label, "en") || (a.id < b.id ? -1 : 1),
    )
    const [top, second] = sorted
    if (!top) {
      s.resolution = { status: "unresolved" }
      const policy = schema.policies.entity.onUnresolved
      if (policy === "keep-literal") {
        s.resolution = { status: "literal", value: s.text }
        add(job.bag, job.facet, s.text, true)
        return
      }
      result.issues.push({
        kind: "unresolved",
        span: s,
        fallback: policy === "drop" ? "dropped" : "text",
      })
      if (policy === "text") toText(s)
      return
    }
    // An exact match (score ≥ EXACT) only competes with other exact matches: "utkarsh" isn't
    // ambiguous just because the directory also has a fuzzy "Utkarash".
    const rival = (c: Candidate) =>
      top.score - c.score < AMBIGUITY_MARGIN && (top.score < EXACT || c.score >= EXACT)
    if (second && rival(second) && schema.policies.entity.onAmbiguous === "issue") {
      const close = sorted.filter(rival)
      s.resolution = { status: "ambiguous", candidates: close }
      result.issues.push({ kind: "ambiguous", span: s, candidates: close })
      return
    }
    s.resolution = { status: "resolved", candidates: sorted.slice(0, 5) }
    add(job.bag, job.facet, top.id, true)
  }

  const collect = (jobs: Job[], opts: ParseOptions, query: string, spans: () => TaggedSpan[]) =>
    jobs.map((job) =>
      job.fns.map((fn) =>
        fn(job.span, {
          query,
          role: job.span.role,
          spans: spans(),
          ...(job.kind ? { kind: job.kind } : {}),
          ...(opts.self ? { self: opts.self } : {}),
          ...(opts.signal ? { signal: opts.signal } : {}),
        }),
      ),
    )
  const merge = (lists: Candidate[][]) => {
    const best = new Map<string, Candidate>()
    for (const c of lists.flat()) {
      const prev = best.get(c.id)
      if (!prev || c.score > prev.score) best.set(c.id, c)
    }
    return [...best.values()]
  }

  return {
    parseSync(query, opts) {
      return run(query, opts, (jobs) =>
        collect(jobs, opts, query, () => jobs.map((j) => j.span)).map((rs) =>
          merge(
            rs.map((r) => {
              if (r instanceof Promise)
                throw new Error("parseSync: an entity source returned a promise; use parse()")
              return r
            }),
          ),
        ),
      ) as ParseResult
    },
    async parse(query, opts) {
      return run(query, opts, async (jobs) =>
        Promise.all(
          collect(jobs, opts, query, () => jobs.map((j) => j.span)).map(async (rs) =>
            merge(await Promise.all(rs)),
          ),
        ),
      )
    },
  }
}

interface Job {
  span: TaggedSpan
  facet: string
  multi: boolean
  fns: EntitySource[]
  kind: string | undefined
  bag: Record<string, unknown>
}

/** Typed `key:value` operators bind directly (PLAN §5.8). Unknown keys stay as text. */
function operatorSpans(tokens: Token[], schema: Schema): TaggedSpan[] {
  const out: TaggedSpan[] = []
  for (const t of tokens) {
    if (!t.operator) continue
    const facetId = schema.operators[t.operator.key.toLowerCase()]
    const f = facetId ? schema.facets[facetId] : undefined
    if (!f || !facetId) continue
    const role: Role = f.type === "kind" ? "KIND" : "role" in f ? f.role : "TOPIC"
    const at = t.start + t.text.lastIndexOf(t.operator.value)
    out.push({
      role,
      text: t.operator.value,
      start: at,
      end: at + t.operator.value.length,
      negated: false,
      source: "operator",
      confidence: 1,
      facet: facetId,
    })
  }
  return out
}

export type { Issue }
