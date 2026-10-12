import { describe, expect, it } from "vitest"
import { generate, serialize } from "./generate"
import { loadLexicons } from "./lexicons"
import { alignParaphrase, alignSpans, makeAlignContext, type ParaphraseRecord } from "./paraphrase"

const ctx = makeAlignContext(loadLexicons())

const record = (over: Partial<ParaphraseRecord>): ParaphraseRecord => ({
  line: 0,
  source: "template:kind_actor_topic",
  seed: 42,
  text: "pdfs from vasudev about billing",
  spans: [
    { role: "KIND", text: "pdfs" },
    { role: "ACTOR", text: "vasudev" },
    { role: "TOPIC", text: "billing" },
  ],
  paraphrase: "billing stuff vasudev sent, as pdfs",
  ...over,
})

const tagsOf = (r: ReturnType<typeof alignParaphrase>): string[] =>
  "example" in r ? r.example.tags : [`DROP:${r.reason}`]

describe("paraphrase aligner", () => {
  it("labels kept spans in any order and everything else O", () => {
    const out = alignParaphrase(record({}), ctx)
    expect("example" in out && out.example.tokens).toEqual([
      "billing",
      "stuff",
      "vasudev",
      "sent",
      ",",
      "as",
      "pdfs",
    ])
    expect(tagsOf(out)).toEqual(["B-TOPIC", "O", "B-ACTOR", "O", "O", "O", "B-KIND"])
  })

  it("matches case-insensitively and tags multi-token spans B/I", () => {
    const out = alignParaphrase(
      record({
        spans: [
          { role: "KIND", text: "pdfs" },
          { role: "TOPIC", text: "sync engine" },
        ],
        paraphrase: "Anything on the Sync Engine in PDFs?",
      }),
      ctx,
    )
    expect(tagsOf(out)).toEqual(["O", "O", "O", "B-TOPIC", "I-TOPIC", "O", "B-KIND"])
  })

  it("drops a record whose span is missing", () => {
    const out = alignParaphrase(record({ paraphrase: "billing pdfs please" }), ctx)
    expect(out).toEqual({ reason: "missing-span" })
  })

  it("drops a record where a span appears twice", () => {
    const out = alignParaphrase(
      record({ paraphrase: "pdfs from vasudev, billing, billing pdfs" }),
      ctx,
    )
    expect("reason" in out && out.reason).toBe("duplicate-span")
  })

  it("requires whole-token matches", () => {
    const out = alignParaphrase(record({ paraphrase: "pdfs from vasudevs about billing" }), ctx)
    expect(out).toEqual({ reason: "missing-span" })
  })

  it("drops a record when a span sits inside a longer span and nowhere else", () => {
    const out = alignSpans("budget sync", [
      { role: "TOPIC", text: "budget sync" },
      { role: "KIND", text: "sync" },
    ])
    expect(out).toEqual({ reason: "overlap" })
  })

  it("drops a record whose paraphrase adds a new kind, state, month or weekday", () => {
    for (const added of ["unread", "march", "friday", "spreadsheets", "in progress"]) {
      const out = alignParaphrase(
        record({ paraphrase: `${added} pdfs from vasudev about billing` }),
        ctx,
      )
      expect(out, added).toEqual({ reason: "new-constraint" })
    }
  })

  it("keeps a constraint word that was already in the original", () => {
    const out = alignParaphrase(
      record({
        text: "unread pdfs from vasudev about billing",
        spans: [
          { role: "ATTR", text: "unread" },
          { role: "KIND", text: "pdfs" },
          { role: "ACTOR", text: "vasudev" },
          { role: "TOPIC", text: "billing" },
        ],
        paraphrase: "billing pdfs vasudev sent that are unread",
      }),
      ctx,
    )
    expect("example" in out).toBe(true)
  })

  it("drops a record whose TIME span does not parse", () => {
    const out = alignParaphrase(
      record({
        text: "pdfs blorp",
        spans: [
          { role: "KIND", text: "pdfs" },
          { role: "TIME", text: "blorp" },
        ],
        paraphrase: "blorp pdfs",
      }),
      ctx,
    )
    expect(out).toEqual({ reason: "time-unparseable" })
  })

  it("labels pitch deck as TOPIC + KIND", () => {
    const out = alignSpans("the pitch deck", [{ role: "KIND", text: "pitch deck" }])
    expect("example" in out && out.example.tags).toEqual(["O", "B-TOPIC", "B-KIND"])
  })
})

describe("paraphrases in generate()", () => {
  const options = { seed: 7, train: 120, val: 20, test: 20, testSeen: 10 }
  const paraphrases = [record({}), record({ paraphrase: "nothing useful" })]
  const run = generate({ ...options, paraphrases })

  it("adds aligned paraphrases and the canonical echo to train only", () => {
    const train = run.splits.train.map((e) => e.source)
    expect(train).toContain("paraphrase:kind_actor_topic")
    expect(train).toContain("template:kind_actor_topic")
    for (const split of ["val", "test-generated", "test-seen-templates-unseen-names"] as const) {
      expect(run.splits[split].some((e) => e.source.startsWith("paraphrase:"))).toBe(false)
    }
    expect(run.stats.paraphrases).toMatchObject({
      records: 2,
      kept: 1,
      echoed: 1,
      dropped: { "missing-span": 1 },
    })
  })

  it("is byte-identical for the same seed and paraphrase file", () => {
    const again = generate({ ...options, paraphrases })
    expect(serialize(again.splits.train)).toBe(serialize(run.splits.train))
  })
})
