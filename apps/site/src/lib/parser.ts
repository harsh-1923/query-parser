// The demo's parser: the Xyne Spaces schema, the rule tagger and a fictional directory.
import { schema, toSearchParams } from "@qp/adapter-xyne-spaces"
import {
  createParser,
  directorySource,
  type Issue,
  type ParseResult,
  type Role,
  ruleTaggerFor,
  type TimeValue,
} from "@qp/core"
import directory from "@/demo-directory.json"

export { directory, schema }

export const SELF = "u_005"
export const people = new Map(directory.people.map((p) => [p.id, p]))
export const channels = new Map(directory.channels.map((c) => [c.id, c]))
export const nameOf = (id: string) => people.get(id)?.name ?? channels.get(id)?.name ?? id

const parser = createParser({
  schema,
  tagger: ruleTaggerFor(schema),
  sources: {
    person: directorySource(directory.people, {
      fields: (p) => ({ id: p.id, label: p.name, aliases: [p.handle] }),
      self: SELF,
    }),
    channel: directorySource(directory.channels, {
      fields: (c) => ({ id: c.id, label: c.name, aliases: [c.name.slice(1)] }),
    }),
  },
})

export interface Settings {
  reference: Date | null // null = now
  timeZone: string
  dayFirst: boolean
  weekStartsOn: number
}

export function parse(query: string, s: Settings): ParseResult {
  // Time policies live on the schema; the demo flips them per parse.
  schema.policies.time.dayFirst = s.dayFirst
  schema.policies.time.weekStartsOn = s.weekStartsOn
  return parser.parseSync(query, {
    reference: (s.reference ?? new Date()).toISOString(),
    timeZone: s.timeZone,
    self: SELF,
  })
}

export function requestFor(r: ParseResult): string {
  const qs = toSearchParams(r).toString().replace(/%2C/g, ",").replace(/%23/g, "#")
  return `GET /api/vespaSearch${qs ? `?${qs}` : ""}`
}

// ---------------------------------------------------------------------------------------------
// Roles

export type Tone = "kind" | "person" | "place" | "time" | "attr" | "order" | "neg" | "topic"

export const TONE: Record<Role, Tone> = {
  KIND: "kind",
  ACTOR: "person",
  RECIPIENT: "person",
  PARTICIPANT: "person",
  MENTION: "person",
  CONTAINER: "place",
  TIME: "time",
  ATTR: "attr",
  ORDER: "order",
  NEG: "neg",
  TOPIC: "topic",
}

export const TONE_CLASS: Record<Tone, string> = {
  kind: "bg-sky-100",
  person: "bg-emerald-100",
  place: "bg-orange-100",
  time: "bg-amber-100",
  attr: "bg-violet-100",
  order: "bg-pink-100",
  neg: "bg-red-100",
  topic: "bg-neutral-100",
}

export const LEGEND: [Tone, string][] = [
  ["kind", "Kind"],
  ["person", "Person"],
  ["place", "Place"],
  ["time", "Time"],
  ["attr", "State"],
  ["order", "Sort"],
  ["neg", "Not"],
  ["topic", "Search text"],
]

// ---------------------------------------------------------------------------------------------
// Formatting

export function fmt(instant: string | Date, tz: string, parts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...parts }).format(new Date(instant))
}
export const DAY: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
}
export const CLOCK: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }

/** A half-open range for people: whole days are shown with an inclusive end. */
export function describeTime(t: TimeValue, tz: string): string {
  const lastDay = (iso: string) => new Date(Date.parse(iso) - 1).toISOString()
  const day = (iso: string) => fmt(iso, tz, DAY)
  const time = (iso: string) => fmt(iso, tz, CLOCK)
  const at = (iso: string) => (t.granularity === "hour" ? `${day(iso)}, ${time(iso)}` : day(iso))
  if (t.from && !t.to) return `from ${at(t.from)} on`
  if (!t.from && t.to) return `before ${at(t.to)}`
  if (!t.from || !t.to) return ""
  if (t.granularity === "hour") {
    return day(t.from) === day(lastDay(t.to))
      ? `${day(t.from)}, ${time(t.from)} – ${time(t.to)}`
      : `${at(t.from)} → ${at(t.to)}`
  }
  const a = day(t.from)
  const b = day(lastDay(t.to))
  if (a === b) return a
  const sameYear =
    fmt(t.from, tz, { year: "numeric" }) === fmt(lastDay(t.to), tz, { year: "numeric" })
  const short = (iso: string) => fmt(iso, tz, { weekday: "short", month: "short", day: "numeric" })
  return sameYear ? `${short(t.from)} → ${b}` : `${a} → ${b}`
}

export const FACET_LABEL: Record<string, string> = {
  type: "Type",
  from: "From",
  to: "To",
  assignee: "Assignee",
  with: "With",
  mentions: "Mentions",
  in: "In",
  date: "Date",
  status: "Status",
  priority: "Priority",
  bots: "Bots",
  sort: "Sort",
}

export function chipValue(facet: string, value: unknown, tz: string): string {
  if (facet === "date") return describeTime(value as TimeValue, tz)
  if (facet === "sort")
    return (value as { dir: string }).dir === "asc" ? "oldest first" : "newest first"
  if (typeof value === "boolean") return value ? "yes" : "no"
  const list = Array.isArray(value) ? value : [value]
  return list
    .map((v) =>
      typeof v !== "string"
        ? String(v)
        : people.has(v) || channels.has(v)
          ? nameOf(v)
          : v.toLowerCase().replace(/_/g, " "),
    )
    .join(" or ")
}

export function describeIssue(i: Issue): string {
  switch (i.kind) {
    case "ambiguous":
      return `“${i.span.text}” could be ${i.candidates.map((c) => c.label).join(" or ")}. A UI would ask; the parser doesn't guess.`
    case "unresolved":
      return `“${i.span.text}” isn't in the directory, so it's searched as text.`
    case "unbound":
      return `“${i.span.text}” has no Xyne Spaces filter yet, so it's searched as text.`
    case "unsupported":
      return `“${i.span.text}” isn't a time the normalizer understands, so it's searched as text.`
    case "low-confidence":
      return "Low confidence: returning the query as plain text."
  }
}

// ---------------------------------------------------------------------------------------------
// Wall time in a zone, for the reference picker

export function wallTime(instant: Date, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  )
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

export function fromWallTime(wall: string, tz: string): Date {
  const asUtc = Date.parse(`${wall}:00Z`)
  let guess = asUtc
  for (let i = 0; i < 2; i++) guess += asUtc - Date.parse(`${wallTime(new Date(guess), tz)}:00Z`)
  return new Date(guess)
}

export const ZONES = Array.from(
  new Set([
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    "Asia/Kolkata",
    "UTC",
    "Europe/London",
    "Europe/Berlin",
    "America/New_York",
    "America/Los_Angeles",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
  ]),
)
