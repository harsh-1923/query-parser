import { describe, expect, it } from "vitest"
import { tokenize } from "./tokenize"

const texts = (q: string) => tokenize(q).map((t) => t.text)

describe("tokenize", () => {
  it("splits on whitespace and punctuation with exact offsets", () => {
    const q = "pdfs from utkarsh, last week!"
    const tokens = tokenize(q)
    expect(tokens.map((t) => t.text)).toEqual(["pdfs", "from", "utkarsh", ",", "last", "week"])
    for (const t of tokens) expect(q.slice(t.start, t.end)).toBe(t.text)
  })

  it("keeps #channel and @handle as single tokens", () => {
    expect(texts("in #infra-alerts from @sneha.rao")).toEqual([
      "in",
      "#infra-alerts",
      "from",
      "@sneha.rao",
    ])
    expect(texts("#team_a.")).toEqual(["#team_a"])
  })

  it("splits possessive 's", () => {
    expect(texts("rahul's slides")).toEqual(["rahul", "'s", "slides"])
    expect(texts("rahul’s slides")).toEqual(["rahul", "’s", "slides"])
    expect(texts("@sneha's doc")).toEqual(["@sneha", "'s", "doc"])
  })

  it("keeps other contractions whole", () => {
    expect(texts("won't fix")).toEqual(["won't", "fix"])
  })

  it("keeps dates, versions and times as single tokens", () => {
    expect(texts("3/10 2026-10-03 4.2.1 1:1 2am 10:30 3rd")).toEqual([
      "3/10",
      "2026-10-03",
      "4.2.1",
      "1:1",
      "2am",
      "10:30",
      "3rd",
    ])
  })

  it("recognizes key:value operators", () => {
    const tokens = tokenize("reporter:priya type:bug")
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toMatchObject({
      text: "reporter:priya",
      operator: { key: "reporter", value: "priya" },
    })
    expect(tokens[1]?.operator).toEqual({ key: "type", value: "bug" })
  })

  it("recognizes quoted operator values as one token", () => {
    const q = 'label:"flaky test" bugs'
    const tokens = tokenize(q)
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toMatchObject({
      text: 'label:"flaky test"',
      operator: { key: "label", value: "flaky test" },
    })
    expect(q.slice(tokens[0]?.start, tokens[0]?.end)).toBe('label:"flaky test"')
  })

  it("keeps emails whole, also as operator values", () => {
    expect(texts("mail ana@lumen.de now")).toEqual(["mail", "ana@lumen.de", "now"])
    expect(tokenize("from:ana@lumen.de")[0]?.operator).toEqual({
      key: "from",
      value: "ana@lumen.de",
    })
  })

  it("does not treat times as operators", () => {
    for (const q of ["10:30", "1:1", "at 10:30am"]) {
      expect(tokenize(q).some((t) => t.operator)).toBe(false)
    }
  })

  it("strips trailing punctuation from operator values", () => {
    expect(tokenize("type:bug.")[0]).toMatchObject({ text: "type:bug", operator: { value: "bug" } })
  })

  it("is deterministic and returns [] for empty input", () => {
    expect(tokenize("")).toEqual([])
    expect(tokenize("   ")).toEqual([])
    expect(tokenize("a b")).toEqual(tokenize("a b"))
  })
})
