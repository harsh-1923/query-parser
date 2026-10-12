import { schema, toSearchParams } from "@qp/adapter-xyne-spaces"
import {
  createParser,
  directorySource,
  type Issue,
  type ParseResult,
  ruleTaggerFor,
  type TaggedSpan,
  type TimeValue,
} from "@qp/core"
import directory from "./demo-directory.json"
import "./style.css"

declare const __COMMIT__: string

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const input = $<HTMLInputElement>("query")
const mirror = $<HTMLDivElement>("mirror")
const out = $<HTMLDivElement>("out")
const refInput = $<HTMLInputElement>("ref")
const tzSelect = $<HTMLSelectElement>("tz")
const dayFirst = $<HTMLSelectElement>("dayFirst")
const weekStart = $<HTMLSelectElement>("weekStart")

const EXAMPLES: [string, string][] = [
  ["The headline", "pdfs from utkarsh last week about sync engine"],
  ["A ticket triage", "open p1 bugs assigned to me"],
  ["Two people, one channel", "messages from ankit or neha in #payments-ops"],
  ["Negation", "decks not from rahul verma"],
  ["An ambiguous name", "files from rahul"],
  ["A spelling the directory lacks", "sheets from utkarash yesterday"],
  ["Sorting", "latest transcripts with priya iyer"],
  ["Typed operators", "type:bug from:sneha flaky checkout"],
  ["Clock time", "#eng-alerts since yesterday 2am"],
  ["Nothing to extract", "how do refunds work"],
]

// ---------------------------------------------------------------------------------------------
// Parser: the Xyne Spaces schema, the rule tagger and a fictional demo directory

const SELF = "u_005"
const people = new Map(directory.people.map((p) => [p.id, p]))
const channels = new Map(directory.channels.map((c) => [c.id, c]))
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
const nameOf = (id: string) => people.get(id)?.name ?? channels.get(id)?.name ?? id

// ---------------------------------------------------------------------------------------------
// Reference time and zone

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
const zones = Array.from(
  new Set([
    browserTz,
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
tzSelect.innerHTML = zones.map((z) => `<option>${z}</option>`).join("")

/** "YYYY-MM-DDTHH:MM" wall time in `tz` for an instant. */
function wallTime(instant: Date, tz: string): string {
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

/** Instant for a wall time in `tz` (two passes, good enough around DST). */
function fromWallTime(wall: string, tz: string): Date {
  const asUtc = Date.parse(`${wall}:00Z`)
  let guess = asUtc
  for (let i = 0; i < 2; i++) {
    const shown = Date.parse(`${wallTime(new Date(guess), tz)}:00Z`)
    guess += asUtc - shown
  }
  return new Date(guess)
}

let pinnedRef: Date | null = null
const reference = () => pinnedRef ?? new Date()
const syncRefInput = () => {
  refInput.value = wallTime(reference(), tzSelect.value)
}

function parse(query: string): ParseResult {
  // The time policies live on the schema; the demo lets you flip them per parse.
  schema.policies.time.dayFirst = dayFirst.value === "1"
  schema.policies.time.weekStartsOn = Number(weekStart.value)
  return parser.parseSync(query, {
    reference: reference().toISOString(),
    timeZone: tzSelect.value,
    self: SELF,
  })
}

// ---------------------------------------------------------------------------------------------
// Rendering

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c)

const ROLE_CLASS: Record<string, string> = {
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
const markClass = (s: TaggedSpan) => `${ROLE_CLASS[s.role] ?? ""}${s.negated ? " negated" : ""}`

function highlight(query: string, spans: TaggedSpan[]): string {
  let html = ""
  let at = 0
  for (const s of spans) {
    if (s.start < at) continue
    html += esc(query.slice(at, s.start))
    html += `<mark class="${markClass(s)}" title="${s.role}${s.cue ? ` · cue “${esc(s.cue)}”` : ""}">${esc(query.slice(s.start, s.end))}</mark>`
    at = s.end
  }
  return `${html + esc(query.slice(at))} `
}

function fmt(instant: string, tz: string, parts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...parts }).format(new Date(instant))
}
const DAY_FMT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
}
const TIME_FMT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }

/** A half-open range for people: whole days are shown with an inclusive end. */
function describeTime(t: TimeValue, tz: string): string {
  const lastDay = (iso: string) => new Date(Date.parse(iso) - 1).toISOString()
  const day = (iso: string) => fmt(iso, tz, DAY_FMT)
  const time = (iso: string) => fmt(iso, tz, TIME_FMT)
  const at = (iso: string) => (t.granularity === "hour" ? `${day(iso)}, ${time(iso)}` : day(iso))
  if (t.from && !t.to) return `from ${at(t.from)} on`
  if (!t.from && t.to) return `before ${at(t.to)}`
  if (!t.from || !t.to) return ""
  if (t.granularity === "hour") {
    const same = day(t.from) === day(lastDay(t.to))
    return same ? `${day(t.from)}, ${time(t.from)} – ${time(t.to)}` : `${at(t.from)} → ${at(t.to)}`
  }
  const a = day(t.from)
  const b = day(lastDay(t.to))
  return a === b ? a : `${a} → ${b}`
}

const FACET_LABEL: Record<string, string> = {
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

function chipValue(facet: string, value: unknown, tz: string): string {
  if (facet === "date") return describeTime(value as TimeValue, tz)
  if (facet === "sort")
    return (value as { dir: string }).dir === "asc" ? "oldest first" : "newest first"
  if (typeof value === "boolean") return value ? "yes" : "no"
  const list = Array.isArray(value) ? value : [value]
  const pretty = (v: string) =>
    people.has(v) || channels.has(v) ? nameOf(v) : v.toLowerCase().replace(/_/g, " ")
  const names = list.map((v) => (typeof v === "string" ? pretty(v) : String(v)))
  return names.join(" or ")
}

function chips(bag: Record<string, unknown>, tz: string, negated: boolean): string {
  return Object.entries(bag)
    .map(([facet, value]) => {
      const cls = facet === "date" ? "time" : facet === "type" ? "kind" : ""
      return `<span class="chip ${cls}${negated ? " negated" : ""}"><b>${negated ? "Not " : ""}${esc(FACET_LABEL[facet] ?? facet)}</b> ${esc(chipValue(facet, value, tz))}</span>`
    })
    .join("")
}

function describeIssue(i: Issue): string {
  switch (i.kind) {
    case "ambiguous":
      return `“${esc(i.span.text)}” could be ${i.candidates.map((c) => esc(c.label)).join(" or ")}. A UI would ask; the parser doesn't guess.`
    case "unresolved":
      return `“${esc(i.span.text)}” isn't in the directory, so it's searched as text.`
    case "unbound":
      return `“${esc(i.span.text)}” (${i.span.role.toLowerCase()}) has no Xyne Spaces filter yet, so it's searched as text.`
    case "unsupported":
      return `“${esc(i.span.text)}” isn't a time the normalizer understands, so it's searched as text.`
    case "low-confidence":
      return "Low confidence: returning the query as plain text."
  }
}

function render() {
  const query = input.value
  const tz = tzSelect.value
  const r = parse(query)
  mirror.innerHTML = highlight(query, r.spans)
  mirror.scrollLeft = input.scrollLeft

  const refLine = `Relative to ${fmt(r.meta.reference, tz, DAY_FMT)}, ${fmt(r.meta.reference, tz, TIME_FMT)} · ${tz} · signed in as ${esc(people.get(SELF)?.name ?? "")} · ${r.meta.tookMs.toFixed(2)} ms`
  if (!query.trim()) {
    out.innerHTML = `<p class="hint">Type a search query.</p><p class="ref">${refLine}</p>`
    return
  }
  const filters = chips(r.filters as Record<string, unknown>, tz, false)
  const excludes = chips(r.exclude as Record<string, unknown>, tz, true)
  const params = toSearchParams(r).toString().replace(/%2C/g, ",").replace(/%23/g, "#")
  out.innerHTML = `
    <div class="chips">${filters + excludes || `<span class="hint">No filters. Everything is search text.</span>`}</div>
    <div class="text"><span class="label">Search text</span><span>${r.text ? `<mark class="topic">${esc(r.text)}</mark>` : "—"}${r.excludeText.length ? ` <span class="muted">minus</span> <mark class="topic negated">${esc(r.excludeText.join(", "))}</mark>` : ""}</span></div>
    ${r.issues.length ? `<ul class="issues">${r.issues.map((i) => `<li>${describeIssue(i)}</li>`).join("")}</ul>` : ""}
    ${Object.keys(r.exclude).length ? `<p class="note">Xyne Spaces' search API can't exclude filters yet, so the request below leaves the “not” out.</p>` : ""}
    <details class="api"><summary>Xyne Spaces request</summary><code>GET /api/vespaSearch?${esc(params)}</code></details>
    <p class="ref">${refLine}</p>`
}

function renderTiles() {
  const tiles = $<HTMLDivElement>("tiles")
  tiles.innerHTML = EXAMPLES.map(
    ([label, q], i) =>
      `<button type="button" class="tile" data-i="${i}"><span class="eyebrow">${esc(label)}</span><span class="q">${highlight(q, parse(q).spans)}</span></button>`,
  ).join("")
  tiles.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".tile")
    const ex = b && EXAMPLES[Number(b.dataset.i)]
    if (!ex) return
    input.value = ex[1]
    render()
    window.scrollTo({ top: 0, behavior: "smooth" })
    input.focus()
  }
}

// ---------------------------------------------------------------------------------------------
// Wiring

const rerender = () => {
  render()
  renderTiles()
}
input.addEventListener("input", render)
input.addEventListener("scroll", () => {
  mirror.scrollLeft = input.scrollLeft
})
refInput.addEventListener("change", () => {
  pinnedRef = refInput.value ? fromWallTime(refInput.value, tzSelect.value) : null
  rerender()
})
tzSelect.addEventListener("change", () => {
  syncRefInput()
  rerender()
})
for (const el of [dayFirst, weekStart]) el.addEventListener("change", rerender)
$<HTMLButtonElement>("resetRef").addEventListener("click", () => {
  pinnedRef = null
  syncRefInput()
  rerender()
})

const commit = __COMMIT__
$<HTMLSpanElement>("build").innerHTML =
  commit === "local"
    ? "local build"
    : `build <a href="https://github.com/harsh-1923/query-parser/commit/${esc(commit)}">${esc(commit.slice(0, 7))}</a>`

input.value = EXAMPLES[0]?.[1] ?? ""
syncRefInput()
rerender()
