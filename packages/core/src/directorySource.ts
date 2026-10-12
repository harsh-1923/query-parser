import type { Candidate, EntitySource, ResolveContext } from "./types"

export interface DirectoryEntry {
  id: string
  label: string
  aliases?: string[]
}

export interface DirectoryOptions<T> {
  fields: (item: T) => DirectoryEntry
  /** Current user id; "I / me / my / mine / myself" resolve to it. */
  self?: string
  /** 0..1 tie-breaker; contributes `BOOST_WEIGHT * boost` to the score. */
  boost?: (item: T, ctx: ResolveContext) => number
  /** Candidates with a base score below this are dropped. Default 0.75. */
  minScore?: number
}

const SELF_WORDS: ReadonlySet<string> = new Set(["i", "me", "my", "mine", "myself"])
const DEFAULT_MIN_SCORE = 0.75
const MAX_RESULTS = 5
const BOOST_WEIGHT = 0.05

const EXACT_FULL = 1
const EXACT_TOKEN = 0.95
const INITIAL = 0.85
const PREFIX_BASE = 0.85
const PREFIX_SPAN = 0.1
const PREFIX_MIN_LEN = 3
const JW_THRESHOLD = 0.88
/** Fuzzy matches never outrank an exact token match. */
const JW_CAP = 0.94
const PHONETIC = 0.8
const PHONETIC_MIN_KEY_LEN = 3

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

function aliasForm(alias: string): string {
  const at = alias.indexOf("@", 1)
  return normalize(at > 0 ? alias.slice(0, at) : alias)
}

function collapseRuns(s: string): string {
  return s.replace(/(.)\1+/gu, "$1")
}

export function phoneticKey(token: string): string {
  const s = collapseRuns(
    token
      .replace(/ksh/g, "ks")
      .replace(/x/g, "ks")
      .replace(/ph/g, "f")
      .replace(/th/g, "t")
      .replace(/dh/g, "d")
      .replace(/kh/g, "k")
      .replace(/gh/g, "g")
      .replace(/sh/g, "s")
      .replace(/aa/g, "a")
      .replace(/ee/g, "i")
      .replace(/oo/g, "u")
      .replace(/w/g, "v")
      .replace(/z/g, "j")
      .replace(/y$/, "i"),
  ).replace(/(?<=[^aeiouy])h/g, "")
  return collapseRuns(s.slice(0, 1) + s.slice(1).replace(/[aeiouy]/g, ""))
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  const la = a.length
  const lb = b.length
  if (la === 0 || lb === 0) return 0
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const aMatched = new Array<boolean>(la).fill(false)
  const bMatched = new Array<boolean>(lb).fill(false)
  let matches = 0
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - window)
    const hi = Math.min(lb - 1, i + window)
    for (let j = lo; j <= hi; j++) {
      if (!bMatched[j] && a.charCodeAt(i) === b.charCodeAt(j)) {
        aMatched[i] = true
        bMatched[j] = true
        matches++
        break
      }
    }
  }
  if (matches === 0) return 0
  let half = 0
  let k = 0
  for (let i = 0; i < la; i++) {
    if (!aMatched[i]) continue
    while (!bMatched[k]) k++
    if (a.charCodeAt(i) !== b.charCodeAt(k)) half++
    k++
  }
  const jaro = (matches / la + matches / lb + (matches - half / 2) / matches) / 3
  let prefix = 0
  const maxPrefix = Math.min(4, la, lb)
  while (prefix < maxPrefix && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++
  return jaro > 0.7 ? jaro + prefix * 0.1 * (1 - jaro) : jaro
}

interface Source {
  tokens: string[]
  keys: string[]
}

interface Indexed<T> {
  item: T
  id: string
  label: string
  forms: Set<string>
  fulls: string[]
  sources: Source[]
}

function toSource(form: string): Source {
  const tokens = [...new Set(form.split(" ").filter(Boolean))]
  return { tokens, keys: tokens.map(phoneticKey) }
}

function tokenScore(q: string, qKey: string, t: string, tKey: string, multi: boolean): number {
  if (q === t) return EXACT_TOKEN
  if (q.length === 1) return multi && t.startsWith(q) ? INITIAL : 0
  let best = 0
  if (q.length >= PREFIX_MIN_LEN) {
    if (t.length > q.length && t.startsWith(q)) {
      best = PREFIX_BASE + (PREFIX_SPAN * q.length) / t.length
    }
    if (q.charCodeAt(0) === t.charCodeAt(0) && Math.abs(q.length - t.length) <= 2) {
      const jw = jaroWinkler(q, t)
      if (jw >= JW_THRESHOLD) best = Math.max(best, Math.min(jw, JW_CAP))
    }
    if (qKey.length >= PHONETIC_MIN_KEY_LEN && qKey === tKey) best = Math.max(best, PHONETIC)
  }
  return best
}

export function directorySource<T>(
  items: readonly T[],
  opts: DirectoryOptions<T>,
): EntitySource<T> {
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE
  const index: Indexed<T>[] = []
  const byId = new Map<string, Indexed<T>>()

  for (const item of items) {
    const entry = opts.fields(item)
    const label = normalize(entry.label)
    const forms = new Set<string>()
    const fulls: string[] = []
    const sources: Source[] = []
    const add = (form: string) => {
      if (!form || forms.has(form)) return
      forms.add(form)
      fulls.push(form)
      sources.push(toSource(form))
    }
    add(label)
    for (const alias of entry.aliases ?? []) add(aliasForm(alias))
    const indexed: Indexed<T> = { item, id: entry.id, label: entry.label, forms, fulls, sources }
    index.push(indexed)
    if (!byId.has(entry.id)) byId.set(entry.id, indexed)
  }

  return (span, ctx) => {
    const q = normalize(span.text)
    if (!q) return []

    if (SELF_WORDS.has(q)) {
      if (opts.self === undefined) return []
      const me = byId.get(opts.self)
      const cand: Candidate<T> = { id: opts.self, label: me?.label ?? "me", score: 1 }
      if (me) cand.data = me.item
      return [cand]
    }

    const qt = q.split(" ")
    const multi = qt.length > 1
    const qKeys = qt.map(phoneticKey)
    const memos = qt.map(() => new Map<string, number>())
    // Real tokens before initials so "s sharma" doesn't spend "sharma" on the initial.
    const order = qt
      .map((_, i) => i)
      .sort((x, y) => {
        const ix = (qt[x]?.length ?? 0) === 1 ? 1 : 0
        const iy = (qt[y]?.length ?? 0) === 1 ? 1 : 0
        return ix - iy || x - y
      })

    const score = (qi: number, t: string, tKey: string): number => {
      const memo = memos[qi]
      const qs = qt[qi]
      const qk = qKeys[qi]
      if (!memo || qs === undefined || qk === undefined) return 0
      const hit = memo.get(t)
      if (hit !== undefined) return hit
      const s = tokenScore(qs, qk, t, tKey, multi)
      memo.set(t, s)
      return s
    }

    const scored: Candidate<T>[] = []
    for (const e of index) {
      let best = e.forms.has(q) ? EXACT_FULL : 0
      if (best < EXACT_FULL) {
        for (const src of e.sources) {
          if (src.tokens.length < qt.length) continue
          const used = new Array<boolean>(src.tokens.length).fill(false)
          let total = 0
          let ok = true
          for (const qi of order) {
            let bestS = 0
            let bestJ = -1
            for (let j = 0; j < src.tokens.length; j++) {
              if (used[j]) continue
              const s = score(qi, src.tokens[j] ?? "", src.keys[j] ?? "")
              if (s > bestS) {
                bestS = s
                bestJ = j
              }
            }
            if (bestJ < 0) {
              ok = false
              break
            }
            used[bestJ] = true
            total += bestS
          }
          if (ok) best = Math.max(best, total / qt.length)
        }
      }
      if (best < minScore) continue
      let s = best
      if (opts.boost) {
        const b = opts.boost(e.item, ctx)
        if (Number.isFinite(b)) s += BOOST_WEIGHT * Math.min(1, Math.max(0, b))
      }
      scored.push({ id: e.id, label: e.label, score: Math.min(1, s), data: e.item })
    }

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    return scored.slice(0, MAX_RESULTS)
  }
}
