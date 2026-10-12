import { describe, expect, it } from "vitest"
import { normalizeTime } from "./index"
import type { Options } from "./types"

// Monday 2026-10-12 15:30 in Asia/Kolkata, the S04 reference.
const opts: Options = { reference: "2026-10-12T10:00:00.000Z", timeZone: "Asia/Kolkata" }
const local = (text: string, o: Partial<Options> = {}) => {
  const r = normalizeTime(text, { ...opts, ...o })
  return r.ok ? `${r.local.from ?? "–"} ${r.local.to ?? "–"} ${r.granularity}` : "unsupported"
}

describe("normalizeTime", () => {
  it.each([
    ["today", "2026-10-12T00:00 2026-10-13T00:00 day"],
    ["last week", "2026-10-05T00:00 2026-10-12T00:00 week"],
    ["past week", "2026-10-06T00:00 2026-10-13T00:00 day"],
    ["last 24 hours", "2026-10-11T15:30 2026-10-12T15:30 hour"],
    ["2 weeks ago", "2026-09-28T00:00 2026-10-05T00:00 week"],
    ["monday", "2026-10-12T00:00 2026-10-13T00:00 day"],
    ["last friday", "2026-10-09T00:00 2026-10-10T00:00 day"],
    ["next wed", "2026-10-14T00:00 2026-10-15T00:00 day"],
    ["march", "2026-03-01T00:00 2026-04-01T00:00 month"],
    ["last october", "2025-10-01T00:00 2025-11-01T00:00 month"],
    ["q4", "2026-10-01T00:00 2027-01-01T00:00 quarter"],
    ["3/10", "2026-10-03T00:00 2026-10-04T00:00 day"],
    ["12/25/2025", "2025-12-25T00:00 2025-12-26T00:00 day"],
    ["31 oct", "2025-10-31T00:00 2025-11-01T00:00 day"],
    ["the 21st", "2026-09-21T00:00 2026-09-22T00:00 day"],
    ["friday night", "2026-10-09T21:00 2026-10-10T06:00 hour"],
    ["before thurs", "– 2026-10-08T00:00 day"],
    ["by friday 5pm", "– 2026-10-09T17:00 hour"],
    ["since yesterday", "2026-10-11T00:00 – day"],
    ["older than 30 days", "– 2026-09-13T00:00 day"],
    ["between 1st and 15th", "2026-09-01T00:00 2026-09-16T00:00 day"],
    ["frm mon 2 fri", "2026-10-05T00:00 2026-10-10T00:00 day"],
    ["lastweek", "2026-10-05T00:00 2026-10-12T00:00 week"],
    ["yesterday's", "2026-10-11T00:00 2026-10-12T00:00 day"],
  ])("%s", (text, expected) => {
    expect(local(text)).toBe(expected)
  })

  it.each([
    "latest",
    "early march",
    "kal",
    "q2 fy24",
    "around 2 am",
    "before diwali",
    "15 minutes ago",
  ])("%s is unsupported, not guessed", (text) => {
    expect(local(text)).toBe("unsupported")
  })

  it("respects dayFirst", () => {
    expect(local("3/10", { policies: { dayFirst: false } })).toBe(
      "2026-03-10T00:00 2026-03-11T00:00 day",
    )
  })

  it("asks the product for anchors", () => {
    const anchors: Options["anchors"] = (name, which) =>
      name === "sprint" && which === "last" ? { from: "2026-09-21", to: "2026-10-05" } : undefined
    expect(local("since last sprint", { anchors })).toBe("2026-09-21T00:00 – day")
    expect(local("before the offsite", { anchors })).toBe("unsupported")
  })

  it("returns instants in the zone", () => {
    const r = normalizeTime("today", opts)
    expect(r.ok && r.from).toBe("2026-10-11T18:30:00.000Z")
  })
})
