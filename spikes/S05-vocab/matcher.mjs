// Alias matcher: normalization + plural folding + exact match, then an adjacent-swap typo, then (kinds
// only) the head word of a multi-word span. Returns { key, stage } or null. Deterministic.

const SINGULAR_EXCEPTIONS = new Set(["notes", "minutes", "news", "status", "canvas", "bus", "yes", "ios", "this", "is", "has", "qa", "wip"])

export function singular(w) {
  if (w.length <= 3 || SINGULAR_EXCEPTIONS.has(w)) return w
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`
  if (/(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1)
  return w
}

export function normalize(s) {
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

/** True when b is a with exactly one pair of adjacent letters swapped. */
export function swapped(a, b) {
  if (a.length !== b.length || a === b) return false
  const d = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push(i)
  return d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]
}

export function buildIndex(aliases) {
  const exact = new Map()
  for (const [key, list] of Object.entries(aliases)) {
    for (const a of list) {
      const n = normalize(a)
      const prev = exact.get(n)
      if (prev && prev !== key) throw new Error(`alias "${a}" maps to ${prev} and ${key}`)
      exact.set(n, key)
    }
  }
  return exact
}

export function match(index, span, { headFallback = false } = {}) {
  const n = normalize(span)
  if (index.has(n)) return { key: index.get(n), stage: "exact" }
  // Typos: only an adjacent swap ("taks" → task). S05 v1 showed edits and deletions turn real
  // words into wrong aliases ("contract" → contact, "meme" → memo, "locked" → blocked).
  const raw = span.toLowerCase().trim()
  const hits = new Set()
  for (const [alias, key] of index) {
    if (alias.length >= 4 && (swapped(n, alias) || swapped(raw, alias))) hits.add(key)
  }
  if (hits.size === 1) return { key: [...hits][0], stage: "typo" }
  if (headFallback && n.includes(" ")) {
    const head = n.split(" ").at(-1)
    if (index.has(head)) return { key: index.get(head), stage: "head" }
  }
  return null
}
