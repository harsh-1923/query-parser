import { normalizeTime } from "@qp/time"
import { describe, expect, it } from "vitest"
import { generate, serialize } from "./generate"
import { LABELS_FOR_TEST } from "./labels.test-helper"
import { loadLexicons } from "./lexicons"
import { TEMPLATES } from "./templates"
import { REFERENCE, TIME_ZONE } from "./time"
import type { Example } from "./types"

const options = { seed: 7, train: 350, val: 75, test: 75 }
const run = generate(options)
const all: Example[] = Object.values(run.splits).flat()

describe("determinism", () => {
  it("same seed gives byte-identical output", () => {
    const again = generate(options)
    for (const split of ["train", "val", "test-generated"] as const) {
      expect(serialize(again.splits[split])).toBe(serialize(run.splits[split]))
    }
    expect(JSON.stringify(again.stats)).toBe(JSON.stringify(run.stats))
  })

  it("different seeds differ", () => {
    const other = generate({ ...options, seed: 8 })
    expect(serialize(other.splits.train)).not.toBe(serialize(run.splits.train))
  })
})

describe("examples", () => {
  it("produces the requested counts", () => {
    expect(run.splits.train).toHaveLength(options.train)
    expect(run.splits.val).toHaveLength(options.val)
    expect(run.splits["test-generated"]).toHaveLength(options.test)
  })

  it("keeps tokens, offsets and tags the same length and offsets inside the text", () => {
    for (const e of all) {
      expect(e.tags).toHaveLength(e.tokens.length)
      expect(e.offsets).toHaveLength(e.tokens.length)
      e.offsets.forEach(([start, end], i) => {
        expect(e.text.slice(start, end)).toBe(e.tokens[i])
      })
    }
  })

  it("uses only known labels with valid BIO structure", () => {
    for (const e of all) {
      let prev = "O"
      for (const tag of e.tags) {
        expect(LABELS_FOR_TEST.has(tag)).toBe(true)
        if (tag.startsWith("I-")) {
          expect([`B-${tag.slice(2)}`, tag]).toContain(prev)
        }
        prev = tag
      }
    }
  })

  it("every TIME span parses with normalizeTime", () => {
    let spans = 0
    for (const e of all) {
      e.tags.forEach((tag, i) => {
        if (tag !== "B-TIME") return
        let j = i
        while (e.tags[j + 1] === "I-TIME") j++
        const text = e.text.slice(e.offsets[i]?.[0], e.offsets[j]?.[1])
        spans++
        expect(normalizeTime(text, { reference: REFERENCE, timeZone: TIME_ZONE }).ok, text).toBe(
          true,
        )
      })
    }
    expect(spans).toBeGreaterThan(50)
  })

  it("test-generated uses only held-out templates, train and val none", () => {
    const held = new Set(TEMPLATES.filter((t) => t.heldOut).map((t) => `template:${t.id}`))
    const isNone = (e: Example): boolean => e.source.startsWith("template:none_")
    expect(run.splits["test-generated"].every((e) => held.has(e.source) || isNone(e))).toBe(true)
    expect([...run.splits.train, ...run.splits.val].some((e) => held.has(e.source))).toBe(false)
  })

  it("test-generated names come only from the test pools", () => {
    const origins = Object.values(loadLexicons().names)
    const pool = (side: "train" | "test"): Set<string> =>
      new Set(origins.flatMap((o) => [...o[side].first, ...o[side].last]))
    const train = pool("train")
    const test = pool("test")
    const person = new Set(["ACTOR", "RECIPIENT", "PARTICIPANT", "MENTION"])
    let seenTest = 0
    for (const e of run.splits["test-generated"]) {
      e.tokens.forEach((tok, i) => {
        const role = e.tags[i]?.slice(2) ?? ""
        const word = tok.toLowerCase()
        if (!person.has(role) || !(train.has(word) || test.has(word))) return
        // the few words that are both a name and ordinary vocabulary are filtered from the pools
        if (test.has(word)) seenTest++
        expect(train.has(word) && !test.has(word), word).toBe(false)
      })
    }
    expect(seenTest).toBeGreaterThan(10)
  })

  it("drops anything on the blocklist", () => {
    const blocked = new Set(run.splits.train.slice(0, 20).map((e) => e.text.toLowerCase()))
    const filtered = generate({ ...options, blocklist: blocked })
    for (const e of Object.values(filtered.splits).flat()) {
      expect(blocked.has(e.text.toLowerCase())).toBe(false)
    }
    expect(filtered.stats.contaminationDropped).toBeGreaterThan(0)
  })

  it("has no duplicate texts across splits", () => {
    const texts = all
      .filter((e) => !e.source.startsWith("template:none_"))
      .map((e) => e.text.toLowerCase().replace(/\s+/g, " "))
    expect(new Set(texts).size).toBe(texts.length)
  })
})
