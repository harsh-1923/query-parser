// Hand-written grammar for an isolated TIME span. Semantics: spikes/S04-time/POLICIES.md
// (ADR 0003). Started as the S04 prototype; coverage is tracked against held-out phrases.
//
// Internally everything is "local civil time" encoded as milliseconds on a UTC clock
// (Date.UTC(y, m - 1, d, h)), so calendar arithmetic never touches the host timezone. Only the
// final conversion to instants uses the IANA zone, through Intl with a fixed locale.

import type { Anchors, Granularity, Options, Policies, TimeResult, Which } from "./types"

const DEFAULTS: Policies = {
  weekStartsOn: 1,
  dayFirst: true,
  recentDays: 7,
  fiscalYearStartMonth: 1,
}

// ---------------------------------------------------------------------------------------------
// Civil time helpers. A Day is an integer count of days since 1970-01-01; L is local civil ms.

const DAY = 86_400_000
const HOUR = 3_600_000
type Day = number
type L = number

const dayOf = (y: number, m: number, d: number): Day => Date.UTC(y, m - 1, d) / DAY
const ymd = (day: Day) => {
  const dt = new Date(day * DAY)
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    dow: dt.getUTCDay(),
  }
}
const validDate = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 && ymd(dayOf(y, m, d)).d === d
const addMonths = (day: Day, n: number): Day => {
  const { y, m, d } = ymd(day)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const last = ymd(dayOf(ny, nm + 1, 0)).d
  return dayOf(ny, nm, Math.min(d, last))
}

const fmt = (l: L) => new Date(l).toISOString().slice(0, 16)

const partsFormatter = new Map<string, Intl.DateTimeFormat>()
function zoneParts(instant: number, timeZone: string): L {
  let f = partsFormatter.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    partsFormatter.set(timeZone, f)
  }
  const p: Record<string, number> = {}
  for (const { type, value } of f.formatToParts(instant)) p[type] = Number(value)
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!)
}
const toLocal = (instant: number, tz: string): L => zoneParts(instant, tz)
function toInstant(local: L, tz: string): number {
  // Two passes handle DST transitions well enough for a spike.
  let guess = local - (zoneParts(local, tz) - local)
  guess = local - (zoneParts(guess, tz) - guess)
  return guess
}

// ---------------------------------------------------------------------------------------------
// Tokens

type Tok =
  | { k: "word"; v: string; raw: string }
  | { k: "num"; v: number; raw: string }
  | { k: "ord"; v: number; raw: string } // 15th
  | { k: "clock"; h: number; raw: string } // 3pm, 14:00
  | { k: "iso"; y: number; m: number; d: number; raw: string }
  | { k: "numdate"; a: number; b: number; y?: number; raw: string } // 3/10, 3/10/26, 01.06
  | { k: "quarter"; q: number; y?: number; raw: string } // q3, 1q25
  | { k: "shortyear"; y: number; raw: string } // '24
  | { k: "dash"; raw: string }
  | { k: "other"; raw: string }

const TOKEN_RE =
  /(\d{4})-(\d{1,2})-(\d{1,2})|(\d+(?:\.\d+){2,})|(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?(?![\d.])|(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b|(\d{1,2})(?:st|nd|rd|th)\b|([1-4])q(\d{2})\b|q([1-4])\b|'(\d{2})\b|(\d+)|([a-z]+)|([-–—])|(\S)/gy

const SYNONYMS: Record<string, string> = {
  yday: "yesterday",
  weak: "week",
  quater: "quarter",
  ystrday: "yesterday",
  yestrday: "yesterday",
  ysterday: "yesterday",
  yestday: "yesterday",
  tdy: "today",
  tday: "today",
  wknd: "weekend",
  wkend: "weekend",
  lst: "last",
  over: "during",
  yest: "yesterday",
  tmrw: "tomorrow",
  tmr: "tomorrow",
  tmrrw: "tomorrow",
  b4: "before",
  til: "until",
  till: "until",
  untill: "until",
  upto: "until",
  thru: "through",
  btwn: "between",
  btw: "between",
  n: "and",
  frm: "from",
  aftr: "after",
  prev: "previous",
  current: "this",
  sec: "second",
  min: "minute",
  mins: "minute",
  minutes: "minute",
  hr: "hour",
  hrs: "hour",
  h: "hour",
  hours: "hour",
  d: "day",
  days: "day",
  wk: "week",
  wks: "week",
  w: "week",
  weeks: "week",
  mo: "month",
  mos: "month",
  mth: "month",
  mths: "month",
  months: "month",
  qtr: "quarter",
  qtrs: "quarter",
  quarters: "quarter",
  yr: "year",
  yrs: "year",
  y: "year",
  years: "year",
  weekends: "weekend",
}

const UNITS = ["minute", "hour", "day", "week", "month", "quarter", "year"] as const
type Unit = (typeof UNITS)[number]

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  weds: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}
const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
}
const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  couple: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}
const ORDINAL_WORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 }
const PARTS: Record<string, [number, number]> = {
  morning: [6, 12],
  afternoon: [12, 17],
  evening: [17, 21],
  night: [21, 30],
}
const FILLERS = new Set(["the", "of", "at", "just"])

const KEYWORDS = [
  "fy",
  "half",
  "today",
  "yesterday",
  "tomorrow",
  "tonight",
  "noon",
  "midnight",
  "recent",
  "recently",
  "lately",
  "ytd",
  "this",
  "last",
  "past",
  "previous",
  "next",
  "ago",
  "before",
  "after",
  "since",
  "until",
  "by",
  "on",
  "in",
  "during",
  "from",
  "between",
  "and",
  "to",
  "through",
  "older",
  "newer",
  "than",
  "within",
  "weekend",
  "prior",
  "am",
  "pm",
]
const LEXICON = new Set([
  ...KEYWORDS,
  ...UNITS,
  ...Object.keys(WEEKDAYS),
  ...Object.keys(MONTHS),
  ...Object.keys(NUMBER_WORDS),
  ...Object.keys(ORDINAL_WORDS),
  ...Object.keys(PARTS),
  ...FILLERS,
  ...Object.values(SYNONYMS),
])

/**
 * A safe typo of a time word: one adjacent swap ("decmeber"), or one dropped letter in a word of 5+
 * letters ("fridy", "agust"). Substitutions and extra letters are not accepted: they turn real
 * words into dates ("sent" → sept, "match" → march, "soon" → noon, "jane" → june).
 */
function isTypoOf(w: string, x: string): boolean {
  if (w.length === x.length) {
    const d: number[] = []
    for (let i = 0; i < w.length; i++) if (w[i] !== x[i]) d.push(i)
    const [a, b] = d
    return d.length === 2 && a !== undefined && b === a + 1 && w[a] === x[b] && w[b] === x[a]
  }
  if (w.length < 5 || x.length !== w.length + 1) return false
  for (let i = 0; i < x.length; i++) if (x.slice(0, i) + x.slice(i + 1) === w) return true
  return false
}

function fixWord(w: string): string[] {
  if (SYNONYMS[w]) return [SYNONYMS[w]!]
  if (LEXICON.has(w)) return [w]
  if (w.length >= 4) {
    const hits = [...LEXICON].filter((x) => x.length >= 4 && isTypoOf(w, x))
    if (hits.length === 1) return [hits[0]!]
  }
  for (let i = 2; i < w.length - 1; i++) {
    const a = SYNONYMS[w.slice(0, i)] ?? w.slice(0, i)
    const b = SYNONYMS[w.slice(i)] ?? w.slice(i)
    if (LEXICON.has(a) && LEXICON.has(b) && a.length > 1 && b.length > 1) return [a, b]
  }
  return [w]
}

function tokenize(text: string): Tok[] {
  const s = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/(\w)'s\b/g, "$1")
    .replace(/\bb4\b/g, "before")
    // "fy24", "fiscal year 2025", "h2" become separate words the parser knows.
    .replace(/\bfiscal\s+year\b/g, "fy")
    .replace(/\bfy\s?(\d{2}|\d{4})\b/g, "fy $1")
    .replace(/\bh([12])\b/g, "half $1")
    .trim()
  const out: Tok[] = []
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while (TOKEN_RE.lastIndex < s.length) {
    while (s[TOKEN_RE.lastIndex] === " ") TOKEN_RE.lastIndex++
    if (TOKEN_RE.lastIndex >= s.length) break
    m = TOKEN_RE.exec(s)
    if (!m) break
    const raw = m[0]
    if (m[1]) out.push({ k: "iso", y: +m[1], m: +m[2]!, d: +m[3]!, raw })
    else if (m[4])
      out.push({ k: "word", v: m[4], raw }) // version-like: only anchors use it
    else if (m[5]) {
      const y = m[7] ? (m[7].length === 2 ? 2000 + +m[7] : +m[7]) : undefined
      out.push({ k: "numdate", a: +m[5], b: +m[6]!, ...(y === undefined ? {} : { y }), raw })
    } else if (m[8]) {
      const h = (+m[8] % 12) + (m[10] === "pm" ? 12 : 0)
      if (m[9] && m[9] !== "00")
        out.push({ k: "other", raw }) // minutes: finer than an hour
      else out.push({ k: "clock", h, raw })
    } else if (m[11]) out.push({ k: "ord", v: +m[11], raw })
    else if (m[12]) out.push({ k: "quarter", q: +m[12], y: 2000 + +m[13]!, raw })
    else if (m[14]) out.push({ k: "quarter", q: +m[14], raw })
    else if (m[15]) out.push({ k: "shortyear", y: 2000 + +m[15], raw })
    else if (m[16]) out.push({ k: "num", v: +m[16], raw })
    else if (m[17]) for (const v of fixWord(m[17])) out.push({ k: "word", v, raw })
    else if (m[18]) out.push({ k: "dash", raw })
    else if (raw === "&") out.push({ k: "word", v: "and", raw })
    else if (raw === "," || raw === ".") continue
    else out.push({ k: "other", raw })
  }
  return out.filter((t) => !(t.k === "word" && FILLERS.has(t.v)))
}

// ---------------------------------------------------------------------------------------------
// Intervals and resolution

interface Interval {
  from?: L
  to?: L
  g: Granularity
  clock?: boolean // a clock time ("3pm"), treated as a point by operators
}

interface Ctx {
  refL: L
  today: Day
  p: Policies
}

/** A parsed point, resolved lazily so ranges can resolve their start relative to their end. */
type Point = (ctx: Ctx, notAfter: Day) => Interval | null

const dayIv = (day: Day): Interval => ({ from: day * DAY, to: (day + 1) * DAY, g: "day" })
const weekStart = (day: Day, p: Policies) => day - ((ymd(day).dow - p.weekStartsOn + 7) % 7)
const monthStartOf = (day: Day) => {
  const { y, m } = ymd(day)
  return dayOf(y, m, 1)
}
const quarterStartOf = (day: Day) => {
  const { y, m } = ymd(day)
  return dayOf(y, m - ((m - 1) % 3), 1)
}

function unitPeriod(unit: Unit, day: Day, ctx: Ctx): Interval | null {
  switch (unit) {
    case "day":
      return dayIv(day)
    case "week": {
      const s = weekStart(day, ctx.p)
      return { from: s * DAY, to: (s + 7) * DAY, g: "week" }
    }
    case "month": {
      const s = monthStartOf(day)
      return { from: s * DAY, to: addMonths(s, 1) * DAY, g: "month" }
    }
    case "quarter": {
      const s = quarterStartOf(day)
      return { from: s * DAY, to: addMonths(s, 3) * DAY, g: "quarter" }
    }
    case "year": {
      const { y } = ymd(day)
      return { from: dayOf(y, 1, 1) * DAY, to: dayOf(y + 1, 1, 1) * DAY, g: "year" }
    }
    default:
      return null
  }
}

function shift(unit: Unit, day: Day, n: number): Day {
  switch (unit) {
    case "day":
      return day + n
    case "week":
      return day + 7 * n
    case "month":
      return addMonths(day, n)
    case "quarter":
      return addMonths(day, 3 * n)
    case "year":
      return addMonths(day, 12 * n)
    default:
      return day
  }
}

function rolling(unit: Unit, n: number, ctx: Ctx): Interval | null {
  if (unit === "minute") return null
  if (unit === "hour") return { from: ctx.refL - n * HOUR, to: ctx.refL, g: "hour" }
  return { from: (shift(unit, ctx.today, -n) + 1) * DAY, to: (ctx.today + 1) * DAY, g: "day" }
}

/** Most recent day ≤ notAfter whose weekday is dow. */
const lastDow = (notAfter: Day, dow: number) => notAfter - ((ymd(notAfter).dow - dow + 7) % 7)

// ---------------------------------------------------------------------------------------------
// Parser: each rule takes a token position and returns every way it can match.

type Match<T> = [T, number]

class Parser {
  private t: Tok[]
  constructor(t: Tok[]) {
    this.t = t
  }

  word(i: number, ...ws: string[]): boolean {
    const tok = this.t[i]
    return tok?.k === "word" && ws.includes(tok.v)
  }
  wordAt(i: number): string | undefined {
    const tok = this.t[i]
    return tok?.k === "word" ? tok.v : undefined
  }

  number(i: number): Match<number> | null {
    const tok = this.t[i]
    if (this.word(i, "a") && this.word(i + 1, "couple")) return [2, i + 2]
    if (tok?.k === "num") return [tok.v, i + 1]
    const w = this.wordAt(i)
    if (w && NUMBER_WORDS[w] !== undefined) return [NUMBER_WORDS[w]!, i + 1]
    return null
  }
  unit(i: number): Match<Unit> | null {
    const w = this.wordAt(i)
    return w && (UNITS as readonly string[]).includes(w) ? [w as Unit, i + 1] : null
  }
  which(i: number): Match<Which> | null {
    const w = this.wordAt(i)
    if (w === "this") return ["this", i + 1]
    if (w === "last" || w === "previous") return ["last", i + 1]
    if (w === "next") return ["next", i + 1]
    return null
  }
  year(i: number): Match<number> | null {
    const tok = this.t[i]
    if (tok?.k === "num" && tok.raw.length === 4 && tok.v >= 1970 && tok.v <= 2099)
      return [tok.v, i + 1]
    if (tok?.k === "shortyear") return [tok.y, i + 1]
    return null
  }
  dayNum(i: number): Match<number> | null {
    const tok = this.t[i]
    if ((tok?.k === "num" && tok.raw.length <= 2) || tok?.k === "ord")
      return tok.v >= 1 && tok.v <= 31 ? [tok.v, i + 1] : null
    return null
  }

  /** Points: anything that denotes one period. */
  point(i: number): Match<Point>[] {
    const out: Match<Point>[] = []
    for (const [d, j] of this.dayPoint(i)) {
      out.push([d, j])
      // day + part of day / clock: "yesterday afternoon", "friday 5pm"
      for (const [tod, k] of this.timeOfDay(j)) out.push([combine(d, tod), k])
    }
    // clock/part + day: "6pm yesterday"; clock or part alone means today
    for (const [tod, j] of this.timeOfDay(i)) {
      for (const [d, k] of this.dayPoint(j)) out.push([combine(d, tod), k])
      out.push([combine((ctx) => dayIv(ctx.today), tod), j])
    }
    out.push(...this.relative(i), ...this.monthLike(i), ...this.fiscalLike(i), ...this.yearLike(i))
    return out
  }

  timeOfDay(i: number): Match<[number, number, boolean]>[] {
    const tok = this.t[i]
    if (tok?.k === "clock") return [[[tok.h, tok.h + 1, true], i + 1]]
    if (tok?.k === "num" && tok.v >= 1 && tok.v <= 12 && this.word(i + 1, "am", "pm")) {
      const h = (tok.v % 12) + (this.wordAt(i + 1) === "pm" ? 12 : 0)
      return [[[h, h + 1, true], i + 2]]
    }
    const w = this.wordAt(i)
    if (w === "noon") return [[[12, 13, true], i + 1]]
    if (w === "midnight") return [[[0, 1, true], i + 1]]
    if (w && PARTS[w]) return [[[PARTS[w][0], PARTS[w][1], false], i + 1]]
    return []
  }

  dayPoint(i: number): Match<Point>[] {
    const out: Match<Point>[] = []
    const w = this.wordAt(i)
    if (w === "today") out.push([(c) => dayIv(c.today), i + 1])
    if (w === "yesterday") out.push([(c) => dayIv(c.today - 1), i + 1])
    if (w === "tomorrow") out.push([(c) => dayIv(c.today + 1), i + 1])

    // weekdays: "monday", "last tue", "this thursday", "next fri"
    const wh = this.which(i)
    const wi = wh ? wh[1] : i
    const wd = this.wordAt(wi)
    if (wd && WEEKDAYS[wd] !== undefined) {
      const dow = WEEKDAYS[wd]!
      const which = wh?.[0]
      out.push([
        (c, notAfter) => {
          if (!which) return dayIv(lastDow(notAfter, dow))
          if (which === "last") return dayIv(lastDow(c.today - 1, dow))
          if (which === "this")
            return dayIv(weekStart(c.today, c.p) + ((dow - c.p.weekStartsOn + 7) % 7))
          return dayIv(c.today + 1 + ((dow - ymd(c.today + 1).dow + 7) % 7))
        },
        wi + 1,
      ])
    }

    // dates
    const tok = this.t[i]
    if (tok?.k === "iso" && validDate(tok.y, tok.m, tok.d))
      out.push([() => dayIv(dayOf(tok.y, tok.m, tok.d)), i + 1])
    if (tok?.k === "numdate") {
      out.push([
        (c, notAfter) => {
          let [d, m] = c.p.dayFirst ? [tok.a, tok.b] : [tok.b, tok.a]
          if (m > 12 && d <= 12) [d, m] = [m, d]
          return dateDay(d, m, tok.y, notAfter)
        },
        i + 1,
      ])
    }
    // "3 oct", "3rd october 2025", "oct 3", "october 3rd 2025"
    const dn = this.dayNum(i)
    const mAfter = dn && MONTHS[this.wordAt(dn[1]) ?? ""]
    if (dn && mAfter) {
      const yr = this.year(dn[1] + 1)
      out.push([(_, na) => dateDay(dn[0], mAfter, undefined, na), dn[1] + 1])
      if (yr) out.push([(_, na) => dateDay(dn[0], mAfter, yr[0], na), yr[1]])
    }
    const mBefore = MONTHS[w ?? ""]
    const dn2 = mBefore ? this.dayNum(i + 1) : null
    if (mBefore && dn2) {
      out.push([(_, na) => dateDay(dn2[0], mBefore, undefined, na), dn2[1]])
      const yr = this.year(dn2[1])
      if (yr) out.push([(_, na) => dateDay(dn2[0], mBefore, yr[0], na), yr[1]])
    }
    // "the 15th": the most recent 15th on or before notAfter
    if (tok?.k === "ord" && tok.v <= 31) {
      out.push([
        (_, notAfter) => {
          let ms = monthStartOf(notAfter)
          for (let k = 0; k < 13; k++, ms = addMonths(ms, -1)) {
            const { y, m } = ymd(ms)
            if (validDate(y, m, tok.v) && dayOf(y, m, tok.v) <= notAfter)
              return dayIv(dayOf(y, m, tok.v))
          }
          return null
        },
        i + 1,
      ])
    }
    return out
  }

  relative(i: number): Match<Point>[] {
    const out: Match<Point>[] = []
    const w = this.wordAt(i)
    if (w === "tonight") out.push([(c) => partOf(c.today, 21, 30), i + 1])
    if (w === "recent" || w === "recently" || w === "lately")
      out.push([(c) => rolling("day", c.p.recentDays, c), i + 1])
    if (w === "ytd")
      out.push([
        (c) => ({ from: dayOf(ymd(c.today).y, 1, 1) * DAY, to: (c.today + 1) * DAY, g: "day" }),
        i + 1,
      ])

    // "this morning", "last night", "this evening"
    const wh = this.which(i)
    if (wh) {
      const part = this.wordAt(wh[1])
      if (part && PARTS[part] && wh[0] !== "next") {
        const [a, b] = PARTS[part]!
        out.push([(c) => partOf(wh[0] === "this" ? c.today : c.today - 1, a, b), wh[1] + 1])
      }
    }

    // "last week", "this quarter", "past week", "next year"
    const isPast = w === "past"
    if (wh || isPast) {
      const j = wh ? wh[1] : i + 1
      const u = this.unit(j)
      if (u) {
        const [unit] = u
        out.push([
          (c) => {
            if (isPast || unit === "hour") {
              if (wh?.[0] === "next") return null
              if (wh?.[0] === "this" && unit === "hour")
                return {
                  from: Math.floor(c.refL / HOUR) * HOUR,
                  to: Math.floor(c.refL / HOUR) * HOUR + HOUR,
                  g: "hour",
                }
              return rolling(unit, 1, c)
            }
            const n = wh?.[0] === "this" ? 0 : wh?.[0] === "last" ? -1 : 1
            return unitPeriod(unit, shift(unit, c.today, n), c)
          },
          u[1],
        ])
      }
      // "last 2 weeks", "past 48 hours"
      if (w === "last" || w === "past" || w === "previous") {
        const n = this.number(i + 1)
        const u2 = n && this.unit(n[1])
        if (n && u2) out.push([(c) => rolling(u2[0], n[0], c), u2[1]])
      }
    }

    // "3 days ago", "a couple days ago", "6mos ago"
    const n = this.number(i)
    if (n) {
      const u = this.unit(n[1])
      if (u && this.word(u[1], "ago")) {
        out.push([
          (c) => {
            if (u[0] === "minute") return null
            if (u[0] === "hour") {
              const h = Math.floor((c.refL - n[0] * HOUR) / HOUR) * HOUR
              return { from: h, to: h + HOUR, g: "hour" }
            }
            return unitPeriod(u[0], shift(u[0], c.today, -n[0]), c)
          },
          u[1] + 1,
        ])
      }
    }

    // "(the) week before last"
    if (w === "week" && this.word(i + 1, "before") && this.word(i + 2, "last"))
      out.push([(c) => unitPeriod("week", c.today - 14, c), i + 3])

    // weekends
    const wi = wh ? wh[1] : i
    if (this.word(wi, "weekend")) {
      const which = wh?.[0]
      out.push([
        (c) => {
          let sat: Day
          if (which === "this") sat = weekStart(c.today, c.p) + ((6 - c.p.weekStartsOn + 7) % 7)
          else if (which === "next") sat = c.today + 1 + ((6 - ymd(c.today + 1).dow + 7) % 7)
          else if (which === "last") sat = lastDow(c.today - 2, 6)
          else sat = lastDow(c.today, 6)
          return { from: sat * DAY, to: (sat + 2) * DAY, g: "day" }
        },
        wi + 1,
      ])
    }
    return out
  }

  monthLike(i: number): Match<Point>[] {
    const out: Match<Point>[] = []
    const wh = this.which(i)
    const j = wh ? wh[1] : i
    const mo = MONTHS[this.wordAt(j) ?? ""]
    if (mo) {
      const yr = this.year(j + 1)
      if (yr && !wh) out.push([() => monthIv(yr[0], mo), yr[1]])
      // "sept last year", "march this year"
      const rel = !wh ? this.which(j + 1) : null
      if (rel && this.word(rel[1], "year")) {
        const dy = rel[0] === "last" ? -1 : rel[0] === "next" ? 1 : 0
        out.push([(c) => monthIv(ymd(c.today).y + dy, mo), rel[1] + 1])
      }
      out.push([(c, na) => pickPeriod(c, na, wh?.[0], (y) => dayOf(y, mo, 1), 1), j + 1])
    }
    // quarters: "q3", "q2 2025", "1q25", "first quarter", "last q2"
    const tok = this.t[j]
    let q: number | undefined
    let qy: number | undefined
    let k = j + 1
    if (tok?.k === "quarter") {
      q = tok.q
      qy = tok.y
    } else {
      const w = this.wordAt(j)
      const ord = w ? ORDINAL_WORDS[w] : tok?.k === "ord" ? tok.v : undefined
      if (ord && ord <= 4 && this.word(j + 1, "quarter")) {
        q = ord
        k = j + 2
      }
    }
    if (q) {
      const qq = q
      const yr = qy === undefined ? this.year(k) : null
      const y0 = qy ?? yr?.[0]
      if (y0 !== undefined && !wh) out.push([() => quarterIv(y0, qq), yr ? yr[1] : k])
      if (qy === undefined)
        out.push([(c, na) => pickPeriod(c, na, wh?.[0], (y) => dayOf(y, qq * 3 - 2, 1), 3), k])
    }
    return out
  }

  /** Fiscal years, quarters and halves: "fy24", "fy 22-23", "this fy", "q2 fy24", "h2 2024". */
  fiscalLike(i: number): Match<Point>[] {
    const out: Match<Point>[] = []
    const fyName = (n: number) => (n < 100 ? 2000 + n : n)
    // "fy" N ["-" M] → [end year, next index]
    const fyAt = (j: number): [number, number] | null => {
      if (!this.word(j, "fy")) return null
      const a = this.number(j + 1)
      if (!a) return null
      if (this.t[a[1]]?.k === "dash") {
        const b = this.number(a[1] + 1)
        if (!b || fyName(b[0]) !== fyName(a[0]) + 1) return null
        return [fyName(b[0]), b[1]]
      }
      return [fyName(a[0]), a[1]]
    }

    // "this fy", "last fy", "fy24", "fy 22-23"
    const wh = this.which(i)
    if (wh && this.word(wh[1], "fy")) {
      const dy = wh[0] === "last" ? -1 : wh[0] === "next" ? 1 : 0
      out.push([(c) => fiscalIv(c, fyContaining(c.today, c.p) + dy, 12, 1), wh[1] + 1])
    }
    const fy = fyAt(i)
    if (fy) out.push([(c) => fiscalIv(c, fy[0], 12, 1), fy[1]])

    // "q2 fy24", "fy25 q2"
    const tok = this.t[i]
    if (tok?.k === "quarter" && tok.y === undefined) {
      const f = fyAt(i + 1)
      if (f) out.push([(c) => fiscalIv(c, f[0], 3, tok.q), f[1]])
    }
    if (fy) {
      const q = this.t[fy[1]]
      if (q?.k === "quarter" && q.y === undefined)
        out.push([(c) => fiscalIv(c, fy[0], 3, q.q), fy[1] + 1])
    }

    // "h2 2024" (calendar), "h1 fy25" (fiscal), "h2" (most recent)
    if (this.word(i, "half")) {
      const h = this.number(i + 1)
      if (h && (h[0] === 1 || h[0] === 2)) {
        const half = h[0]
        const f = fyAt(h[1])
        const yr = this.year(h[1])
        if (f) out.push([(c) => fiscalIv(c, f[0], 6, half), f[1]])
        else if (yr) out.push([() => halfIv(yr[0], half), yr[1]])
        else
          out.push([
            (_, na) => {
              const y = ymd(na).y
              const start = dayOf(y, half === 1 ? 1 : 7, 1)
              return halfIv(start <= na ? y : y - 1, half)
            },
            h[1],
          ])
      }
    }
    return out
  }

  yearLike(i: number): Match<Point>[] {
    const yr = this.year(i)
    if (!yr) return []
    // A bare 4-digit number followed by a month word is a date, not a year; dayPoint handles it.
    return [
      [
        () => ({ from: dayOf(yr[0], 1, 1) * DAY, to: dayOf(yr[0] + 1, 1, 1) * DAY, g: "year" }),
        yr[1],
      ],
    ]
  }
}

function combine(d: Point, tod: [number, number, boolean]): Point {
  return (c, na) => {
    const iv = d(c, na)
    if (iv?.g !== "day" || iv.from === undefined) return null
    const day = iv.from / DAY
    const [a, b, clock] = tod
    return { ...partOf(day, a, b), ...(clock ? { clock: true } : {}) }
  }
}
const partOf = (day: Day, a: number, b: number): Interval => ({
  from: day * DAY + a * HOUR,
  to: day * DAY + b * HOUR,
  g: "hour",
})
function dateDay(d: number, m: number, y: number | undefined, notAfter: Day): Interval | null {
  if (y !== undefined) return validDate(y, m, d) ? dayIv(dayOf(y, m, d)) : null
  const ny = ymd(notAfter).y
  for (const yy of [ny, ny - 1, ny - 2, ny - 3, ny - 4]) {
    if (validDate(yy, m, d) && dayOf(yy, m, d) <= notAfter) return dayIv(dayOf(yy, m, d))
  }
  return null
}
const monthIv = (y: number, m: number): Interval => ({
  from: dayOf(y, m, 1) * DAY,
  to: dayOf(y, m + 1, 1) * DAY,
  g: "month",
})
const quarterIv = (y: number, q: number): Interval => ({
  from: dayOf(y, q * 3 - 2, 1) * DAY,
  to: dayOf(y, q * 3 + 1, 1) * DAY,
  g: "quarter",
})
const halfIv = (y: number, h: number): Interval => ({
  from: dayOf(y, h === 1 ? 1 : 7, 1) * DAY,
  to: dayOf(h === 1 ? y : y + 1, h === 1 ? 7 : 1, 1) * DAY,
  g: "half",
})
/** First day of the fiscal year named `end` (the year it ends in). */
const fyStart = (end: number, p: Policies): Day =>
  p.fiscalYearStartMonth === 1 ? dayOf(end, 1, 1) : dayOf(end - 1, p.fiscalYearStartMonth, 1)
const fyContaining = (day: Day, p: Policies): number => {
  const { y, m } = ymd(day)
  return p.fiscalYearStartMonth === 1 || m < p.fiscalYearStartMonth ? y : y + 1
}
/** Part `n` (1-based) of `months` months within fiscal year `end`; months = 12 is the whole year. */
function fiscalIv(c: Ctx, end: number, months: number, n: number): Interval | null {
  if (n < 1 || n * months > 12) return null
  const from = addMonths(fyStart(end, c.p), months * (n - 1))
  const g: Granularity = months === 12 ? "year" : months === 6 ? "half" : "quarter"
  return { from: from * DAY, to: addMonths(from, months) * DAY, g }
}

/** Months and quarters: bare = most recent started ≤ notAfter; last/this/next per POLICIES §7–8. */
function pickPeriod(
  c: Ctx,
  notAfter: Day,
  which: Which | undefined,
  startIn: (y: number) => Day,
  months: number,
): Interval | null {
  const g: Granularity = months === 1 ? "month" : "quarter"
  const iv = (s: Day): Interval => ({ from: s * DAY, to: addMonths(s, months) * DAY, g })
  const y0 = ymd(c.today).y
  const cur = months === 1 ? monthStartOf(c.today) : quarterStartOf(c.today)
  if (which === "this") return iv(startIn(y0))
  if (which === "next") {
    for (const y of [y0, y0 + 1]) if (startIn(y) > cur) return iv(startIn(y))
    return null
  }
  const limit = which === "last" ? cur - 1 : notAfter
  for (const y of [y0 + 1, y0, y0 - 1, y0 - 2]) {
    const s = startIn(y)
    if (s <= limit && (which !== "last" || addMonths(s, months) <= cur)) return iv(s)
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Top level

const OPS = ["before", "after", "since", "until", "by", "on", "in", "during", "from"] as const
type Op = (typeof OPS)[number]
const RANGE_SEPS = new Set(["and", "to", "through", "until"])

function applyOp(op: Op | undefined, iv: Interval): Interval {
  switch (op) {
    case "before":
      return { to: iv.from!, g: iv.g }
    case "after":
      return { from: iv.clock ? iv.from! : iv.to!, g: iv.g }
    case "since":
      return { from: iv.from!, g: iv.g }
    case "until":
    case "by":
      return { to: iv.clock ? iv.from! : iv.to!, g: iv.g }
    default:
      return iv
  }
}

const FINER: Granularity[] = ["hour", "day", "week", "month", "quarter", "half", "year"]

function parseTokens(tokens: Tok[], ctx: Ctx): Interval | null {
  const P = new Parser(tokens)
  const n = tokens.length
  const full = (ms: Match<Point>[], from: number) => ms.filter(([, j]) => j === n && from <= n)
  const results: Interval[] = []
  const resolve = (pt: Point, na = ctx.today) => pt(ctx, na)

  // "1-15 jan", "1st-15th march 2025": a day range inside one month
  {
    const a = P.dayNum(0)
    const b = a && tokens[a[1]]?.k === "dash" ? P.dayNum(a[1] + 1) : null
    const mo = b ? MONTHS[P.wordAt(b[1]) ?? ""] : undefined
    if (a && b && mo) {
      const yr = P.year(b[1] + 1)
      const end = yr ? yr[1] : b[1] + 1
      if (end === n) {
        const B = dateDay(b[0], mo, yr?.[0], ctx.today)
        const A =
          B?.from !== undefined ? dateDay(a[0], mo, ymd(B.from / DAY).y, B.from / DAY) : null
        if (A?.from !== undefined && B?.to !== undefined && A.from < B.to)
          return { from: A.from, to: B.to, g: "day" }
      }
    }
  }

  // ranges: [between|from] A (and|to|through|-|2) B
  const r0 = P.word(0, "between", "from") ? 1 : 0
  for (const [a, i] of P.point(r0)) {
    const sep = tokens[i]
    const isSep =
      (sep?.k === "word" && RANGE_SEPS.has(sep.v)) ||
      sep?.k === "dash" ||
      (sep?.k === "num" && sep.v === 2)
    if (!isSep) continue
    for (const [b] of full(P.point(i + 1), i + 1)) {
      const B = resolve(b)
      if (!B || B.from === undefined) continue
      const A = resolve(a, Math.floor(B.from / DAY))
      if (!A || A.from === undefined || A.from >= B.to!) continue
      const g = FINER[Math.min(FINER.indexOf(A.g), FINER.indexOf(B.g))]!
      results.push({ from: A.from, to: B.to!, g })
    }
  }
  if (results.length) return results[0]!

  // older than / newer than / within (the) (last|past) N unit
  if (P.word(0, "older", "newer") && P.word(1, "than")) {
    const num = P.number(2) ?? (P.unit(2) ? ([1, 2] as Match<number>) : null)
    const u = num && P.unit(num[1])
    if (num && u && u[1] === n) {
      const iv = rolling(u[0], num[0], ctx)
      if (!iv) return null
      return P.wordAt(0) === "older" ? { to: iv.from!, g: iv.g } : iv
    }
  }
  if (P.word(0, "within")) {
    const k = P.word(1, "last", "past") ? 2 : 1
    const num = P.number(k) ?? (P.unit(k) ? ([1, k] as Match<number>) : null)
    const u = num && P.unit(num[1])
    if (num && u && u[1] === n) return rolling(u[0], num[0], ctx)
  }

  // [op] point
  const op = OPS.find((o) => P.word(0, o))
  const opTwo = P.word(0, "prior") && P.word(1, "to")
  const start = opTwo ? 2 : op ? 1 : 0
  for (const [pt] of full(P.point(start), start)) {
    const iv = resolve(pt)
    if (iv) return applyOp(opTwo ? "before" : op, iv)
  }
  return null
}

/** Unknown words: maybe a product anchor ("before the offsite", "last sprint"). */
function parseAnchor(text: string, anchors: Anchors | undefined): Interval | null {
  if (!anchors) return null
  let s = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/(\w)'s\b/g, "$1")
    .trim()
  let op: Op | undefined
  const first = s.split(/\s+/)[0] ?? ""
  const opWord = SYNONYMS[first] ?? (first === "b4" ? "before" : first)
  const opFixed = fixWord(opWord)[0]
  if ((OPS as readonly string[]).includes(opFixed ?? "")) {
    op = opFixed as Op
    s = s.slice(first.length).trim()
  }
  s = s.replace(/^the\s+/, "")
  let which: Which | undefined
  const m = s.match(/^(this|last|previous|next)\s+(.+)$/)
  if (m) {
    which = m[1] === "previous" ? "last" : (m[1] as Which)
    s = m[2]!
  }
  const r = anchors(s, which)
  if (!r) return null
  const iv: Interval = {
    ...(r.from ? { from: Date.parse(`${r.from}T00:00Z`) } : {}),
    ...(r.to ? { to: Date.parse(`${r.to}T00:00Z`) } : {}),
    g: "day",
  }
  if (
    (op === "before" && iv.from === undefined) ||
    ((op === "after" || op === "until" || op === "by") && iv.to === undefined)
  )
    return null
  return applyOp(op, iv)
}

export function normalizeTime(text: string, opts: Options): TimeResult {
  const p = { ...DEFAULTS, ...opts.policies }
  const refL = toLocal(Date.parse(opts.reference), opts.timeZone)
  const ctx: Ctx = { refL, today: Math.floor(refL / DAY), p }
  const tokens = tokenize(text)
  const iv = (tokens.length ? parseTokens(tokens, ctx) : null) ?? parseAnchor(text, opts.anchors)
  if (!iv) return { ok: false, reason: "no rule matched" }
  const out: TimeResult = { ok: true, granularity: iv.g, local: {} }
  if (iv.from !== undefined) {
    out.from = new Date(toInstant(iv.from, opts.timeZone)).toISOString()
    out.local.from = fmt(iv.from)
  }
  if (iv.to !== undefined) {
    out.to = new Date(toInstant(iv.to, opts.timeZone)).toISOString()
    out.local.to = fmt(iv.to)
  }
  return out
}
