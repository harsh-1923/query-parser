// Alias matching for KIND and ATTR spans (PLAN §5.3–5.4, spike S05): normalization and plural
// folding, then exact match, then an adjacent-swap typo, then (kinds only) the head word.

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

/** True when b is a with exactly one pair of adjacent letters swapped ("taks" / "task"). */
function swapped(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false
  const d: number[] = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push(i)
  const [x, y] = d
  return d.length === 2 && x !== undefined && y === x + 1 && a[x] === b[y] && a[y] === b[x]
}

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
      // Typos: only an adjacent swap. S05 showed that general edit distance turns real words
      // into wrong aliases ("contract" → contact, "meme" → memo, "locked" → blocked).
      const raw = text.toLowerCase().trim()
      const hits = new Set<string>()
      for (const [alias, key] of exact)
        if (alias.length >= 4 && (swapped(n, alias) || swapped(raw, alias))) hits.add(key)
      const [only] = hits
      if (hits.size === 1 && only) return { key: only, stage: "typo" }
      if (opts.headFallback && n.includes(" ")) {
        const head = exact.get(n.slice(n.lastIndexOf(" ") + 1))
        if (head) return { key: head, stage: "head" }
      }
      return undefined
    },
  }
}
