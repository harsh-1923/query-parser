import type { Options } from "@qp/time"
import { findTimeSpans, type Span } from "./spans"
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
  ["A name and a week", "pdfs from utkarsh last week"],
  ["Day-first dates", "invoices before 3/10"],
  ["Part of the day", "standup notes monday morning"],
  ["Older than", "my tickets older than 30 days"],
  ["A range", "payouts between 1st and 15th"],
  ["Sloppy typing", "deploys frm mon 2 fri"],
  ["Clock time", "#eng-alerts since yesterday 2am"],
  ["Not a time", "latest pitch deck"],
]

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

function syncRefInput() {
  refInput.value = wallTime(reference(), tzSelect.value)
}

function options(): Options {
  return {
    reference: reference().toISOString(),
    timeZone: tzSelect.value,
    policies: { dayFirst: dayFirst.value === "1", weekStartsOn: Number(weekStart.value) },
  }
}

// ---------------------------------------------------------------------------------------------
// Rendering

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

function kind(s: Span) {
  const r = s.result
  if (r.from === undefined || r.to === undefined) return "open"
  return r.granularity === "hour" ? "clock" : "date"
}

function highlight(query: string, spans: Span[]): string {
  let html = ""
  let at = 0
  for (const s of spans) {
    html += esc(query.slice(at, s.start))
    html += `<mark class="${kind(s)}">${esc(s.text)}</mark>`
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

/** Human summary of a half-open range: the end is shown inclusive for whole days. */
function describe(s: Span, tz: string): { main: string; side: string } {
  const { from, to, granularity: g } = s.result
  const lastDay = (iso: string) => new Date(Date.parse(iso) - 1).toISOString()
  const day = (iso: string) => fmt(iso, tz, DAY_FMT)
  const time = (iso: string) => fmt(iso, tz, TIME_FMT)
  const at = (iso: string) => (g === "hour" ? `${day(iso)} · ${time(iso)}` : day(iso))
  if (from && !to) return { main: `From ${at(from)}`, side: "onward" }
  if (!from && to) return { main: `Before ${at(to)}`, side: "" }
  if (!from || !to) return { main: "", side: "" }
  if (g === "hour") {
    const sameDay = day(from) === day(lastDay(to))
    return {
      main: sameDay ? day(from) : `${day(from)} → ${day(lastDay(to))}`,
      side: `${time(from)} – ${time(to)}`,
    }
  }
  const a = day(from)
  const b = day(lastDay(to))
  return { main: a === b ? a : `${a} → ${b}`, side: g === "day" && a === b ? "All day" : g }
}

function render() {
  const query = input.value
  const opts = options()
  const tz = opts.timeZone
  const spans = query.trim() ? findTimeSpans(query, opts) : []
  mirror.innerHTML = highlight(query, spans)
  mirror.scrollLeft = input.scrollLeft

  const refLine = `Relative to ${fmt(opts.reference, tz, DAY_FMT)}, ${fmt(opts.reference, tz, TIME_FMT)} · ${tz}`
  if (!query.trim()) {
    out.innerHTML = `<p class="hint">Type a search query with a time in it.</p><p class="ref">${esc(refLine)}</p>`
    return
  }
  let text = ""
  let at = 0
  for (const s of spans) {
    text += `${query.slice(at, s.start)} `
    at = s.end
  }
  text = (text + query.slice(at)).replace(/\s+/g, " ").trim()

  const rows = spans.map((s) => {
    const d = describe(s, tz)
    const iso = `${s.result.from ?? "−∞"} → ${s.result.to ?? "+∞"}`
    return `<div class="row">
      <div class="phrase"><mark class="${kind(s)}">${esc(s.text)}</mark></div>
      <div class="when"><span>${esc(d.main)}</span><span class="side">${esc(d.side)}</span></div>
      <div class="iso">${esc(iso)}</div>
    </div>`
  })
  out.innerHTML = `
    ${rows.length ? rows.join("") : `<p class="hint">No time found. Phrases the grammar doesn't understand are left as text, never guessed.</p>`}
    <div class="text"><span class="label">Search text</span><span>${text ? `<mark class="text">${esc(text)}</mark>` : "—"}</span></div>
    <p class="ref">${esc(refLine)}</p>`
}

function renderTiles() {
  const tiles = $<HTMLDivElement>("tiles")
  tiles.innerHTML = EXAMPLES.map(
    ([label, q], i) =>
      `<button type="button" class="tile" data-i="${i}"><span class="eyebrow">${esc(label)}</span><span class="q">${highlight(q, findTimeSpans(q, options()))}</span></button>`,
  ).join("")
  tiles.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".tile")
    if (!b) return
    input.value = EXAMPLES[Number(b.dataset.i)]![1]
    render()
    window.scrollTo({ top: 0, behavior: "smooth" })
    input.focus()
  }
}

// ---------------------------------------------------------------------------------------------
// Wiring

input.addEventListener("input", render)
input.addEventListener("scroll", () => {
  mirror.scrollLeft = input.scrollLeft
})
refInput.addEventListener("change", () => {
  pinnedRef = refInput.value ? fromWallTime(refInput.value, tzSelect.value) : null
  render()
  renderTiles()
})
tzSelect.addEventListener("change", () => {
  syncRefInput()
  render()
  renderTiles()
})
for (const el of [dayFirst, weekStart])
  el.addEventListener("change", () => {
    render()
    renderTiles()
  })
$<HTMLButtonElement>("resetRef").addEventListener("click", () => {
  pinnedRef = null
  syncRefInput()
  render()
  renderTiles()
})

const commit = __COMMIT__
$<HTMLSpanElement>("build").innerHTML =
  commit === "local"
    ? "local build"
    : `build <a href="https://github.com/harsh-1923/query-parser/commit/${esc(commit)}">${esc(commit.slice(0, 7))}</a>`

input.value = EXAMPLES[0]![1]
syncRefInput()
render()
renderTiles()
