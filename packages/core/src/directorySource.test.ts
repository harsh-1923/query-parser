import { describe, expect, it } from "vitest"
import { directorySource, jaroWinkler, phoneticKey } from "./directorySource"
import type { ResolveContext, TaggedSpan } from "./types"

interface Person {
  id: string
  name: string
  handle?: string
}

const people: Person[] = [
  { id: "u01", name: "Rahul Sharma" },
  { id: "u02", name: "Rahul Verma" },
  { id: "u03", name: "Utkarsh Sharma", handle: "utkarsh.s" },
  { id: "u04", name: "Neha Gupta" },
  { id: "u05", name: "Priya Iyer" },
  { id: "u06", name: "Ankit Jain" },
  { id: "u07", name: "Sneha Rao", handle: "@sneha" },
  { id: "u08", name: "Lakshmi Narayan" },
  { id: "u09", name: "Mohammed Ali" },
  { id: "u10", name: "John Smith" },
  { id: "u11", name: "Emily Carter" },
  { id: "u12", name: "Wei Chen" },
  { id: "u13", name: "Hiroshi Tanaka" },
  { id: "u14", name: "Min-jun Kim" },
  { id: "u15", name: "José Álvarez" },
]

const fields = (p: Person) => ({
  id: p.id,
  label: p.name,
  ...(p.handle ? { aliases: [p.handle] } : {}),
})

const ctx: ResolveContext = { query: "", role: "ACTOR" as ResolveContext["role"], spans: [] }

function span(text: string): TaggedSpan {
  return {
    role: "ACTOR" as TaggedSpan["role"],
    text,
    start: 0,
    end: text.length,
    negated: false,
    confidence: 1,
  }
}

function lookup(src: ReturnType<typeof directorySource<Person>>, text: string) {
  const out = src(span(text), ctx)
  if (out instanceof Promise) throw new Error("directory source must be synchronous")
  return out
}

const dir = directorySource(people, { fields, self: "u04" })
const labels = (text: string) => lookup(dir, text).map((c) => c.label)

describe("directorySource", () => {
  it("matches full label and first name exactly", () => {
    const full = lookup(dir, "Rahul Sharma")
    expect(full[0]).toMatchObject({ id: "u01", score: 1 })
    expect(full.map((c) => c.id)).not.toContain("u02")
    expect(lookup(dir, "priya")[0]).toMatchObject({ id: "u05", score: 0.95 })
    expect(lookup(dir, "iyer")[0]?.id).toBe("u05")
  })

  it("returns both Rahuls with equal scores, sorted by label", () => {
    const r = lookup(dir, "rahul")
    expect(r.map((c) => c.label)).toEqual(["Rahul Sharma", "Rahul Verma"])
    expect(r[0]?.score).toBe(r[1]?.score)
  })

  it("matches token prefixes", () => {
    const r = lookup(dir, "utk")
    expect(r[0]?.id).toBe("u03")
    expect(r[0]?.score).toBeCloseTo(0.85 + (0.1 * 3) / 7, 10)
    expect(labels("ut")).toEqual([])
  })

  it("tolerates typos", () => {
    expect(lookup(dir, "utkrsh")[0]?.id).toBe("u03")
    expect(lookup(dir, "priyaa")[0]?.id).toBe("u05")
  })

  it("matches transliterations phonetically", () => {
    expect(lookup(dir, "utkarash")[0]?.id).toBe("u03")
    expect(lookup(dir, "uthkarsh")[0]?.id).toBe("u03")
    expect(lookup(dir, "laxmi")[0]?.id).toBe("u08")
    expect(lookup(dir, "muhammad")[0]?.id).toBe("u09")
    expect(lookup(dir, "laxmi")[0]?.score).toBe(0.8)
  })

  it("phonetic keys", () => {
    expect(phoneticKey("utkarsh")).toBe(phoneticKey("utkarash"))
    expect(phoneticKey("utkarsh")).toBe(phoneticKey("uthkarsh"))
    expect(phoneticKey("lakshmi")).toBe(phoneticKey("laxmi"))
    expect(phoneticKey("shreya")).toBe(phoneticKey("sreya"))
    expect(phoneticKey("vikas")).toBe(phoneticKey("wikas"))
    expect(phoneticKey("mohammed")).toBe(phoneticKey("muhammad"))
    expect(phoneticKey("mohammed")).toBe(phoneticKey("mohammad"))
  })

  it("jaro-winkler sanity", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.9611, 3)
    expect(jaroWinkler("abc", "abc")).toBe(1)
    expect(jaroWinkler("abc", "xyz")).toBe(0)
  })

  it("matches handles and aliases", () => {
    expect(lookup(dir, "@utkarsh.s")[0]).toMatchObject({ id: "u03", score: 1 })
    expect(lookup(dir, "@sneha")[0]).toMatchObject({ id: "u07", score: 1 })
  })

  it("does not confuse near names", () => {
    expect(labels("neha")).toEqual(["Neha Gupta"])
  })

  it("strips diacritics", () => {
    expect(lookup(dir, "jose")[0]?.id).toBe("u15")
    expect(lookup(dir, "alvarez")[0]?.id).toBe("u15")
    expect(lookup(dir, "José Álvarez")[0]?.score).toBe(1)
  })

  it("handles hyphenated names", () => {
    expect(lookup(dir, "min jun")[0]?.id).toBe("u14")
    expect(lookup(dir, "minjun")).toEqual([])
  })

  it("combines tokens and initials", () => {
    const r = lookup(dir, "rahul s")
    expect(r.map((c) => c.id)).toEqual(["u01"])
    expect(lookup(dir, "sharma rahul")[0]?.id).toBe("u01")
    expect(lookup(dir, "rahul sharm")[0]?.id).toBe("u01")
    expect(lookup(dir, "utkarsh s")[0]).toMatchObject({ id: "u03", score: 1 })
  })

  it("resolves self words", () => {
    for (const w of ["I", "me", "my", "mine", "myself"]) {
      expect(lookup(dir, w)).toEqual([
        { id: "u04", label: "Neha Gupta", score: 1, data: people[3] },
      ])
    }
    const noSelf = directorySource(people, { fields })
    expect(lookup(noSelf, "me")).toEqual([])
    const unknownSelf = directorySource(people, { fields, self: "zzz" })
    expect(lookup(unknownSelf, "me")).toEqual([{ id: "zzz", label: "me", score: 1 }])
  })

  it("returns nothing below the threshold", () => {
    expect(lookup(dir, "sync engine")).toEqual([])
    expect(lookup(dir, "payments")).toEqual([])
    expect(lookup(dir, "")).toEqual([])
    expect(lookup(dir, "  @ ")).toEqual([])
  })

  it("respects minScore", () => {
    const strict = directorySource(people, { fields, minScore: 0.9 })
    expect(lookup(strict, "laxmi")).toEqual([])
    expect(lookup(strict, "priya")[0]?.id).toBe("u05")
  })

  it("boost breaks ties", () => {
    const boosted = directorySource(people, {
      fields,
      boost: (p) => (p.id === "u02" ? 1 : 0),
    })
    const r = lookup(boosted, "rahul")
    expect(r.map((c) => c.id)).toEqual(["u02", "u01"])
    expect(r[0]?.score).toBeCloseTo(1, 10)
    expect(r[1]?.score).toBe(0.95)
    const clamped = directorySource(people, { fields, boost: () => 5 })
    expect(lookup(clamped, "Rahul Sharma")[0]?.score).toBe(1)
  })

  it("attaches the source item as data and caps results at 5", () => {
    expect(lookup(dir, "priya")[0]?.data).toBe(people[4])
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `Sam P${i}` }))
    const src = directorySource(many, { fields: (p) => ({ id: p.id, label: p.name }) })
    expect(lookup(src, "sam")).toHaveLength(5)
  })

  it("is deterministic and independent of input order", () => {
    expect(lookup(dir, "rahul")).toEqual(lookup(dir, "rahul"))
    const reversed = directorySource([...people].reverse(), { fields, self: "u04" })
    const shuffled = directorySource(
      [...people].sort((a, b) => (a.id.charCodeAt(2) % 3) - (b.id.charCodeAt(2) % 3)),
      { fields },
    )
    for (const q of ["rahul", "sharma", "utkarash", "rahul s", "a"]) {
      const base = lookup(dir, q).map(({ id, score }) => ({ id, score }))
      expect(lookup(reversed, q).map(({ id, score }) => ({ id, score }))).toEqual(base)
      expect(lookup(shuffled, q).map(({ id, score }) => ({ id, score }))).toEqual(base)
    }
  })
})

describe("directorySource performance", () => {
  const firsts = [
    "Aarav",
    "Aditi",
    "Amit",
    "Anjali",
    "Arjun",
    "Deepak",
    "Divya",
    "Farhan",
    "Gaurav",
    "Isha",
    "Karan",
    "Kavya",
    "Manish",
    "Meera",
    "Nikhil",
    "Pooja",
    "Rohan",
    "Sanjay",
    "Tanvi",
    "Vivek",
    "James",
    "Olivia",
    "Liam",
    "Emma",
    "Noah",
    "Sophia",
    "Lucas",
    "Mia",
    "Ethan",
    "Ava",
    "Hiro",
    "Yuki",
    "Sakura",
    "Jin",
    "Mei",
    "Ling",
    "Hana",
    "Ken",
    "Aiko",
    "Tao",
  ]
  const lasts = [
    "Agarwal",
    "Banerjee",
    "Chopra",
    "Desai",
    "Reddy",
    "Fernandes",
    "Gill",
    "Hegde",
    "Joshi",
    "Kapoor",
    "Mehta",
    "Nair",
    "Pillai",
    "Qureshi",
    "Saxena",
    "Trivedi",
    "Walker",
    "Young",
    "Zhang",
    "Tanaka",
    "Suzuki",
    "Brown",
    "Davis",
    "Evans",
    "Foster",
  ]
  const synthetic: Person[] = []
  for (const f of firsts) {
    for (const l of lasts) {
      synthetic.push({ id: `s${synthetic.length}`, name: `${f} ${l}` })
    }
  }

  it("builds 1,000 entries and looks up in under 5 ms on average", () => {
    expect(synthetic).toHaveLength(1000)
    const src = directorySource(synthetic, { fields })
    const queries = [
      "aarav",
      "ami",
      "chopr",
      "desia",
      "rohan k",
      "sanjay",
      "vivek",
      "xyzzy",
      "kavya m",
      "laxmi",
    ]
    for (const q of queries) lookup(src, q)
    const start = performance.now()
    for (let i = 0; i < 100; i++) lookup(src, queries[i % queries.length] ?? "")
    const avg = (performance.now() - start) / 100
    expect(avg).toBeLessThan(5)
  })
})
