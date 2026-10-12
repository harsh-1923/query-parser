// Demo-only span finder: picks the longest word runs that @qp/time understands. The tagger
// (M4) replaces this; @qp/time itself only normalizes spans it is handed (PLAN §8).
import { normalizeTime, type Options, type TimeResult } from "@qp/time"

export interface Span {
  start: number
  end: number
  text: string
  result: Extract<TimeResult, { ok: true }>
}

const MAX_WORDS = 7
// A lone word only counts if it's unmistakably a time word or contains a digit ("3/10", "q3"),
// so names like "jane" (a typo of "june" to the grammar) and "may" stay text.
const LONE_WORDS = new Set(
  (
    "today yesterday tomorrow tonight recent recently lately ytd yday " +
    "monday tuesday wednesday thursday friday saturday sunday mon tue tues thu thurs fri " +
    "january february march april june july august september october november december " +
    "jan feb apr jun jul aug sep sept oct nov dec weekend"
  ).split(" "),
)

// A span followed by one of these is part of a longer phrase the grammar doesn't support yet
// ("q2 fy24", "h2 2024"), so it isn't highlighted on its own.
const CONTINUES = /^(fy\d*|h[12])$/i

export function findTimeSpans(query: string, opts: Options): Span[] {
  const words = [...query.matchAll(/[^\s,;!?()]+/g)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }))
  const spans: Span[] = []
  for (let i = 0; i < words.length; ) {
    let found: Span | undefined
    for (let j = Math.min(words.length, i + MAX_WORDS); j > i; j--) {
      const start = words[i]!.start
      const end = words[j - 1]!.end
      const text = query.slice(start, end)
      const lone = text.toLowerCase().replace(/'s$/, "")
      if (j - i === 1 && !/\d/.test(lone) && !LONE_WORDS.has(lone)) continue
      const result = normalizeTime(text, opts)
      const after = words[j]
      const next = after && query.slice(after.start, after.end)
      if (result.ok && !(next && CONTINUES.test(next))) {
        found = { start, end, text, result }
        i = j
        break
      }
    }
    if (found) spans.push(found)
    else i++
  }
  return spans
}
