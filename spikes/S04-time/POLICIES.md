# S04 time policies (the spec gold answers are labeled against)

Defaults from PLAN §5.6: `weekStartsOn = 1` (Monday), `dayFirst = true`, `bias = "past"`,
`recentDays = 7`.

Reference for the spike: **Monday 2026-10-12 15:30, Asia/Kolkata**. All times below are local.

Every answer is a half-open range `[from, to)` snapped to a granularity (`hour`, `day`, `week`,
`month`, `quarter`, `year`), with either end allowed to be open, or **none** when the phrase has no
definite meaning under these rules (vague, not a time, unknown anchor, or a fiscal calendar we don't
know).

## Periods

1. **Calendar periods.** "this week/month/quarter/year" is the whole current period (future part
   included). "last/previous X" without a number is the previous calendar period; "next X" the next.
   Weeks run Monday–Sunday.
2. **Rolling windows.** "last/past/previous N days|weeks|months|years", "past week" (N = 1),
   "within the last N X", "newer than N X": `[startOfDay(ref − N X) + 1 day, startOfTomorrow)`, day
   granularity. So "last 7 days" is today plus the 6 days before it. Hours: `[ref − N h, ref)`, hour
   granularity, **not** snapped to the hour ("last 24 hours" at 15:30 starts at 15:30 yesterday).
3. **"N X ago"**: the calendar X containing `ref − N X` ("3 days ago" = that day, "2 weeks ago" =
   that Monday–Sunday week). "a couple" = 2; "a few", "several" have no definite meaning.
4. **recent / recently / lately**: rolling `recentDays`. "just now", "the other day", "a while ago":
   none. "latest", "newest", "most recent" are ORDER, not time: none.
5. **"ytd"**: `[Jan 1 this year, startOfTomorrow)`.

## Named units

6. **Weekdays.** Bare or "on X": the most recent X on or before today (today counts). "last X": most
   recent X strictly before today. "this X": X in the current Monday–Sunday week. "next X": first X
   strictly after today. "weekend": Saturday–Sunday; "last weekend" = the most recent completed one.
7. **Months.** Bare or "in X": the most recent X that started on or before today (current month
   counts). "last X": the most recent X that ended before the current month. "this X": X of this year.
   "next X": next X after the current month.
8. **Quarters.** "qN"/"Nq" bare: the most recent QN that started on or before today. "first
   quarter" = q1. Fiscal quarters/years ("FY25 Q2"): none (fiscal start is product-specific).
9. **Years.** "2025", "'24" (= 2024).
10. **Day dates without a year** ("3 oct", "the 15th"): most recent occurrence on or before today.
    `d/m` order follows `dayFirst`; if that reading is impossible (month > 12) and the swapped one is
    valid, use the swapped one. Dots work like slashes. Two-digit years are 20xx.
11. **Parts of day.** morning `[06, 12)`, afternoon `[12, 17)`, evening `[17, 21)`, night
    `[21, 06 next day)`. "tonight" = today's night, "last night" = yesterday's night. Clock times
    ("3pm", "2am", "noon") are hour granularity. A day without a clock time defaults to today
    ("before 8am" = today). "early/mid/late/end of X", "around X": none.

## Operators (X, A, B are any of the above)

12. `before X` → `[–, X.from)`. `after X` → `[X.to, –)` for periods, `[X.from, –)` for clock times.
    `since X` → `[X.from, –)`. `until/till/til/by X` → `[–, X.to)` for periods, `[–, X.from)` for
    clock times. `on/in/during/from X` alone → X. `older than N X` → `[–, from of "last N X")`.
13. **Ranges.** "between A and B", "from A to B", "A to/through/- B" → `[A.from, B.to)`. Resolve B
    first with the past bias, then A as its most recent occurrence on or before B ("between the 1st
    and 15th" on 12 Oct = 1–15 Sep). If A ends up after B: none.

## Anchors (the spike's stand-in for a product's `time.anchors`)

| Name | Range |
|---|---|
| this sprint | 2026-10-05 – 2026-10-19 |
| last sprint | 2026-09-21 – 2026-10-05 |
| sprint 14 | 2026-07-13 – 2026-07-27 |
| offsite | 2026-09-15 – 2026-09-18 |
| release 4.2.1 (also "last release", "4.2.1") | 2026-08-20 – 2026-08-21 |
| launch | 2026-09-01 – 2026-09-02 |
| code freeze | 2026-09-28 – 2026-10-02 |

Ranges are `[from, to)` in days. Anything else that names an event (diwali, the reorg, the audit,
v2.3, "the sprint before last") has no anchor: none.

## Not in v1

Minutes ("15 minutes ago") are finer than any granularity: none. Hinglish ("kal", "pichle mahine") isn't supported yet (PLAN §16 Q2). Gold still records the meaning
where it is unambiguous, so an `unsupported` answer counts as a coverage miss, not a wrong answer.
"kal" (yesterday or tomorrow) has none.
