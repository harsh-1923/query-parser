// defineSchema and facet helpers (PLAN §5, §12). Validation fails fast with a clear message.
import { normalizeAlias } from "./aliases"
import type { FacetDef, Policies, Role, Schema, SchemaInput } from "./types"
import { ROLES } from "./types"

type Without<T, K extends keyof T> = Omit<T, K>
type FacetOf<T extends FacetDef["type"]> = Extract<FacetDef, { type: T }>

export const facet = {
  entity: (d: Without<FacetOf<"entity">, "type">): FacetDef => ({ type: "entity", ...d }),
  kind: (d: Without<FacetOf<"kind">, "type"> = {}): FacetDef => ({ type: "kind", ...d }),
  time: (d: Partial<Without<FacetOf<"time">, "type">> = {}): FacetDef => ({
    type: "time",
    role: "TIME",
    ...d,
  }),
  enum: (d: Without<FacetOf<"enum">, "type" | "role">): FacetDef => ({
    type: "enum",
    role: "ATTR",
    ...d,
  }),
  flag: (d: Partial<Without<FacetOf<"flag">, "type">> = {}): FacetDef => ({
    type: "flag",
    role: "ATTR",
    ...d,
  }),
  order: (d: Partial<Without<FacetOf<"order">, "type">> = {}): FacetDef => ({
    type: "order",
    role: "ORDER",
    ...d,
  }),
  custom: (d: Without<FacetOf<"custom">, "type">): FacetDef => ({ type: "custom", ...d }),
}

const DEFAULT_POLICIES: Policies = {
  time: {},
  entity: { onAmbiguous: "issue", onUnresolved: "text" },
  unbound: "text",
  minConfidence: 0.5,
}

export class SchemaError extends Error {
  override name = "SchemaError"
}

export function defineSchema(input: SchemaInput): Schema {
  const kinds = input.kinds ?? {}
  const attrs = input.attrs ?? {}
  const facets = input.facets
  const fail = (msg: string): never => {
    throw new SchemaError(msg)
  }

  for (const [id, f] of Object.entries(facets)) {
    if ("role" in f && !(ROLES as readonly string[]).includes(f.role))
      fail(`facet "${id}": unknown role "${f.role}"`)
  }
  for (const [id, k] of Object.entries(kinds)) {
    if (k.parent && !kinds[k.parent]) fail(`kind "${id}": parent "${k.parent}" is not a kind`)
  }
  for (const [id, a] of Object.entries(attrs)) {
    const target = facets[a.set.facet]
    if (!target) fail(`attr "${id}": facet "${a.set.facet}" is not defined`)
    else if (target.type === "enum" && !target.values.includes(String(a.set.value)))
      fail(`attr "${id}": "${a.set.value}" is not a value of facet "${a.set.facet}"`)
  }

  // Aliases must not collide within or across kinds and attrs.
  const seen = new Map<string, string>()
  const claim = (alias: string, owner: string) => {
    const n = normalizeAlias(alias)
    const prev = seen.get(n)
    if (prev && prev !== owner) fail(`alias "${alias}" is used by ${prev} and ${owner}`)
    seen.set(n, owner)
  }
  for (const [id, k] of Object.entries(kinds)) for (const a of k.aliases) claim(a, `kind "${id}"`)
  for (const [id, a] of Object.entries(attrs)) for (const al of a.aliases) claim(al, `attr "${id}"`)

  // Two unconditional facets for the same role would make binding ambiguous (PLAN §5.2).
  const unconditional = new Map<Role, string>()
  for (const [id, f] of Object.entries(facets)) {
    if (!("role" in f) || f.when || f.cue || f.type === "enum" || f.type === "flag") continue
    const prev = unconditional.get(f.role)
    if (prev) fail(`facets "${prev}" and "${id}" both bind ${f.role} with no "when" or "cue"`)
    unconditional.set(f.role, id)
  }

  for (const [key, target] of Object.entries(input.operators ?? {})) {
    if (!facets[target]) fail(`operator "${key}": facet "${target}" is not defined`)
  }

  const p = input.policies ?? {}
  const policies: Policies = {
    time: { ...DEFAULT_POLICIES.time, ...p.time },
    entity: { ...DEFAULT_POLICIES.entity, ...p.entity },
    unbound: p.unbound ?? DEFAULT_POLICIES.unbound,
    minConfidence: p.minConfidence ?? DEFAULT_POLICIES.minConfidence,
  }
  const base = { kinds, attrs, facets, operators: input.operators ?? {}, policies }
  return { ...base, hooks: input.hooks ?? {}, hash: hashOf(base) }
}

/** FNV-1a over a stable serialization (functions contribute their source text). */
function hashOf(value: unknown): string {
  const s = stable(value)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, "0")
}
function stable(v: unknown): string {
  if (typeof v === "function") return JSON.stringify(String(v))
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
  if (v && typeof v === "object") {
    const keys = Object.keys(v).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
  }
  return JSON.stringify(v) ?? "null"
}
