// Alias matching for KIND and ATTR spans (PLAN §5.3–5.4, spike S05): normalization and plural
// folding, then exact match, then a small typo allowance, then (kinds only) the head word.

const SINGULAR_EXCEPTIONS = new Set([
  "notes",
  "minutes",
  "news",
  "status",
  "canvas",
  "bus",
  "yes",
  "ios",
  "this",
  "is",
  "has",
  "qa",
  "wip",
])

function singular(w: string): string {
  if (w.length <= 3 || SINGULAR_EXCEPTIONS.has(w)) return w
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`
  if (/(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1)
  return w
}

export function normalizeAlias(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/[^a-z0-9:'\- ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .join(" ")
}

/** Optimal string alignment distance; returns cap + 1 once it is exceeded. */
function osa(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, (prev2[j - 2] ?? 0) + 1)
      cur.push(v)
    }
    prev2 = prev
    prev = cur
  }
  return prev[b.length] ?? cap + 1
}

const allowance = (s: string) => (s.length >= 8 ? 2 : s.length >= 4 ? 1 : 0)

export type AliasStage = "exact" | "typo" | "head"

export interface AliasIndex {
  match(text: string): { key: string; stage: AliasStage } | undefined
  /** Every alias, normalized, for taggers that need a lexicon. */
  aliases(): string[]
}

export function aliasIndex(
  defs: Record<string, { aliases: string[] }>,
  opts: { headFallback?: boolean } = {},
): AliasIndex {
  const exact = new Map<string, string>()
  for (const [key, d] of Object.entries(defs)) {
    exact.set(normalizeAlias(key), key)
    for (const a of d.aliases) exact.set(normalizeAlias(a), key)
  }
  return {
    aliases: () => [...exact.keys()],
    match(text) {
      const n = normalizeAlias(text)
      const hit = exact.get(n)
      if (hit) return { key: hit, stage: "exact" }
      const cap = allowance(n)
      if (cap) {
        let best: { d: number; key: string } | undefined
        let tie = false
        for (const [alias, key] of exact) {
          if (alias.length < 4) continue
          const d = osa(n, alias, cap)
          if (d > cap) continue
          if (!best || d < best.d) {
            best = { d, key }
            tie = false
          } else if (d === best.d && key !== best.key) tie = true
        }
        if (best && !tie) return { key: best.key, stage: "typo" }
      }
      if (opts.headFallback && n.includes(" ")) {
        const head = exact.get(n.slice(n.lastIndexOf(" ") + 1))
        if (head) return { key: head, stage: "head" }
      }
      return undefined
    },
  }
}
