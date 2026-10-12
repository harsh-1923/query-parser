import { createParser, directorySource, ruleTaggerFor } from "@qp/core"
import { describe, expect, it } from "vitest"
import { schema, toSearchParams } from "./index"

const people = [
  { id: "u_utk", name: "Utkarsh Sharma", handle: "utkarsh.s" },
  { id: "u_rv", name: "Rahul Verma", handle: "rahul.v" },
  { id: "u_rn", name: "Rahul Nair", handle: "rahul.n" },
  { id: "u_neha", name: "Neha Kulkarni", handle: "neha" },
  { id: "u_me", name: "Priya Iyer", handle: "priya" },
]
const channels = [
  { id: "c_infra", name: "#infra" },
  { id: "c_pay", name: "#payments-ops" },
]
const parser = createParser({
  schema,
  tagger: ruleTaggerFor(schema),
  sources: {
    person: directorySource(people, {
      fields: (p) => ({ id: p.id, label: p.name, aliases: [p.handle] }),
      self: "u_me",
    }),
    channel: directorySource(channels, {
      fields: (c) => ({ id: c.id, label: c.name, aliases: [c.name.slice(1)] }),
    }),
  },
})
const opts = { reference: "2026-10-12T10:00:00.000Z", timeZone: "Asia/Kolkata", self: "u_me" }
const params = (q: string) => Object.fromEntries(toSearchParams(parser.parseSync(q, opts)))

describe("xyne spaces adapter", () => {
  it("serializes the headline example", () => {
    expect(params("pdfs from utkarsh last week about sync engine")).toEqual({
      type: "files",
      from: "u_utk",
      after: "2026-10-04",
      before: "2026-10-12",
      q: "sync engine pdfs",
    })
  })

  it("maps ticket attributes and assignee", () => {
    expect(params("open p1 bugs assigned to me")).toMatchObject({
      type: "tickets",
      status: "TODO,STARTED,PAUSED",
      priority: "HIGH",
      assignee: "u_me",
    })
  })

  it("maps channels, order and typed operators", () => {
    expect(params("latest messages in #infra")).toMatchObject({
      type: "messages",
      in: "c_infra",
      orderBy: "newest",
    })
    expect(params("type:bug from:neha flaky test")).toMatchObject({
      type: "tickets",
      from: "u_neha",
    })
  })

  it("leaves ambiguous names out of the filters", () => {
    const r = parser.parseSync("messages from rahul", opts)
    expect(r.filters).not.toHaveProperty("from")
    expect(r.issues[0]?.kind).toBe("ambiguous")
  })
})
