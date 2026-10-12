// The canonical string form of a ParseResult (PLAN §4), for logs, replays and chip editing:
//   type:pdf from:@u_8f2 date:2026-10-05..2026-10-11 -from:@u_9 "sync engine" -"test merchants"
// Values are the resolved ids and keys, so the string is stable across directory label changes.
import type { ParseResult, TimeValue } from "./types"

const quote = (s: string) => (/^[^\s"():]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`)

function value(facet: string, v: unknown, timeZone: string): string[] {
  if (facet === "sort" || (v && typeof v === "object" && "dir" in v))
    return [(v as { dir: string }).dir === "asc" ? "oldest" : "newest"]
  if (v && typeof v === "object" && "granularity" in v) return [range(v as TimeValue, timeZone)]
  const list = Array.isArray(v) ? v : [v]
  return list.map((x) => (typeof x === "string" && /^[a-z]_/i.test(x) ? `@${x}` : quote(String(x))))
}

/** "2026-10-05..2026-10-11": local dates, end inclusive for whole days; "..2026-10-08" when open. */
function range(t: TimeValue, timeZone: string): string {
  const day = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso))
  const hourly = t.granularity === "hour"
  const from = t.from ? (hourly ? t.from : day(t.from)) : ""
  const to = t.to ? (hourly ? t.to : day(new Date(Date.parse(t.to) - 1).toISOString())) : ""
  return `${from}..${to}`
}

export function toCanonical(r: ParseResult): string {
  const tz = r.meta.timeZone
  const parts: string[] = []
  // Facets in the order the query mentions them, so the string reads like the query.
  const at = (facet: string) =>
    r.spans.find((s) => s.facet === facet)?.start ?? Number.MAX_SAFE_INTEGER
  const add = (bag: Record<string, unknown>, sign: string) => {
    const entries = Object.entries(bag).sort(([a], [b]) => at(a) - at(b))
    for (const [facet, v] of entries)
      for (const x of value(facet, v, tz)) parts.push(`${sign}${facet}:${x}`)
  }
  add(r.filters as Record<string, unknown>, "")
  add(r.exclude as Record<string, unknown>, "-")
  if (r.text) parts.push(`"${r.text.replace(/"/g, '\\"')}"`)
  for (const t of r.excludeText) parts.push(`-"${t.replace(/"/g, '\\"')}"`)
  return parts.join(" ")
}
