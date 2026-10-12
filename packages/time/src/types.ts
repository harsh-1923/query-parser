// Public types for @qp/time.

export type Granularity = "hour" | "day" | "week" | "month" | "quarter" | "half" | "year"
export type Which = "this" | "last" | "next"

export interface Policies {
  weekStartsOn: number // 0 = Sunday … 6 = Saturday
  dayFirst: boolean
  recentDays: number
  /** Month the fiscal year starts, 1–12 (India: 4). Fiscal years are named by the year they end in. */
  fiscalYearStartMonth: number
}

/** Product-supplied named periods. Returns local civil dates "YYYY-MM-DD" (end exclusive). */
export type Anchors = (
  name: string,
  which: Which | undefined,
) => { from?: string; to?: string } | undefined

export interface Options {
  reference: string // ISO instant
  timeZone: string
  policies?: Partial<Policies>
  anchors?: Anchors
}

export type TimeResult =
  | {
      ok: true
      from?: string // ISO instant
      to?: string
      granularity: Granularity
      local: { from?: string; to?: string } // "YYYY-MM-DDTHH:MM" in the zone, for debugging
    }
  | { ok: false; reason: string }
