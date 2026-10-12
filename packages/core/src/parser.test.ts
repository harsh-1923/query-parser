import { describe, expect, it } from "vitest"
import { createParser } from "./parser"
import { defineSchema, facet } from "./schema"
import type { Candidate, EntitySource, Label, Tagger } from "./types"

/** Tags tokens from a hint written as "pdfs/KIND from utkarsh/ACTOR last/TIME week/TIME". */
function stubTagger(hints: Record<string, string>): Tagger {
  return {
    version: "stub",
    tag(tokens) {
      const query = tokens.map((t) => t.text).join(" ")
      const hint = hints[query]
      if (!hint) throw new Error(`no hint for "${query}"`)
      const roles = hint.split(" ").map((w) => w.split("/")[1])
      const labels = roles.map((r, i): Label => {
        if (!r) return "O"
        return (roles[i - 1] === r ? `I-${r}` : `B-${r}`) as Label
      })
      return { labels, confidence: labels.map(() => 1) }
    },
  }
}

const people = [
  { id: "u_utk", name: "Utkarsh Sharma" },
  { id: "u_rs", name: "Rahul Sharma" },
  { id: "u_rv", name: "Rahul Verma" },
  { id: "u_neha", name: "Neha Gupta" },
  { id: "u_me", name: "Harsh" },
]
const person: EntitySource = (span, ctx) => {
  const t = span.text.toLowerCase()
  if (["i", "me", "my"].includes(t))
    return ctx.self ? [{ id: ctx.self, label: "me", score: 1 }] : []
  return people
    .filter((p) => p.name.toLowerCase().split(" ").includes(t))
    .map((p): Candidate => ({ id: p.id, label: p.name, score: 0.95 }))
}
const channel: EntitySource = (span) =>
  span.text === "#infra" ? [{ id: "c_infra", label: "#infra", score: 1 }] : []

const schema = defineSchema({
  kinds: {
    file: { aliases: ["file", "doc"] },
    pdf: { aliases: ["pdf"], parent: "file" },
    message: { aliases: ["message", "msg"] },
    ticket: { aliases: ["ticket", "bug"] },
  },
  attrs: {
    unread: { aliases: ["unread"], set: { facet: "unread", value: true } },
    high: { aliases: ["p1", "high priority"], set: { facet: "priority", value: "high" } },
  },
  facets: {
    type: facet.kind(),
    from: facet.entity({ role: "ACTOR", source: "person", multi: "or" }),
    createdBy: facet.entity({ role: "ACTOR", source: "person", when: { kind: ["ticket"] } }),
    editedBy: facet.entity({ role: "ACTOR", source: "person", cue: ["edited", "modified"] }),
    in: facet.entity({ role: "CONTAINER", source: "channel" }),
    date: facet.time(),
    unread: facet.flag(),
    priority: facet.enum({ values: ["high", "low"] }),
    sort: facet.order(),
  },
  operators: { from: "from", type: "type" },
})

const hints = {
  "pdfs from utkarsh last week about sync engine":
    "pdfs/KIND from utkarsh/ACTOR last/TIME week/TIME about sync/TOPIC engine/TOPIC",
  "bugs from utkarsh": "bugs/KIND from utkarsh/ACTOR",
  "files modified yesterday by neha": "files/KIND modified yesterday/TIME by neha/ACTOR",
  "messages from rahul": "messages/KIND from rahul/ACTOR",
  "not from utkarsh or neha": "not/NEG from utkarsh/ACTOR or neha/ACTOR",
  "my unread messages in #infra": "my/ACTOR unread/ATTR messages/KIND in #infra/CONTAINER",
  "p1 bugs": "p1/ATTR bugs/KIND",
  "latest pdfs": "latest/ORDER pdfs/KIND",
  "pdfs from zed": "pdfs/KIND from zed/ACTOR",
  "notes from kal": "notes/KIND from kal/TIME",
  "from:utkarsh type:pdf budget": "from:utkarsh type:pdf budget/TOPIC",
  "excluding test merchants": "excluding/NEG test/TOPIC merchants/TOPIC",
}

const parser = createParser({ schema, tagger: stubTagger(hints), sources: { person, channel } })
const opts = { reference: "2026-10-12T10:00:00.000Z", timeZone: "Asia/Kolkata", self: "u_me" }
const parse = (q: string) => parser.parseSync(q, opts)

describe("createParser", () => {
  it("parses the plan's headline example", () => {
    const r = parse("pdfs from utkarsh last week about sync engine")
    expect(r.filters).toEqual({
      type: ["pdf"],
      from: ["u_utk"],
      date: {
        from: "2026-10-04T18:30:00.000Z",
        to: "2026-10-11T18:30:00.000Z",
        granularity: "week",
      },
    })
    expect(r.text).toBe("sync engine")
    expect(r.issues).toEqual([])
    expect(r.spans.map((s) => [s.role, s.text, s.start, s.end])).toEqual([
      ["KIND", "pdfs", 0, 4],
      ["ACTOR", "utkarsh", 10, 17],
      ["TIME", "last week", 18, 27],
      ["TOPIC", "sync engine", 34, 45],
    ])
  })

  it("binds by kind (when) and by cue", () => {
    expect(parse("bugs from utkarsh").filters).toMatchObject({ createdBy: ["u_utk"] })
    const r = parse("files modified yesterday by neha")
    expect(r.filters).toMatchObject({ editedBy: ["u_neha"] })
    expect(r.spans.find((s) => s.role === "ACTOR")?.cue).toBe("modified")
  })

  it("reports ambiguity instead of guessing", () => {
    const r = parse("messages from rahul")
    expect(r.filters.from).toBeUndefined()
    expect(r.issues[0]).toMatchObject({ kind: "ambiguous" })
  })

  it("negates an or-list", () => {
    const r = parse("not from utkarsh or neha")
    expect(r.exclude).toEqual({ from: ["u_utk", "u_neha"] })
    expect(r.filters).toEqual({})
  })

  it("resolves self, flags and containers", () => {
    expect(parse("my unread messages in #infra").filters).toEqual({
      from: ["u_me"],
      unread: true,
      type: ["message"],
      in: ["c_infra"],
    })
  })

  it("maps attrs onto enum facets and order onto sort", () => {
    expect(parse("p1 bugs").filters).toMatchObject({ priority: ["high"], type: ["ticket"] })
    const r = parse("latest pdfs")
    expect(r.order).toEqual({ by: "recency", dir: "desc" })
  })

  it("falls back to text for unresolved names and unsupported times", () => {
    const r = parse("pdfs from zed")
    expect(r.text).toBe("zed")
    expect(r.issues).toMatchObject([{ kind: "unresolved", fallback: "text" }])
    const t = parse("notes from kal")
    expect(t.issues.some((i) => i.kind === "unsupported")).toBe(true)
    expect(t.text).toContain("kal")
  })

  it("binds typed operators without the tagger", () => {
    const r = parse("from:utkarsh type:pdf budget")
    expect(r.filters).toMatchObject({ from: ["u_utk"], type: ["pdf"] })
    expect(r.text).toBe("budget")
    expect(r.spans.every((s) => r.query.slice(s.start, s.end) === s.text)).toBe(true)
  })

  it("collects negated topics", () => {
    expect(parse("excluding test merchants").excludeText).toEqual(["test merchants"])
  })

  it("is deterministic", () => {
    const a = { ...parse("pdfs from utkarsh last week about sync engine"), meta: null }
    const b = { ...parse("pdfs from utkarsh last week about sync engine"), meta: null }
    expect(a).toEqual(b)
  })

  it("supports async sources through parse()", async () => {
    const p = createParser({
      schema,
      tagger: stubTagger(hints),
      sources: { person: async (s, c) => person(s, c), channel },
    })
    const r = await p.parse("bugs from utkarsh", opts)
    expect(r.filters).toMatchObject({ createdBy: ["u_utk"] })
    expect(() => p.parseSync("bugs from utkarsh", opts)).toThrow(/promise/)
  })
})
