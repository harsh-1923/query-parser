// Time-phrase grammar. Every phrase is checked against normalizeTime before it is used, so the
// TIME label always means something @qp/time understands. Operators are part of the phrase
// (annotation guideline: TIME includes before/after/since/between ...).
import { normalizeTime } from "@qp/time"
import { chance, int, pick, type Rng, shuffle, weighted } from "./rng"

export const REFERENCE = "2026-10-12T10:00:00Z"
export const TIME_ZONE = "Asia/Kolkata"

const cache = new Map<string, boolean>()
export function isTime(text: string): boolean {
  let ok = cache.get(text)
  if (ok === undefined) {
    ok = normalizeTime(text, { reference: REFERENCE, timeZone: TIME_ZONE }).ok === true
    cache.set(text, ok)
  }
  return ok
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const DAYS_SHORT = ["mon", "tue", "wed", "thu", "fri"]
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]
const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const OPS = ["on", "since", "before", "after", "until", "by", "from"]
const PERIOD_OPS = ["in", "during", "since", "before", "after", "until", "by", "from"]
const YEARS = ["2024", "2025", "2026"]
const STANDALONE = [
  "today",
  "yesterday",
  "this week",
  "last week",
  "this month",
  "last month",
  "this year",
  "last year",
  "this quarter",
  "last quarter",
  "last weekend",
  "this morning",
  "last night",
  "yesterday morning",
  "yesterday evening",
  "recently",
  "this sprint",
]
const OP_RELATIVE = [
  "today",
  "yesterday",
  "this week",
  "last week",
  "this month",
  "last month",
  "last year",
  "last quarter",
  "last friday",
  "last monday",
]

const dayNum = (rng: Rng): number => 1 + int(rng, 28)
const ordinal = (n: number): string => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")
  return n % 10 > 3 ? `${n}th` : `${n}${s}`
}

function dateText(rng: Rng): string {
  const d = dayNum(rng)
  const m = int(rng, 12)
  const mon = chance(rng, 0.5) ? (MONTHS[m] as string) : (MONTHS_SHORT[m % 11] as string)
  const year = chance(rng, 0.3) ? ` ${pick(rng, YEARS)}` : ""
  const day = chance(rng, 0.3) ? ordinal(d) : String(d)
  switch (int(rng, 6)) {
    case 0:
      return `${day} ${mon}${year}`
    case 1:
      return `${mon} ${day}${year}`
    case 2:
      return `${pick(rng, YEARS)}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    case 3:
      return `${d}/${m + 1}${chance(rng, 0.5) ? `/${pick(rng, YEARS)}` : ""}`
    case 4:
      return `${day} ${mon}`
    default:
      return `${mon} ${day}`
  }
}

const unitCount = (rng: Rng): string => {
  const unit = weighted(rng, [
    ["day", 5],
    ["week", 3],
    ["month", 2],
  ] as const)
  const n = pick(
    rng,
    unit === "day"
      ? [2, 3, 5, 7, 10, 14, 30, 60, 90]
      : unit === "week"
        ? [2, 3, 4, 6]
        : [2, 3, 6, 9],
  )
  return `${n} ${unit}s`
}

type Family = (rng: Rng) => string

const FAMILIES: [string, number, Family][] = [
  ["standalone", 14, (r) => pick(r, STANDALONE)],
  ["last-n", 6, (r) => `${pick(r, ["last", "past"])} ${unitCount(r)}`],
  ["ago", 3, (r) => `${unitCount(r)} ago`],
  [
    "op-relative",
    8,
    (r) =>
      `${pick(r, ["since", "before", "after", "until", "from", "by", "during"])} ${pick(r, OP_RELATIVE)}`,
  ],
  [
    "weekday",
    6,
    (r) =>
      `${weighted(r, [
        ["on", 3],
        ["since", 1],
        ["before", 1],
        ["after", 1],
        ["until", 1],
        ["by", 1],
        ["last", 2],
        ["this", 1],
        ["", 1],
      ] as const)} ${pick(r, r() < 0.8 ? DAYS : DAYS_SHORT)}`.trim(),
  ],
  [
    "month",
    8,
    (r) => `${pick(r, PERIOD_OPS)} ${pick(r, MONTHS)}${chance(r, 0.3) ? ` ${pick(r, YEARS)}` : ""}`,
  ],
  [
    "quarter",
    4,
    (r) =>
      `${chance(r, 0.7) ? `${pick(r, PERIOD_OPS)} ` : ""}q${1 + int(r, 4)}${chance(r, 0.3) ? ` ${pick(r, YEARS)}` : ""}`,
  ],
  ["year", 2, (r) => `${pick(r, ["in", "since", "before", "during"])} ${pick(r, YEARS)}`],
  ["date", 14, (r) => `${chance(r, 0.25) ? "" : `${pick(r, OPS)} `}${dateText(r)}`],
  [
    "between",
    4,
    (r) => {
      const k = int(r, 4)
      if (k === 0) return `between ${dateText(r)} and ${dateText(r)}`
      if (k === 1) return `between ${pick(r, MONTHS)} and ${pick(r, MONTHS)}`
      if (k === 2) return `between ${pick(r, DAYS)} and ${pick(r, DAYS)}`
      return `between ${ordinal(dayNum(r))} and ${ordinal(dayNum(r))}`
    },
  ],
  [
    "from-to",
    3,
    (r) => {
      const k = int(r, 3)
      if (k === 0) return `from ${dateText(r)} to ${dateText(r)}`
      if (k === 1) return `from ${pick(r, MONTHS)} to ${pick(r, MONTHS)}`
      return `from ${pick(r, DAYS)} to ${pick(r, DAYS)}`
    },
  ],
  [
    "clock",
    4,
    (r) => {
      const h = `${1 + int(r, 12)}${pick(r, ["am", "pm"])}`
      const k = int(r, 4)
      if (k === 0) return `yesterday ${h}`
      if (k === 1) return `today at ${h}`
      if (k === 2) return `${pick(r, ["after", "before"])} ${h}`
      return `${pick(r, ["yesterday", "today", "last friday"])} ${pick(r, ["morning", "afternoon", "evening"])}`
    },
  ],
  [
    "duration",
    4,
    (r) => {
      const k = int(r, 4)
      if (k === 0) return `older than ${unitCount(r)}`
      if (k === 1) return `within the last ${pick(r, ["week", "month", "year", unitCount(r)])}`
      if (k === 2) return `within ${unitCount(r)}`
      return `in the ${pick(r, ["last", "past"])} ${pick(r, ["week", "month", "year", unitCount(r)])}`
    },
  ],
]

export interface TimeGen {
  next(rng: Rng): string | undefined
  /** Phrases the grammar produced that normalizeTime rejected. */
  rejected: number
}

/** Round-robins over families, then samples within the family; rejects what @qp/time cannot parse. */
export function createTimeGen(seedRng: Rng): TimeGen {
  let cursor = 0
  const unshuffled: number[] = []
  FAMILIES.forEach(([, weight], i) => {
    for (let k = 0; k < weight; k++) unshuffled.push(i)
  })
  const schedule = shuffle(seedRng, unshuffled)
  const gen: TimeGen = {
    rejected: 0,
    next(rng) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const family = FAMILIES[schedule[cursor++ % schedule.length] as number]
        const text = (family as [string, number, Family])[2](rng)
        if (isTime(text)) return text
        gen.rejected++
      }
      return undefined
    },
  }
  return gen
}
