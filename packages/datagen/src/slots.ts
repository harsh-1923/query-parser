// Slot fillers: turn `{ROLE|mod|mod}` into labelled pieces of text.
import type { Role } from "@qp/core"
import type { Lexicons, NamePool } from "./lexicons"
import { Cycler, chance, int, pick, type Rng, weighted } from "./rng"
import type { TimeGen } from "./time"
import { LOOKALIKE_EXTRA, messyTopic } from "./topics"

/** A run of text with one label. `role: null` means O. `glue` attaches it to the previous piece. */
export interface Piece {
  text: string
  role: Role | null
  glue?: boolean
  /** Eligible for a typo (ordinary words only, never names or time phrases). */
  typo?: boolean
}

export type Side = "train" | "test"

export interface Pools {
  kinds: string[]
  kindVerbs: string[]
  attrs: string[]
  topics: string[]
  /** Lexicon topics with no kind/state/time words: safe to label as plain TOPIC. */
  cleanTopics: string[]
  /** Topics that contain a kind or state word before their last word ("call routing"). */
  lookalikeTopics: string[]
  /** Single content words and short phrases for composing messy topics. */
  topicWords: string[]
  shortTopics: string[]
  /** Attr aliases that read naturally after not/except/excluding. */
  negAttrs: string[]
  hardTopics: string[]
  tagContainers: string[]
  namedContainers: string[]
  dynamicContainers: string[]
  groups: string[]
  relational: string[]
  origins: { origin: string; weight: number; pool: NamePool }[]
}

export interface Ctx {
  rng: Rng
  pools: Pools
  time: TimeGen
  cyclers: Map<string, Cycler<string>>
  usedNames: Set<string>
}

/** Verb triggers: lemma forms after "did"/"has", past forms after a subject. */
export const KIND_VERBS = ["say", "say", "say", "post", "comment", "reply"]
export const KIND_VERBS_PAST = ["said", "wrote", "commented", "pinged"]
const NOT_NOUN_KINDS = new Set(["mention", "say", "said", "wrote", "pinged", "commented"])
const NO_PLURAL =
  /(sx|dx|tx|px|ics|ss)$|^(people|staff|news|media|slack|gmail|excel|keynote|inbox)$/
const CONTAINER_NOUNS = ["channel", "board", "project", "folder", "repo", "space", "team"]
const DOMAINS = [
  "acme.com",
  "example.org",
  "lumen.de",
  "northwind.io",
  "contoso.com",
  "initech.co",
  "globex.net",
]
const PRE_ORDER = [
  "latest",
  "latest",
  "newest",
  "oldest",
  "most recent",
  "earliest",
  "latest version",
  "most recent",
  "newest",
]
const POST_ORDER = ["newest first", "oldest first", "latest first", "most recent first"]
const HARD_TOPICS = [
  "new york office",
  "new york",
  "new delhi office",
  "march madness",
  "may day",
  "black friday",
  "cyber monday",
  "last mile delivery",
  "next gen platform",
  "friday deploy freeze",
  "summer internship",
  "spring cleanup",
  "christmas party",
  "new relic",
  "monday motivation",
  "sunday scaries",
  "april fools prank",
  "june bug bash",
  "mid year review",
  "second brain",
  "today show",
  "august rush",
  "new hire onboarding",
  "next steps",
  "last mile",
]
const TIMEISH = [
  "today",
  "yesterday",
  "tomorrow",
  "tonight",
  "week",
  "month",
  "year",
  "quarter",
  "weekend",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "recently",
  "latest",
  "newest",
  "oldest",
  "earliest",
  "recent",
]
const SPLIT_KINDS = /^(pitch|tracker) (decks?|sheets?)$/
const FROM_TIMES = [
  "today",
  "yesterday",
  "last week",
  "last month",
  "this week",
  "this month",
  "last year",
]
const NEG_ANY: [string, number][] = [
  ["not", 40],
  ["except", 15],
  ["excluding", 15],
  ["exclude", 8],
  ["without", 12],
  ["no", 10],
]
const NEG_FROM = ["not", "not", "not", "except", "excluding"]

export function preparePools(lex: Lexicons, side: Side): { pools: Pools; filtered: number } {
  const reserved = new Set<string>([
    ...[
      "from",
      "by",
      "to",
      "with",
      "in",
      "on",
      "about",
      "the",
      "and",
      "or",
      "not",
      "me",
      "my",
      "i",
      "of",
      "for",
      "at",
    ],
    ...[
      "today",
      "yesterday",
      "tomorrow",
      "last",
      "next",
      "this",
      "week",
      "month",
      "year",
      "morning",
      "evening",
      "night",
    ],
    ...["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
    ...[
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ],
    ...["jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"],
    ...[
      "latest",
      "newest",
      "oldest",
      "recent",
      "earliest",
      "except",
      "excluding",
      "exclude",
      "without",
      "no",
    ],
  ])
  const addWords = (phrases: string[]): void => {
    for (const p of phrases)
      for (const w of p.toLowerCase().split(/\s+/)) {
        reserved.add(w)
        reserved.add(w.replace(/s$/, ""))
      }
  }
  const allKinds = Object.values(lex.kinds).flat()
  addWords(allKinds)
  addWords(Object.values(lex.attrs).flat())
  let filtered = 0
  const origins: Pools["origins"] = []
  const weights: Record<string, number> = {
    indian: 35,
    english: 20,
    german: 8,
    french: 6,
    spanish: 8,
    dutch: 4,
    polish: 5,
    turkish: 6,
    portuguese: 4,
  }
  // Test names must never appear in train, in any origin's pool.
  const trainNames = new Set<string>()
  if (side === "test") {
    for (const split of Object.values(lex.names)) {
      for (const n of [...split.train.first, ...split.train.last]) trainNames.add(n)
    }
  }
  for (const [origin, split] of Object.entries(lex.names)) {
    const raw = split[side]
    const keep = (xs: string[]): string[] => {
      const out = xs.filter((x) => x.length >= 2 && !reserved.has(x) && !trainNames.has(x))
      filtered += xs.length - out.length
      return out
    }
    origins.push({
      origin,
      weight: weights[origin] ?? 3,
      pool: { first: keep(raw.first), last: keep(raw.last) },
    })
  }
  const ATTR_SKIP = /^(not|no|without)\b|^(from|by) bot$/
  const singles = (xs: string[]): Set<string> => {
    const out = new Set<string>()
    for (const x of xs) if (!x.includes(" ")) out.add(x.toLowerCase()).add(`${x.toLowerCase()}s`)
    return out
  }
  const kindWords = singles(allKinds)
  const attrWords = singles(Object.values(lex.attrs).flat())
  const timeWords = new Set([...TIMEISH])
  const cleanTopics: string[] = []
  const lookalikeTopics: string[] = [...LOOKALIKE_EXTRA]
  for (const t of lex.topics) {
    const ws = t.toLowerCase().split(/\s+/)
    if (ws.some((w) => timeWords.has(w) || /^(q\d|\d{4}|\d+(am|pm))$/.test(w))) continue
    if (kindWords.has(ws[ws.length - 1] as string)) continue
    const hasKind = ws.some((w) => kindWords.has(w))
    const hasAttr = ws.some((w) => attrWords.has(w))
    if (hasKind || hasAttr) lookalikeTopics.push(t)
    else cleanTopics.push(t)
  }
  const topicWords = [
    ...new Set(
      cleanTopics
        .flatMap((t) => t.split(/\s+/))
        .filter((w) => /^[a-z]{4,}$/.test(w) && !reserved.has(w)),
    ),
  ].sort()
  const shortTopics = cleanTopics.filter((t) => t.split(/\s+/).length <= 2)
  const NEG_ATTR_BAD =
    /^(with|has|without|in|assigned|no|not|nobody|under|on|needs|awaiting|waiting|containing|marked|to|from|by|un|bot)|\bbot\b|^automated$/
  const negAttrs = Object.values(lex.attrs)
    .flat()
    .filter((a) => a.split(" ").length <= 2 && !NEG_ATTR_BAD.test(a) && !/^p\d$/.test(a))
  const nounKinds = allKinds.filter((k) => !NOT_NOUN_KINDS.has(k))
  const tags = lex.containers.filter((c) => c.startsWith("#"))
  const named = lex.containers.filter((c) => !c.startsWith("#"))
  const dynamic = ["dms"]
  for (let n = 3; n <= 60; n += 3) dynamic.push(`sprint ${n + (n % 2)}`)
  for (const v of ["1.0", "2.3", "3.1", "4.2", "5.0", "6.4", "7.2", "8.1", "9.0", "10.2"])
    dynamic.push(`release ${v}`)
  return {
    filtered,
    pools: {
      kinds: nounKinds,
      kindVerbs: KIND_VERBS,
      attrs: Object.values(lex.attrs)
        .flat()
        .filter((a) => !ATTR_SKIP.test(a)),
      topics: lex.topics,
      cleanTopics,
      lookalikeTopics,
      topicWords,
      shortTopics,
      negAttrs,
      hardTopics: HARD_TOPICS,
      tagContainers: tags,
      namedContainers: named,
      dynamicContainers: dynamic,
      groups: lex.groups,
      relational: lex.relational,
      origins,
    },
  }
}

export const cycled = (ctx: Ctx, key: string, items: string[]): string => {
  let c = ctx.cyclers.get(key)
  if (!c) {
    c = new Cycler(ctx.rng, items)
    ctx.cyclers.set(key, c)
  }
  return c.next()
}

const titleCase = (s: string): string =>
  s.replace(/(^|[\s'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
const ascii = (s: string): string => s.replace(/[^a-z0-9]/g, "")

function pluralize(word: string): string {
  const parts = word.split(" ")
  const last = parts.pop() as string
  if (last.endsWith("s") || NO_PLURAL.test(last) || !/^[a-z]+$/.test(last)) return word
  const plural = /[^aeiou]y$/.test(last)
    ? `${last.slice(0, -1)}ies`
    : /(x|ch|sh|z)$/.test(last)
      ? `${last}es`
      : `${last}s`
  return [...parts, plural].join(" ")
}

function firstName(ctx: Ctx, origin: Pools["origins"][number]): string {
  const name = cycled(ctx, `first:${origin.origin}`, origin.pool.first)
  ctx.usedNames.add(name)
  return name
}

function nameValue(ctx: Ctx, forceFull = false): { text: string; first: string; last: string } {
  const { rng } = ctx
  const origin = weighted(
    rng,
    ctx.pools.origins.map((o) => [o, o.weight] as const),
  )
  const first = firstName(ctx, origin)
  const last = cycled(ctx, `last:${origin.origin}`, origin.pool.last)
  let text = forceFull || chance(rng, 0.35) ? `${first} ${last}` : first
  if (chance(rng, 0.15)) text = titleCase(text)
  return { text, first, last }
}

function handleValue(ctx: Ctx): string {
  const n = nameValue(ctx)
  const f = ascii(n.first)
  const l = ascii(n.last)
  if (!f || !l) return `@${f || l || "sam"}`
  return pick(ctx.rng, [`@${f}`, `@${f}.${l[0]}`, `@${f}.${l}`, `@${f}_${l[0]}`])
}

function emailValue(ctx: Ctx): string {
  const n = nameValue(ctx)
  const f = ascii(n.first)
  const l = ascii(n.last)
  const local = f && l && chance(ctx.rng, 0.4) ? `${f}.${l}` : f || l || "sam"
  return `${local}@${pick(ctx.rng, DOMAINS)}`
}

function personPieces(ctx: Ctx, role: Role, mods: string[]): Piece[] {
  const { rng } = ctx
  const has = (m: string): boolean => mods.includes(m)
  const piece = (text: string, glue = false): Piece => ({ text, role, glue })
  const one = (kind: string): Piece[] => {
    switch (kind) {
      case "i":
        return [piece(chance(rng, 0.7) ? "I" : "i")]
      case "me":
        return [piece("me")]
      case "my":
        return [piece("my")]
      case "may":
        return [piece("may")]
      case "handle":
        return [piece(handleValue(ctx))]
      case "email":
        return [piece(emailValue(ctx))]
      case "grp":
        return [piece(cycled(ctx, "groups", ctx.pools.groups))]
      case "rel":
        return [piece(cycled(ctx, "relational", ctx.pools.relational))]
      default:
        return [piece(nameValue(ctx).text)]
    }
  }
  const kindFor = (): string => {
    for (const m of ["i", "me", "my", "may", "handle", "email", "grp", "rel"]) if (has(m)) return m
    if (has("name")) return "name"
    if (has("person"))
      return weighted(rng, [
        ["name", 80],
        ["handle", 10],
        ["email", 10],
      ] as const)
    if (has("poss"))
      return weighted(rng, [
        ["name", 70],
        ["handle", 10],
        ["email", 4],
        ["rel", 10],
        ["grp", 6],
      ] as const)
    return weighted(rng, [
      ["name", 62],
      ["handle", 8],
      ["email", 6],
      ["grp", 14],
      ["rel", 10],
    ] as const)
  }
  let pieces: Piece[]
  if (has("multi")) {
    const count = chance(rng, 0.8) ? 2 : 3
    const kinds = Array.from({ length: count }, () =>
      has("grp") || has("rel")
        ? kindFor()
        : chance(rng, 0.85)
          ? "name"
          : pick(rng, ["handle", "email", "grp"]),
    )
    pieces = []
    kinds.forEach((k, i) => {
      if (i > 0) {
        const sep = i === count - 1 ? pick(rng, ["or", "or", "and"]) : ","
        pieces.push({ text: sep, role: null, glue: sep === "," })
      }
      pieces.push(...one(k))
    })
  } else {
    pieces = one(kindFor())
  }
  if (has("poss")) pieces.push({ text: "'s", role: null, glue: true })
  return pieces
}

function containerPieces(ctx: Ctx, mods: string[]): Piece[] {
  const { rng, pools } = ctx
  const bare = mods.includes("bare")
  const c = (text: string, typo = false): Piece => ({ text, role: "CONTAINER", typo })
  const o = (text: string): Piece => ({ text, role: null })
  const kind = weighted(rng, [
    ["tag", 45],
    ["named", 40],
    ["dynamic", 15],
  ] as const)
  if (mods.includes("multi")) {
    const a = cycled(ctx, "ctag", pools.tagContainers)
    const b = cycled(ctx, "ctag", pools.tagContainers)
    return [o("in"), c(a), o(pick(rng, ["or", "or", "and"])), c(b)]
  }
  if (kind === "tag") {
    const t = c(cycled(ctx, "ctag", pools.tagContainers))
    return bare ? [t] : [o(pick(rng, ["in", "in", "on"])), t]
  }
  if (kind === "dynamic") {
    const d = c(cycled(ctx, "cdyn", pools.dynamicContainers))
    return bare ? [d] : [o(pick(rng, ["in", "in", "for"])), d]
  }
  const name = c(cycled(ctx, "cname", pools.namedContainers), true)
  const noun = o(pick(rng, CONTAINER_NOUNS))
  if (bare) return [name, noun]
  const prep = noun.text === "board" && chance(rng, 0.4) ? "on" : "in"
  switch (int(rng, 3)) {
    case 0:
      return [o(`${prep} the`), name, noun]
    case 1:
      return [o(prep), name, noun]
    default:
      return [o(prep), name]
  }
}

export function fillSlot(ctx: Ctx, name: string, mods: string[]): Piece[] {
  const { rng, pools } = ctx
  const has = (m: string): boolean => mods.includes(m)
  switch (name) {
    case "KIND": {
      if (has("v"))
        return [{ text: cycled(ctx, "kindv", pools.kindVerbs), role: "KIND", typo: true }]
      if (has("vp"))
        return [{ text: cycled(ctx, "kindvp", KIND_VERBS_PAST), role: "KIND", typo: true }]
      const base = cycled(ctx, "kind", pools.kinds)
      const text = chance(rng, 0.55) ? pluralize(base) : base
      // "pitch deck" is TOPIC + KIND under eval/ANNOTATION.md ("pitch [deck]")
      if (SPLIT_KINDS.test(text)) {
        const [modifier, head] = text.split(" ") as [string, string]
        return [
          { text: modifier, role: "TOPIC" },
          { text: head, role: "KIND", typo: true },
        ]
      }
      return [{ text, role: "KIND", typo: true }]
    }
    case "ATTR": {
      if (has("neg")) {
        let text = cycled(ctx, "negattr", pools.negAttrs)
        if ((text === "draft" || text === "blocker") && chance(rng, 0.4)) text += "s"
        return [{ text, role: "ATTR", typo: true }]
      }
      return [{ text: cycled(ctx, "attr", pools.attrs), role: "ATTR", typo: true }]
    }
    case "ORDER": {
      if (has("ver")) return [{ text: "latest version", role: "ORDER" }]
      const text = has("post")
        ? cycled(ctx, "order-post", POST_ORDER)
        : cycled(ctx, "order-pre", PRE_ORDER)
      return [{ text, role: "ORDER", typo: true }]
    }
    case "TOPIC": {
      const text = has("hard")
        ? cycled(ctx, "topic-hard", pools.hardTopics)
        : messyTopic(ctx, has("short"))
      return [{ text, role: "TOPIC", typo: true }]
    }
    case "CONTAINER":
      return containerPieces(ctx, mods)
    case "TIME": {
      const text = has("from") ? `from ${pick(rng, FROM_TIMES)}` : ctx.time.next(rng)
      if (text === undefined) return []
      return [{ text, role: "TIME" }]
    }
    case "NEG": {
      if (has("attr"))
        return [
          {
            text: weighted(rng, [
              ["not", 60],
              ["except", 15],
              ["excluding", 15],
              ["exclude", 10],
            ] as const),
            role: "NEG",
          },
        ]
      if (has("topic"))
        return [
          {
            text: weighted(rng, [
              ["not", 40],
              ["except", 15],
              ["excluding", 15],
              ["exclude", 8],
              ["without", 22],
            ] as const),
            role: "NEG",
          },
        ]
      const text = has("from")
        ? pick(rng, NEG_FROM)
        : weighted(
            rng,
            NEG_ANY.map(([w, n]) => [w, n] as const),
          )
      return [{ text, role: "NEG" }]
    }
    case "OP": {
      const text = has("tag")
        ? cycled(ctx, "ctag", pools.tagContainers).replace(/^#/, "")
        : ascii(nameValue(ctx).first)
      return [{ text: text || "sam", role: null }]
    }
    case "ACTOR":
    case "RECIPIENT":
    case "PARTICIPANT":
    case "MENTION":
      return personPieces(ctx, name, mods)
    default:
      throw new Error(`unknown slot ${name}`)
  }
}

export { HARD_TOPICS }
