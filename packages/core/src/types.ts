// Public types for @qp/core. PLAN §3–§7.
import type { Anchors, Granularity, Policies as TimePolicies } from "@qp/time"

// ---------------------------------------------------------------------------------------------
// Roles and tokens (PLAN §3, §6.2)

export const ROLES = [
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
  "NEG",
] as const
export type Role = (typeof ROLES)[number]

/** BIO label: "O", "B-ACTOR", "I-ACTOR", … */
export type Label = "O" | `B-${Role}` | `I-${Role}`

export interface Token {
  text: string
  start: number // char offset into the query
  end: number
  /** Set when the pre-tokenizer recognized typed `key:value` syntax (PLAN §5.8). */
  operator?: { key: string; value: string }
}

export interface TagResult {
  labels: Label[] // one per token
  /** Per-token probability of its label, 0..1. Rule taggers return 1. */
  confidence: number[]
}

/** Anything that labels tokens with roles: the neural model or the rule baseline (PLAN §6.6). */
export interface Tagger {
  version: string
  tag(tokens: Token[]): TagResult
}

// ---------------------------------------------------------------------------------------------
// Schema (PLAN §5)

export interface KindDef {
  aliases: string[]
  parent?: string
}

export interface AttrDef {
  aliases: string[]
  /** Facet and value this attribute sets, e.g. { facet: "status", value: "done" }. */
  set: { facet: string; value: string | boolean }
}

export interface FacetCondition {
  /** Only bind when the query's resolved kind is one of these. */
  kind?: string[]
}

interface FacetBase {
  /** Bind only when the span's cue is one of these (ADR 0002). */
  cue?: string[]
  when?: FacetCondition
}

export type FacetDef =
  | (FacetBase & {
      type: "entity"
      role: Role
      source: string | string[]
      multi?: "or" | "and"
    })
  | (FacetBase & { type: "kind" })
  | (FacetBase & { type: "time"; role: "TIME" })
  | (FacetBase & { type: "enum"; role: "ATTR"; values: string[] })
  | (FacetBase & { type: "flag"; role: "ATTR" })
  | (FacetBase & { type: "order"; role: "ORDER" })
  | (FacetBase & {
      type: "custom"
      role: Role
      bind: (span: TaggedSpan, ctx: BindContext) => unknown
    })

export interface Policies {
  time: Partial<TimePolicies> & { anchors?: Anchors }
  entity: { onAmbiguous: "issue" | "top"; onUnresolved: "text" | "drop" | "keep-literal" }
  unbound: "text" | "drop"
  minConfidence: number
}

export interface SchemaInput {
  kinds?: Record<string, KindDef>
  attrs?: Record<string, AttrDef>
  facets: Record<string, FacetDef>
  /** Typed operator keys → facet id, e.g. { reporter: "from", type: "type" } (PLAN §5.8). */
  operators?: Record<string, string>
  policies?: {
    time?: Policies["time"]
    entity?: Partial<Policies["entity"]>
    unbound?: Policies["unbound"]
    minConfidence?: number
  }
  hooks?: Hooks
}

export interface Schema extends Required<Omit<SchemaInput, "policies" | "hooks">> {
  policies: Policies
  hooks: Hooks
  hash: string
}

// ---------------------------------------------------------------------------------------------
// Entity sources (PLAN §7)

export interface Candidate<T = unknown> {
  id: string
  label: string
  score: number // 0..1
  data?: T
}

export interface ResolveContext {
  query: string
  role: Role
  kind?: string
  self?: string
  spans: TaggedSpan[]
  signal?: AbortSignal
}

export type EntitySource<T = unknown> = (
  span: TaggedSpan,
  ctx: ResolveContext,
) => Candidate<T>[] | Promise<Candidate<T>[]>

// ---------------------------------------------------------------------------------------------
// Result contract (PLAN §4)

export type Resolution =
  | { status: "resolved"; candidates: Candidate[] }
  | { status: "ambiguous"; candidates: Candidate[] }
  | { status: "unresolved" }
  | { status: "literal"; value: unknown }

export interface TaggedSpan {
  role: Role
  text: string
  start: number
  end: number
  negated: boolean
  cue?: string
  source?: "model" | "operator"
  confidence: number
  facet?: string
  resolution?: Resolution
}

export type Issue =
  | { kind: "ambiguous"; span: TaggedSpan; candidates: Candidate[] }
  | { kind: "unresolved"; span: TaggedSpan; fallback: "text" | "dropped" }
  | { kind: "unbound"; span: TaggedSpan }
  | { kind: "unsupported"; span: TaggedSpan; reason: string }
  | { kind: "low-confidence" }
  /** A word left in the text that matches a known entity (PLAN §7.5). Never applied as a filter. */
  | { kind: "suggestion"; span: TaggedSpan; candidates: Candidate[] }

export interface TimeValue {
  from?: string
  to?: string
  granularity: Granularity
}

export interface OrderSpec {
  by: "recency" | string
  dir: "asc" | "desc"
  limit?: number
}

export interface ParseResult<F = Record<string, unknown>> {
  query: string
  filters: Partial<F>
  /** Negated filters, e.g. "not from rahul" → exclude.from (same shape as `filters`). */
  exclude: Partial<F>
  text: string
  excludeText: string[]
  order?: OrderSpec
  spans: TaggedSpan[]
  issues: Issue[]
  confidence: number
  meta: {
    irVersion: 1
    modelVersion: string
    schemaHash: string
    reference: string
    timeZone: string
    tookMs: number
  }
}

// ---------------------------------------------------------------------------------------------
// Parser (PLAN §5.1, §5.5)

export interface ParseOptions {
  reference: Date | string
  timeZone: string
  self?: string
  signal?: AbortSignal
}

export interface BindContext {
  query: string
  kind?: string
  spans: TaggedSpan[]
  schema: Schema
}

export interface Hooks {
  normalize?: (query: string) => string
  afterTag?: (spans: TaggedSpan[], ctx: { query: string }) => TaggedSpan[]
  bind?: (span: TaggedSpan, ctx: BindContext) => { facet: string; value: unknown } | undefined
  /** A KIND span no alias matched: return a kind key, or undefined to keep it as text (§5.3). */
  unknownKind?: (span: TaggedSpan, ctx: BindContext) => string | undefined
  afterParse?: (result: ParseResult, ctx: { schema: Schema }) => ParseResult
}

export interface ParserConfig {
  schema: Schema
  tagger: Tagger
  sources?: Record<string, EntitySource>
  /**
   * Check words left in the search text against a source and suggest them as `role` ("utkarsh
   * pdfs" with no cue word). Suggestions go to `issues` only. Async sources are skipped.
   */
  promoteKnownEntities?: { source: string; role: Role; minScore?: number }
}

export interface Parser {
  /** Synchronous when every source is; throws if a source returns a promise. */
  parseSync(query: string, opts: ParseOptions): ParseResult
  parse(query: string, opts: ParseOptions): Promise<ParseResult>
}
