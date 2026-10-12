import { describe, expect, it } from "vitest"
import { type RuleLexicon, ruleTagger } from "./ruleTagger"
import { tokenize } from "./tokenize"
import type { Label } from "./types"

const TIMES = new Set([
  "last week",
  "yesterday",
  "today",
  "before march",
  "march",
  "between 3 and 10 oct",
  "last 30 days",
  "from last week",
  "in march",
])

const lexicon: RuleLexicon = {
  kinds: [
    "pdf",
    "message",
    "chat",
    "file",
    "slide",
    "deck",
    "image",
    "bug",
    "story",
    "note",
    "say",
    "call",
    "doc",
  ],
  attrs: [
    "unread",
    "starred",
    "open",
    "with attachment",
    "high priority",
    "in review",
    "p1",
    "draft",
    "unassigned",
  ],
  isTime: (text) => TIMES.has(text.toLowerCase()),
}
const tagger = ruleTagger(lexicon)

/** Compact view: "ROLE:text" per span, in order. */
function spans(query: string): string[] {
  const tokens = tokenize(query)
  const { labels } = tagger.tag(tokens)
  const out: { role: string; words: string[] }[] = []
  labels.forEach((label, i) => {
    const text = tokens[i]?.text ?? ""
    if (label.startsWith("B-")) out.push({ role: label.slice(2), words: [text] })
    else if (label.startsWith("I-")) out[out.length - 1]?.words.push(text)
  })
  return out.map((s) => `${s.role}:${s.words.join(" ")}`)
}

function checkBio(labels: Label[]): void {
  labels.forEach((l, i) => {
    if (l.startsWith("I-")) {
      const prev = labels[i - 1]
      expect(prev === `B-${l.slice(2)}` || prev === l).toBe(true)
    }
  })
}

describe("ruleTagger", () => {
  it("reports version and confidence 1", () => {
    const r = tagger.tag(tokenize("pdfs from utkarsh"))
    expect(tagger.version).toBe("rules-0.1")
    expect(r.confidence).toEqual([1, 1, 1])
    expect(r.labels).toHaveLength(3)
  })

  it("PLAN §3 role examples", () => {
    expect(spans("pdfs from utkarsh")).toEqual(["KIND:pdfs", "ACTOR:utkarsh"])
    expect(spans("messages about rollout")).toEqual(["KIND:messages", "TOPIC:rollout"])
    expect(spans("what did neha say")).toEqual(["ACTOR:neha", "KIND:say"])
    expect(spans("by rahul")).toEqual(["ACTOR:rahul"])
    expect(spans("sent to neha")).toEqual(["RECIPIENT:neha"])
    expect(spans("calls with the infra team")).toEqual(["KIND:calls", "PARTICIPANT:the infra team"])
    expect(spans("where I was mentioned")).toEqual(["MENTION:I"])
    expect(spans("mentioning @rahul")).toEqual(["MENTION:@rahul"])
    expect(spans("in the design channel")).toEqual(["CONTAINER:design"])
    expect(spans("on the payments board")).toEqual(["CONTAINER:payments"])
    expect(spans("before march")).toEqual(["TIME:before march"])
    expect(spans("between 3 and 10 oct")).toEqual(["TIME:between 3 and 10 oct"])
    expect(spans("yesterday")).toEqual(["TIME:yesterday"])
    expect(spans("unread")).toEqual(["ATTR:unread"])
    expect(spans("with attachments")).toEqual(["ATTR:with attachments"])
    expect(spans("high priority")).toEqual(["ATTR:high priority"])
    expect(spans("latest pdfs")).toEqual(["ORDER:latest", "KIND:pdfs"])
    expect(spans("most recent call")).toEqual(["ORDER:most recent", "KIND:call"])
    expect(spans("except images")).toEqual(["NEG:except", "KIND:images"])
    expect(spans("not from linkedin or github")).toEqual([
      "NEG:not",
      "ACTOR:linkedin",
      "ACTOR:github",
    ])
  })

  it("combines roles in one query", () => {
    expect(spans("pdfs from utkarsh last week about sync engine")).toEqual([
      "KIND:pdfs",
      "ACTOR:utkarsh",
      "TIME:last week",
      "TOPIC:sync engine",
    ])
  })

  it("self words take their role from the governing word", () => {
    expect(spans("files I shared")).toEqual(["KIND:files", "ACTOR:I"])
    expect(spans("my slides")).toEqual(["ACTOR:my", "KIND:slides"])
    expect(spans("assigned to me")).toEqual(["RECIPIENT:me"])
    expect(spans("ankit sent me files")).toEqual(["ACTOR:ankit", "RECIPIENT:me", "KIND:files"])
    expect(spans("chats with me")).toEqual(["KIND:chats", "PARTICIPANT:me"])
    expect(spans("messages tagged me")).toEqual(["KIND:messages", "MENTION:me"])
    expect(spans("show me files")).toEqual(["KIND:files"])
  })

  it("chats, channels and possessives", () => {
    expect(spans("chats with ankit")).toEqual(["KIND:chats", "PARTICIPANT:ankit"])
    expect(spans("in #infra")).toEqual(["CONTAINER:#infra"])
    expect(spans("rahul's slides")).toEqual(["ACTOR:rahul", "KIND:slides"])
    expect(spans("unread messages from @sneha")).toEqual([
      "ATTR:unread",
      "KIND:messages",
      "ACTOR:@sneha",
    ])
  })

  it("keeps both names of an or-list as separate spans", () => {
    const tokens = tokenize("from ankit or neha")
    expect(tagger.tag(tokens).labels).toEqual(["O", "B-ACTOR", "O", "B-ACTOR"])
  })

  it("negation", () => {
    expect(tagger.tag(tokenize("not from rahul")).labels).toEqual(["B-NEG", "O", "B-ACTOR"])
  })

  it("typed operators are labeled O", () => {
    expect(tagger.tag(tokenize("reporter:priya type:bug")).labels).toEqual(["O", "O"])
    expect(spans("p1 bugs in payments assigned to me")).toEqual([
      "ATTR:p1",
      "KIND:bugs",
      "CONTAINER:payments",
      "RECIPIENT:me",
    ])
  })

  it("leftover content words become TOPIC, but time phrases do not", () => {
    expect(spans("new york office deck")).toEqual(["TOPIC:new york office", "KIND:deck"])
    expect(spans("payment retries")).toEqual(["TOPIC:payment retries"])
  })

  it("ATTR beats NEG and container for multi-word aliases", () => {
    expect(spans("bugs in review")).toEqual(["KIND:bugs", "ATTR:in review"])
    expect(spans("unassigned bugs")).toEqual(["ATTR:unassigned", "KIND:bugs"])
  })

  it("on without a container noun is a topic cue", () => {
    expect(spans("notes on sync engine")).toEqual(["KIND:notes", "TOPIC:sync engine"])
  })

  it("for is recipient only before a self word or handle", () => {
    expect(spans("files for me")).toEqual(["KIND:files", "RECIPIENT:me"])
    expect(spans("files for q3 planning")).toEqual(["KIND:files", "TOPIC:q3 planning"])
  })

  it("last/first are ORDER only before a KIND", () => {
    expect(spans("last pdf")).toEqual(["ORDER:last", "KIND:pdf"])
    expect(spans("last week")).toEqual(["TIME:last week"])
  })

  it("always emits a valid BIO sequence", () => {
    const queries = [
      "pdfs from utkarsh last week about sync engine",
      "not from linkedin or github, last 30 days",
      "calls with the infra team and ankit",
      "rahul sharma's old design notes on the payments board",
      "",
      "a b c d e f g",
    ]
    for (const q of queries) {
      const { labels } = tagger.tag(tokenize(q))
      checkBio(labels)
    }
  })
})
